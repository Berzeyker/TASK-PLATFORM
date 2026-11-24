import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { askAssistant } from './api'
import type { AssistantChatMessage, TroubleshootResponse } from './types'
import './AssistantPage.css'

const MIN_QUERY_LENGTH = 5

const SUGGESTIONS = [
  'No puedo conectarme a la red Wi-Fi de la oficina',
  'Mi laptop no enciende o se apaga sola',
  'No puedo iniciar sesión en mi correo corporativo',
  'La impresora no imprime y muestra un error',
]

const WELCOME_TEXT =
  'Hola. Soy el asistente de soporte de T.A.S.K. Descríbeme tu problema y buscaré la solución en los manuales publicados de la base de conocimiento. Si no encuentro una respuesta confiable, te diré que conviene escalarlo a un agente.'

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function titleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0].trim()
  const source = firstLine.length >= 3 ? firstLine : message.trim()
  return source.slice(0, 120)
}

function welcomeMessage(): AssistantChatMessage {
  return { id: createId(), role: 'assistant', text: WELCOME_TEXT }
}

function confidenceLabel(result: TroubleshootResponse): string {
  return `${Math.round(result.confidence * 100)}%`
}

export function AssistantPage() {
  const { session, role } = useAuth()
  const navigate = useNavigate()
  const token = session?.accessToken ?? ''
  const [messages, setMessages] = useState<AssistantChatMessage[]>(() => [welcomeMessage()])
  const [draft, setDraft] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState('')
  const [failedQuery, setFailedQuery] = useState('')
  const threadEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isEmptyConversation = messages.length === 1 && !messages[0].result
  const canSend = !isThinking

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isThinking])

  async function sendMessage(rawText: string) {
    const text = rawText.trim()
    if (isThinking) return
    if (text.length < MIN_QUERY_LENGTH) {
      setValidation(`Escribe al menos ${MIN_QUERY_LENGTH} caracteres para enviar.`)
      inputRef.current?.focus()
      return
    }

    const userMessage: AssistantChatMessage = { id: createId(), role: 'user', text }
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setValidation('')
    setError('')
    setFailedQuery('')
    setIsThinking(true)

    try {
      const result = await askAssistant(token, {
        title: titleFromMessage(text),
        description: text,
        top_k: 3,
      })
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          text: result.suggestion ?? result.escalation_reason ?? 'No obtuve una respuesta del motor RAG.',
          result,
        },
      ])
    } catch (caught) {
      setFailedQuery(text)
      setError(getErrorMessage(caught, 'No se pudo consultar al asistente. Intenta de nuevo.'))
    } finally {
      setIsThinking(false)
      inputRef.current?.focus()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the live value as well: it guarantees the actual typed text is sent
    // even if a keystroke/IME has not been committed to React state yet.
    void sendMessage(inputRef.current?.value ?? draft)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      void sendMessage(event.currentTarget.value)
    }
  }

  function resetConversation() {
    setMessages([welcomeMessage()])
    setDraft('')
    setError('')
    setValidation('')
    setFailedQuery('')
    setIsThinking(false)
    inputRef.current?.focus()
  }

  return (
    <section className="page-content assistant-page">
      <div className="page-heading assistant-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> SOPORTE ASISTIDO POR IA</p>
          <h1>Pregunta.<br /><span>Resuelve.</span></h1>
          <p className="intro-copy">
            Conversa con el asistente. Cada respuesta se basa en los manuales publicados de la base de conocimiento,
            con su nivel de confianza y las fuentes consultadas.
          </p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={resetConversation}
          disabled={isEmptyConversation && !draft}
        >
          Nueva conversación
        </button>
      </div>

      <div className="assistant-shell">
        <div className="assistant-meta">
          <span className="assistant-status"><span aria-hidden="true" /> ASISTENTE RAG</span>
          <span className="assistant-meta-note">Las respuestas pueden requerir validación de un agente</span>
        </div>

        <div className="assistant-thread" role="log" aria-live="polite" aria-label="Conversación con el asistente">
          {messages.map((message) => (
            <article key={message.id} className={`assistant-message assistant-message-${message.role}`}>
              <span className="assistant-author">{message.role === 'user' ? 'TÚ' : 'T.A.S.K. IA'}</span>
              <div className="assistant-bubble">
                <p className="assistant-text">{message.text}</p>

                {message.result && (
                  <div className="assistant-result-meta">
                    <span className={`assistant-verdict${message.result.resolved_by_ai ? ' assistant-verdict-ok' : ''}`}>
                      {message.result.resolved_by_ai ? 'RESUELTO POR IA' : 'REQUIERE ESCALAMIENTO'}
                    </span>
                    <span className="assistant-confidence">CONFIANZA {confidenceLabel(message.result)}</span>
                    {message.result.suggested_category && (
                      <span className="assistant-category">CATEGORÍA {message.result.suggested_category}</span>
                    )}
                  </div>
                )}

                {message.result && message.result.sources.length > 0 && (
                  <div className="assistant-sources">
                    <span className="assistant-sources-label">FUENTES</span>
                    <ul>
                      {message.result.sources.map((source) => (
                        <li key={source.article_id}>
                          <strong>{source.title}</strong>
                          <span>{Math.round(source.similarity_score * 100)}% coincidencia</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {message.result?.should_escalate && (
                  <div className="assistant-escalation">
                    <span className="assistant-escalation-label">SIGUIENTE PASO</span>
                    <p>El asistente recomienda continuar con soporte humano para resolver este caso.</p>
                    {role === 'EMPLOYEE' ? (
                      <button type="button" onClick={() => navigate('/portal')}>
                        Crear un ticket de soporte <span aria-hidden="true">→</span>
                      </button>
                    ) : (
                      <p className="assistant-escalation-note">
                        Revisa o publica un artículo que cubra este caso para que el asistente pueda resolverlo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}

          {isThinking && (
            <article className="assistant-message assistant-message-assistant" aria-label="El asistente está pensando">
              <span className="assistant-author">T.A.S.K. IA</span>
              <div className="assistant-bubble assistant-thinking">
                <span className="assistant-dot" />
                <span className="assistant-dot" />
                <span className="assistant-dot" />
                <span>Consultando la base de conocimiento…</span>
              </div>
            </article>
          )}

          {error && (
            <div className="assistant-error" role="alert">
              <span>{error}</span>
              <button type="button" disabled={!failedQuery || isThinking} onClick={() => void sendMessage(failedQuery)}>
                Reintentar
              </button>
            </div>
          )}

          <div ref={threadEndRef} />
        </div>

        {isEmptyConversation && (
          <div className="assistant-suggestions">
            <span className="assistant-suggestions-label">PRUEBA CON</span>
            <div className="assistant-chips">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="assistant-chip"
                  disabled={isThinking}
                  onClick={() => void sendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <form className="assistant-composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="assistant-input">Describe tu problema</label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              if (validation) setValidation('')
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe el problema: qué ocurre, desde cuándo y qué has intentado…"
            rows={3}
            maxLength={3000}
            autoFocus
          />
          <div className="assistant-composer-actions">
            <span className="assistant-hint">
              <kbd>Enter</kbd> enviar · <kbd>Shift</kbd> + <kbd>Enter</kbd> salto de línea
            </span>
            <button
              className="primary-action"
              type="submit"
              disabled={!canSend}
            >
              {isThinking ? 'Consultando…' : 'Enviar'} <span aria-hidden="true">→</span>
            </button>
          </div>
          {(validation || (draft.trim().length > 0 && draft.trim().length < MIN_QUERY_LENGTH)) && (
            <p className="assistant-min-hint" role="status">
              {validation || `Escribe al menos ${MIN_QUERY_LENGTH} caracteres para enviar.`}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
