import { formatTicketDate, ticketPriorityLabels, ticketStatusLabels } from './presentation'
import type { Ticket } from './types'

type TicketDetailModalProps = {
  ticket: Ticket
  onClose: () => void
}

export function TicketDetailModal({ ticket, onClose }: TicketDetailModalProps) {
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
          <span>{ticket.category}</span>
          <span>Prioridad {ticketPriorityLabels[ticket.priority].toLowerCase()}</span>
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
        <div className="detail-update">
          <span className="accent-rule" />
          <p>Solicitud creada <strong>{formatTicketDate(ticket)}</strong></p>
        </div>
      </section>
    </div>
  )
}
