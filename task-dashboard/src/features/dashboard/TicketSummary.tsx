type TicketSummaryProps = {
  total: number
  open: number
  inProgress: number
}

export function TicketSummary({ total, open, inProgress }: TicketSummaryProps) {
  return (
    <div className="overview-strip" aria-label="Resumen de tickets">
      <div className="overview-item">
        <span className="overview-number">{total.toString().padStart(2, '0')}</span>
        <span className="overview-label">TICKETS EN TOTAL</span>
      </div>
      <div className="overview-item">
        <span className="overview-number">{open.toString().padStart(2, '0')}</span>
        <span className="overview-label">ESPERANDO ATENCIÓN</span>
      </div>
      <div className="overview-item">
        <span className="overview-number">{inProgress.toString().padStart(2, '0')}</span>
        <span className="overview-label">EN PROGRESO</span>
      </div>
      <p className="overview-note">Cada solicitud cuenta.<br />Estamos trabajando en las tuyas.</p>
    </div>
  )
}
