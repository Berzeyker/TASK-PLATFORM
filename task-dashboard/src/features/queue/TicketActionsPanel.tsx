import { useState } from 'react'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { ticketPriorityLabels } from '../tickets/presentation'
import type { Category, TicketPriority } from '../tickets/types'
import { convertToKb, updateTicket } from './api'
import { canMoveTo, convertedArticleId, countResolutionChars, MIN_RESOLUTION_CHARS } from './rules'
import type { AgentOption, TicketDetail, TicketUpdate } from './types'

type Props = {
  ticket: TicketDetail
  categories: Category[]
  agents: AgentOption[]
  /** Called after a successful change so the page reloads the ticket. */
  onChanged: (message: string) => void
}

const priorities = Object.keys(ticketPriorityLabels) as TicketPriority[]

export function TicketActionsPanel({ ticket, categories, agents, onChanged }: Props) {
  const { session, user, role } = useAuth()
  const token = session?.accessToken ?? ''
  const meId = user?.id ?? null

  const [categoryId, setCategoryId] = useState(ticket.category ? String(ticket.category.id) : '')
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority)
  const [agentId, setAgentId] = useState('')
  const [notes, setNotes] = useState(ticket.resolutionNotes ?? '')
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draftId, setDraftId] = useState<number | null>(null)

  const status = ticket.status
  const hasCategory = ticket.category !== null
  const savedNotes = ticket.resolutionNotes ?? ''
  const notesDirty = notes !== savedNotes
  const charCount = countResolutionChars(notes)
  const notesOk = charCount >= MIN_RESOLUTION_CHARS
  const alreadyConverted = convertedArticleId(ticket.auditLogs) ?? draftId

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setBusy(true)
    setError('')
    try {
      await action()
      onChanged(success)
    } catch (actionError) {
      setError(getErrorMessage(actionError, failure))
    } finally {
      setBusy(false)
      setConfirmingClose(false)
    }
  }

  const send = (update: TicketUpdate, success: string) =>
    run(() => updateTicket(token, ticket.id, update), success, 'No se pudo actualizar el ticket.')

  // ---------- read-only closed ticket (BR-03) ----------
  const closedNotice = status === 'CLOSED' && (
    <p className="action-note">
      Este ticket está cerrado: ya no se puede editar (BR-03).
      {ticket.satisfactionRating && <> Calificación del solicitante: <strong>{ticket.satisfactionRating} / 5</strong>.</>}
    </p>
  )

  // ---------- classification ----------
  const classification: TicketUpdate = {}
  if (categoryId && Number(categoryId) !== ticket.category?.id) classification.categoryId = Number(categoryId)
  if (priority !== ticket.priority) classification.priority = priority

  // ---------- assignment ----------
  const canAssign = status === 'OPEN' || status === 'REOPENED' || status === 'ASSIGNED' || status === 'IN_PROGRESS'
  const needsCategoryFirst = (status === 'OPEN' || status === 'REOPENED') && !hasCategory
  // OPEN -> the server moves it to ASSIGNED by itself; REOPENED must be moved explicitly.
  const assignUpdate = (id: number): TicketUpdate =>
    status === 'REOPENED' ? { agentId: id, status: 'ASSIGNED' } : { agentId: id }
  const takeUpdate = (): TicketUpdate | null => {
    if (role === 'AGENT' && meId) return assignUpdate(meId)
    // admins are not in the agent list: the server self-assigns the actor when moving to ASSIGNED
    if (role === 'ADMIN' && canMoveTo(status, 'ASSIGNED')) return { status: 'ASSIGNED' }
    return null
  }
  const take = takeUpdate()
  const isMine = ticket.assignedAgent?.id === meId

  // ---------- resolution ----------
  const showResolution = status === 'ASSIGNED' || status === 'IN_PROGRESS' || status === 'RESOLVED'
  const withNotes = (update: TicketUpdate): TicketUpdate => (notesDirty ? { ...update, resolutionNotes: notes } : update)

  // ---------- knowledge base ----------
  const canConvert = (status === 'RESOLVED' || status === 'CLOSED') && savedNotes.trim().length > 0

  async function handleConvert() {
    setBusy(true)
    setError('')
    try {
      const article = await convertToKb(token, ticket.id)
      setDraftId(article.id)
      onChanged(`Se creó el borrador #${article.id} en la base de conocimiento.`)
    } catch (convertError) {
      setError(getErrorMessage(convertError, 'No se pudo convertir el ticket.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="actions-panel">
      {error && <p className="form-error" role="alert">{error}</p>}
      {closedNotice}

      {status !== 'CLOSED' && (
        <section className="action-block" aria-labelledby="act-classify">
          <h3 id="act-classify">Clasificación</h3>
          <label>
            <span>CATEGORÍA</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={busy}>
              {!hasCategory && <option value="">Selecciona una categoría</option>}
              {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>
            <span>PRIORIDAD</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)} disabled={busy}>
              {priorities.map((value) => <option value={value} key={value}>{ticketPriorityLabels[value]}</option>)}
            </select>
          </label>
          <button className="secondary-action" type="button" disabled={busy || !Object.keys(classification).length}
            onClick={() => void send(classification, 'Clasificación guardada.')}>
            Guardar clasificación
          </button>
        </section>
      )}

      {canAssign && (
        <section className="action-block" aria-labelledby="act-assign">
          <h3 id="act-assign">Asignación</h3>
          <p className="action-note">
            {ticket.assignedAgent ? <>Asignado a <strong>{isMine ? 'ti' : ticket.assignedAgent.fullName}</strong>.</> : 'Nadie lo tiene asignado todavía.'}
          </p>
          {take && !isMine && (
            <button className="primary-action" type="button" disabled={busy || needsCategoryFirst}
              onClick={() => void send(take, 'Ticket asignado a ti.')}>
              Tomar ticket <span aria-hidden="true">→</span>
            </button>
          )}
          <label>
            <span>ASIGNAR A OTRO AGENTE</span>
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={busy}>
              <option value="">Selecciona un agente</option>
              {agents.map((agent) => (
                <option value={agent.id} key={agent.id}>{agent.fullName}{agent.id === ticket.assignedAgent?.id ? ' (actual)' : ''}</option>
              ))}
            </select>
          </label>
          <button className="secondary-action" type="button"
            disabled={busy || !agentId || Number(agentId) === ticket.assignedAgent?.id || needsCategoryFirst}
            onClick={() => void send(assignUpdate(Number(agentId)), 'Ticket reasignado.')}>
            Asignar
          </button>
          {needsCategoryFirst && <p className="action-hint">Guarda una categoría antes de asignar (BR-01).</p>}
        </section>
      )}

      {showResolution && (
        <section className="action-block" aria-labelledby="act-resolve">
          <h3 id="act-resolve">Estado y resolución</h3>
          <label>
            <span>NOTAS DE RESOLUCIÓN</span>
            <textarea rows={5} value={notes} onChange={(event) => { setNotes(event.target.value); setConfirmingClose(false) }}
              disabled={busy} aria-describedby="notes-counter" />
          </label>
          <p id="notes-counter" className={`char-counter${notesOk ? ' char-ok' : ''}`} aria-live="polite">
            {charCount} / {MIN_RESOLUTION_CHARS} letras y números
            {!notesOk && ' · mínimo para resolver o cerrar'}
          </p>
          <p className="action-hint">Solo cuentan a–z y 0–9. Las letras con acento (á, ñ) no suman.</p>

          {notesDirty && (
            <button className="secondary-action" type="button" disabled={busy}
              onClick={() => void send({ resolutionNotes: notes }, 'Notas guardadas.')}>
              Guardar notas
            </button>
          )}

          {canMoveTo(status, 'IN_PROGRESS') && (
            <button className="secondary-action" type="button" disabled={busy || !hasCategory}
              onClick={() => void send(withNotes({ status: 'IN_PROGRESS' }), 'El ticket está en progreso.')}>
              Iniciar trabajo
            </button>
          )}
          {!hasCategory && canMoveTo(status, 'IN_PROGRESS') && <p className="action-hint">Primero clasifica el ticket (BR-01).</p>}

          {canMoveTo(status, 'RESOLVED') && (
            <button className="primary-action" type="button" disabled={busy || !notesOk}
              onClick={() => void send(withNotes({ status: 'RESOLVED' }), 'Ticket resuelto.')}>
              Resolver ticket <span aria-hidden="true">→</span>
            </button>
          )}

          {canMoveTo(status, 'CLOSED') && !confirmingClose && (
            <button className="primary-action" type="button" disabled={busy || !notesOk} onClick={() => setConfirmingClose(true)}>
              Cerrar ticket <span aria-hidden="true">→</span>
            </button>
          )}
          {canMoveTo(status, 'CLOSED') && confirmingClose && (
            <div className="confirm-box" role="alert">
              <p><strong>¿Cerrar definitivamente?</strong> Un ticket cerrado ya no se puede editar ni reabrir.</p>
              <div className="confirm-actions">
                <button className="primary-action" type="button" disabled={busy}
                  onClick={() => void send(withNotes({ status: 'CLOSED' }), 'Ticket cerrado.')}>Sí, cerrar</button>
                <button className="secondary-action" type="button" disabled={busy} onClick={() => setConfirmingClose(false)}>Cancelar</button>
              </div>
            </div>
          )}
          {canMoveTo(status, 'REOPENED') && (
            <button className="secondary-action" type="button" disabled={busy}
              onClick={() => void send({ status: 'REOPENED' }, 'Ticket reabierto.')}>
              Reabrir
            </button>
          )}
        </section>
      )}

      {(status === 'RESOLVED' || status === 'CLOSED') && (
        <section className="action-block" aria-labelledby="act-kb">
          <h3 id="act-kb">Base de conocimiento</h3>
          {alreadyConverted ? (
            <p className="action-note">Ya existe un borrador para este ticket (artículo #{alreadyConverted}).</p>
          ) : (
            <>
              <p className="action-note">Convierte la solución en un borrador de artículo para que otros agentes la reutilicen.</p>
              <button className="secondary-action" type="button" disabled={busy || !canConvert} onClick={() => void handleConvert()}>
                Convertir en artículo KB
              </button>
              {!canConvert && <p className="action-hint">Necesita notas de resolución guardadas.</p>}
            </>
          )}
        </section>
      )}

      {status === 'OPEN' && !take && <p className="action-hint">Solo agentes y administradores pueden tomar tickets.</p>}
    </div>
  )
}
