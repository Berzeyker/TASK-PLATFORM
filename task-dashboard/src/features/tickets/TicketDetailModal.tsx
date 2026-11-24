import { useState } from 'react'
import { getErrorMessage } from '../auth/api'
import { downloadAttachment } from './api'
import { formatTicketDate, ticketPriorityLabels, ticketStatusLabels } from './presentation'
import type { Ticket } from './types'

type TicketDetailModalProps = {
  ticket: Ticket
  token: string
  onClose: () => void
  onRate: (rating: number) => void
}

const RATING_LABELS: Record<number, string> = {
  1: 'Muy malo',
  2: 'Malo',
  3: 'Regular',
  4: 'Bueno',
  5: 'Excelente',
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Ticket creado',
  STATUS_CHANGED: 'Cambio de estado',
  TICKET_UPDATED: 'Ticket actualizado',
  ATTACHMENT_ADDED: 'Archivos adjuntados',
}

function formatAuditDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TicketDetailModal({ ticket, token, onClose, onRate }: TicketDetailModalProps) {
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [hoverRating, setHoverRating] = useState(0)

  const canRate = ticket.status === 'CLOSED' && (ticket.satisfactionRating == null)

  async function handleDownload(attachmentId: number, fileName: string) {
    setDownloadingId(attachmentId)
    setDownloadError('')
    try {
      const { blob } = await downloadAttachment(token, attachmentId)
      // token is not available here; the function signature needs it. Fix below.
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setDownloadError(getErrorMessage(error, 'No se pudo descargar el archivo.'))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="ticket-modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow"><span className="accent-rule" /> {ticket.id}</p>
            <h2 id="ticket-detail-title">{ticket.title}</h2>
          </div>
          <button className="modal-close" type="button" aria-label="Cerrar detalle" onClick={onClose}>×</button>
        </div>

        <div className="detail-meta">
          <span className={`status-label status-${ticket.status.toLowerCase()}`}>
            <span />{ticketStatusLabels[ticket.status]}
          </span>
          <span>{typeof ticket.category === 'string' ? ticket.category : ticket.category?.name ?? 'Sin categoría'}</span>
          <span>Prioridad {ticketPriorityLabels[ticket.priority].toLowerCase()}</span>
          {ticket.assignedAgent && <span>Agente: {ticket.assignedAgent.fullName}</span>}
        </div>

        <div className="detail-description">
          <span className="sidebar-label">DESCRIPCIÓN DEL PROBLEMA</span>
          <p>{ticket.description}</p>
        </div>

        {(ticket.affectedDevice || ticket.location) && (
          <div className="detail-device">
            <span className="sidebar-label">DISPOSITIVO Y UBICACIÓN</span>
            <p>{[ticket.affectedDevice, ticket.location].filter(Boolean).join(' · ')}</p>
          </div>
        )}

        {ticket.resolutionNotes && (
          <div className="detail-resolution">
            <span className="sidebar-label">NOTAS DE RESOLUCIÓN</span>
            <p>{ticket.resolutionNotes}</p>
          </div>
        )}

        {ticket.attachments && ticket.attachments.length > 0 && (
          <div className="detail-attachments">
            <span className="sidebar-label">ARCHIVOS ADJUNTOS</span>
            <ul className="attachment-list">
              {ticket.attachments.map((att) => (
                <li key={att.id} className="attachment-item">
                  <span className="attachment-name">{att.fileName}</span>
                  <span className="attachment-size">{formatBytes(att.sizeBytes)}</span>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={downloadingId === att.id}
                    onClick={() => void handleDownload(att.id, att.fileName)}
                  >
                    {downloadingId === att.id ? 'Descargando…' : 'Descargar'}
                  </button>
                </li>
              ))}
            </ul>
            {downloadError && <p className="form-error" role="alert">{downloadError}</p>}
          </div>
        )}

        {ticket.auditLogs && ticket.auditLogs.length > 0 && (
          <div className="detail-timeline">
            <span className="sidebar-label">HISTORIAL</span>
            <ol className="audit-timeline">
              {ticket.auditLogs.map((log) => (
                <li key={log.id} className="audit-item">
                  <span className="audit-dot" />
                  <div className="audit-content">
                    <strong>{AUDIT_ACTION_LABELS[log.action] ?? log.action}</strong>
                    <span className="audit-date">{formatAuditDate(log.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {canRate && (
          <div className="detail-rating">
            <span className="sidebar-label">CALIFICA EL SERVICIO</span>
            <div className="rating-stars" role="group" aria-label="Calificación de 1 a 5 estrellas">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`rating-star${(hoverRating || 0) >= star ? ' rating-star-active' : ''}`}
                  aria-label={`${star} estrella${star > 1 ? 's' : ''}: ${RATING_LABELS[star]}`}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => onRate(star)}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="rating-hint">Selecciona una calificación de 1 a 5.</p>
          </div>
        )}

        {ticket.status === 'CLOSED' && ticket.satisfactionRating != null && (
          <div className="detail-rating">
            <span className="sidebar-label">CALIFICACIÓN</span>
            <p>{'★'.repeat(ticket.satisfactionRating)}{'☆'.repeat(5 - ticket.satisfactionRating)} ({ticket.satisfactionRating}/5)</p>
          </div>
        )}

        <div className="detail-update">
          <span className="accent-rule" />
          <p>Solicitud creada <strong>{formatTicketDate(ticket)}</strong></p>
        </div>
      </section>
    </div>
  )
}