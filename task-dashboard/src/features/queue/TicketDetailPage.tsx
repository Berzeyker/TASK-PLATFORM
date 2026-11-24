import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { ticketPriorityLabels, ticketStatusLabels } from '../tickets/presentation'
import type { Category } from '../tickets/types'
import { downloadAttachment, getActiveCategories, getAgents, getTicket } from './api'
import { TicketActionsPanel } from './TicketActionsPanel'
import { TicketTimeline } from './TicketTimeline'
import type { AgentOption, TicketDetail } from './types'
import './Queue.css'

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function TicketDetailPage() {
  const { id = '' } = useParams()
  // key: navigating from one ticket to another starts from a clean state
  return <TicketDetailView key={id} id={id} />
}

function TicketDetailView({ id }: { id: string }) {
  const { session } = useAuth()
  const token = session?.accessToken ?? ''
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [version, setVersion] = useState(0)
  // bumps after every successful load so the actions form re-initializes from fresh data, never stale data
  const [loadCount, setLoadCount] = useState(0)
  // success message waits here until the refreshed ticket is on screen, so we never confirm a change we are not yet showing
  const pendingNotice = useRef('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadingId, setDownloadingId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void getTicket(token, id)
      .then((detail) => {
        if (cancelled) return
        setTicket(detail)
        setLoadCount((count) => count + 1)
        setError('')
        setNotice(pendingNotice.current)
        pendingNotice.current = ''
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        pendingNotice.current = ''
        const notFound = loadError instanceof ApiError && (loadError.status === 404 || loadError.status === 403)
        setError(notFound ? 'Este ticket no existe o no tienes acceso a él.' : getErrorMessage(loadError, 'No se pudo cargar el ticket.'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [token, id, version])

  // Dropdown data: a failure here should not hide the ticket.
  useEffect(() => {
    let cancelled = false
    void Promise.all([getActiveCategories(token), getAgents(token)])
      .then(([categoryList, agentList]) => {
        if (cancelled) return
        setCategories(categoryList)
        setAgents(agentList)
      })
      .catch(() => { /* classification/assignment lists stay empty; the ticket still renders */ })
    return () => { cancelled = true }
  }, [token])

  function handleChanged(message: string) {
    pendingNotice.current = message
    setNotice('')
    setVersion((current) => current + 1)
  }

  function reload() {
    setIsLoading(true)
    setNotice('')
    setVersion((current) => current + 1)
  }

  async function handleDownload(attachmentId: number, fileName: string) {
    setDownloadError('')
    setDownloadingId(attachmentId)
    try {
      await downloadAttachment(token, attachmentId, fileName)
    } catch (downloadFailure) {
      setDownloadError(getErrorMessage(downloadFailure, 'No se pudo descargar el archivo.'))
    } finally {
      setDownloadingId(null)
    }
  }

  if (!ticket) {
    return (
      <section className="page-content">
        <Link className="back-link" to="/queue">← Volver a la cola</Link>
        {error ? (
          <div className="page-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={reload}>Reintentar</button>
          </div>
        ) : (
          isLoading && <div className="empty-state" role="status">Cargando ticket…</div>
        )}
      </section>
    )
  }

  const known = [ticket.requester, ...(ticket.assignedAgent ? [ticket.assignedAgent] : [])]
  const editable = ticket.status !== 'CLOSED'

  return (
    <section className="page-content ticket-page">
      <div className="ticket-topline">
        <Link className="back-link" to="/queue">← Volver a la cola</Link>
        <button className="text-action" type="button" onClick={reload} disabled={isLoading}>{isLoading ? 'Actualizando…' : '↻ Actualizar'}</button>
      </div>

      <header className="ticket-header">
        <p className="eyebrow"><span className="accent-rule" /> {ticket.id}</p>
        <h1 className="ticket-title">{ticket.title}</h1>
        <div className="detail-meta">
          <span className={`status-label status-${ticket.status.toLowerCase()}`}><span />{ticketStatusLabels[ticket.status]}</span>
          <span className={`priority-label priority-${ticket.priority.toLowerCase()}`}>Prioridad {ticketPriorityLabels[ticket.priority].toLowerCase()}</span>
          <span>{ticket.category?.name ?? 'Sin categoría'}</span>
          <span>{ticket.assignedAgent ? `Asignado a ${ticket.assignedAgent.fullName}` : 'Sin asignar'}</span>
        </div>
      </header>

      {error && <div className="page-alert" role="alert"><span>{error}</span><button type="button" onClick={reload}>Reintentar</button></div>}
      {notice && <p className="admin-success" role="status">{notice}</p>}

      <div className="ticket-columns">
        <div className="ticket-main">
          <section className="ticket-block" aria-labelledby="blk-desc">
            <h2 id="blk-desc" className="sidebar-label">DESCRIPCIÓN DEL PROBLEMA</h2>
            <p className="ticket-text">{ticket.description}</p>
            {(ticket.affectedDevice || ticket.location) && (
              <p className="muted">{[ticket.affectedDevice, ticket.location].filter(Boolean).join(' · ')}</p>
            )}
          </section>

          <section className="ticket-block" aria-labelledby="blk-req">
            <h2 id="blk-req" className="sidebar-label">SOLICITANTE</h2>
            <p className="ticket-text"><strong>{ticket.requester.fullName}</strong> · {ticket.requester.email}</p>
            <p className="muted">Creado {dateFormat.format(new Date(ticket.createdAt))}
              {ticket.assignedAt && <> · Asignado {dateFormat.format(new Date(ticket.assignedAt))}</>}
              {ticket.resolvedAt && <> · Resuelto {dateFormat.format(new Date(ticket.resolvedAt))}</>}
              {ticket.closedAt && <> · Cerrado {dateFormat.format(new Date(ticket.closedAt))}</>}
            </p>
          </section>

          {ticket.resolutionNotes && !editable && (
            <section className="ticket-block" aria-labelledby="blk-notes">
              <h2 id="blk-notes" className="sidebar-label">NOTAS DE RESOLUCIÓN</h2>
              <p className="ticket-text">{ticket.resolutionNotes}</p>
            </section>
          )}

          <section className="ticket-block" aria-labelledby="blk-files">
            <h2 id="blk-files" className="sidebar-label">ARCHIVOS ADJUNTOS <span>{ticket.attachments.length}</span></h2>
            {downloadError && <p className="form-error" role="alert">{downloadError}</p>}
            {ticket.attachments.length ? (
              <ul className="attachment-list">
                {ticket.attachments.map((file) => (
                  <li key={file.id}>
                    <span className="attachment-name">{file.fileName}</span>
                    <small>{formatSize(file.sizeBytes)}</small>
                    <button className="text-action" type="button" disabled={downloadingId === file.id}
                      onClick={() => void handleDownload(file.id, file.fileName)} aria-label={`Descargar ${file.fileName}`}>
                      {downloadingId === file.id ? 'Descargando…' : 'Descargar'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">El solicitante no adjuntó archivos.</p>}
          </section>

          <section className="ticket-block" aria-labelledby="blk-timeline">
            <h2 id="blk-timeline" className="sidebar-label">HISTORIAL</h2>
            <TicketTimeline entries={ticket.auditLogs} lookups={{ categories, agents, known }} />
          </section>
        </div>

        <aside className="ticket-side" aria-label="Acciones del ticket">
          <TicketActionsPanel key={`${ticket.id}-${loadCount}`} ticket={ticket} categories={categories} agents={agents} onChanged={handleChanged} />
        </aside>
      </div>
    </section>
  )
}
