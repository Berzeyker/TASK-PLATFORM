import { useEffect, useState } from 'react'
import { getErrorMessage } from '../auth/api'
import { askAssistant } from '../ai-assistant/api'
import type { TroubleshootResponse } from '../ai-assistant/types'

const DEBOUNCE_MS = 1500
const TIMEOUT_MS = 10000
const MIN_LENGTH = 5

type Props = {
  title: string
  description: string
  token: string
  onResolved: () => void
  onNotResolved: () => void
}

export function AiDeflectionWidget({ title, description, token, onResolved, onNotResolved }: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TroubleshootResponse | null>(null)
  const [error, setError] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)

  useEffect(() => {
    const t = title.trim()
    const d = description.trim()
    if (t.length < MIN_LENGTH || d.length < MIN_LENGTH) {
      setResult(null)
      setError('')
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      setResult(null)
      const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const response = await askAssistant(token, { title: t, description: d, top_k: 3 })
        clearTimeout(timeoutId)
        setResult(response)
      } catch {
        clearTimeout(timeoutId)
        // Hide silently on failure (NFR-11)
        setError('')
        setResult(null)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [title, description, token])

  // Reset feedback when inputs change
  useEffect(() => {
    setFeedbackSent(false)
  }, [title, description])

  const confidence = result ? Math.round(result.confidence * 100) : 0
  const isLowConfidence = result && (result.confidence < 0.7 || !result.resolved_by_ai)

  if (title.trim().length < MIN_LENGTH || description.trim().length < MIN_LENGTH) {
    return null
  }

  return (
    <div className="ai-deflection-widget" role="region" aria-label="Sugerencia del asistente de IA">
      {loading && (
        <div className="ai-deflection-loading">
          <span className="assistant-dot" />
          <span className="assistant-dot" />
          <span className="assistant-dot" />
          <span>Consultando la base de conocimiento…</span>
        </div>
      )}

      {!loading && error && null}

      {!loading && result && isLowConfidence && (
        <div className="ai-deflection-low">
          <p>No encontré una solución confiable en la base de conocimiento. Puedes crear el ticket directamente.</p>
        </div>
      )}

      {!loading && result && !isLowConfidence && (
        <div className="ai-deflection-answer">
          <div className="ai-deflection-header">
            <strong>Sugerencia del asistente de IA</strong>
            <span className="ai-deflection-confidence">Confianza: {confidence}%</span>
          </div>
          {result.suggestion && (
            <div className="ai-deflection-steps">
              {result.suggestion.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
          {result.sources && result.sources.length > 0 && (
            <div className="ai-deflection-sources">
              <span className="sidebar-label">FUENTES</span>
              <ul>
                {result.sources.map((s) => (
                  <li key={s.article_id}>{s.title} ({Math.round(s.similarity_score * 100)}%)</li>
                ))}
              </ul>
            </div>
          )}
          {!feedbackSent ? (
            <div className="ai-deflection-actions">
              <button type="button" className="primary-action" onClick={() => { setFeedbackSent(true); onResolved() }}>
                Sí, esto resolvió mi problema
              </button>
              <button type="button" className="secondary-action" onClick={onNotResolved}>
                No resolvió / Crear ticket
              </button>
            </div>
          ) : (
            <div className="ai-deflection-feedback">
              <p>¡Gracias! Tu caso se marcó como resuelto por la IA.</p>
              <div className="rating-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" className="rating-star" aria-label={`${star} estrella${star > 1 ? 's' : ''}`}>
                    ★
                  </button>
                ))}
              </div>
              <p className="rating-hint">Califica la sugerencia (opcional).</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}