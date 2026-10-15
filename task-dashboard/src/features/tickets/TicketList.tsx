import { useMemo, useState } from 'react'
import { formatTicketDate, matchesTicketFilter, ticketFilters, ticketPriorityLabels, ticketStatusLabels } from './presentation'
import type { Ticket, TicketFilter } from './types'

type TicketListProps = {
  tickets: Ticket[]
  isLoading: boolean
  onSelect: (ticket: Ticket) => void
}

export function TicketList({ tickets, isLoading, onSelect }: TicketListProps) {
  const [filter, setFilter] = useState<TicketFilter>('ALL')
  const [search, setSearch] = useState('')

  const visibleTickets = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es')
    return tickets.filter((ticket) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        `${ticket.id} ${ticket.title} ${ticket.category}`
          .toLocaleLowerCase('es')
          .includes(normalizedSearch)
      return matchesTicketFilter(ticket, filter) && matchesSearch
    })
  }, [filter, search, tickets])

  const countFor = (selectedFilter: TicketFilter) =>
    selectedFilter === 'ALL'
      ? tickets.length
      : tickets.filter((ticket) => matchesTicketFilter(ticket, selectedFilter)).length

  function resetFilters() {
    setSearch('')
    setFilter('ALL')
  }

  return (
    <section className="tickets-section" aria-labelledby="tickets-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SEGUIMIENTO</p>
          <h2 id="tickets-title">Mis solicitudes <span>{tickets.length}</span></h2>
        </div>
        <label className="search-field">
          <span className="search-icon" aria-hidden="true" />
          <span className="sr-only">Buscar tickets</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por asunto o número"
          />
          <kbd>/</kbd>
        </label>
      </div>

      <div className="ticket-filters" role="group" aria-label="Filtrar tickets">
        {ticketFilters.map((item) => (
          <button
            className={`filter-button${filter === item.value ? ' filter-active' : ''}`}
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
            <span>{countFor(item.value)}</span>
          </button>
        ))}
      </div>

      <div className="ticket-list">
        <div className="ticket-list-header" aria-hidden="true">
          <span>SOLICITUD</span>
          <span>CATEGORÍA</span>
          <span>ESTADO</span>
          <span>PRIORIDAD</span>
          <span>CREADO</span>
        </div>
        {isLoading ? (
          <div className="empty-state" role="status">Cargando tus solicitudes…</div>
        ) : visibleTickets.length > 0 ? (
          visibleTickets.map((ticket) => (
            <button
              className="ticket-row"
              key={ticket.id}
              type="button"
              onClick={() => onSelect(ticket)}
              aria-label={`Ver detalle de ${ticket.title}`}
            >
              <div className="ticket-subject">
                <span className={`status-mark status-mark-${ticket.status.toLowerCase()}`} aria-hidden="true" />
                <div>
                  <h3>{ticket.title}</h3>
                  <span className="ticket-id">{ticket.id}</span>
                </div>
              </div>
              <span className="ticket-category">
                {ticket.category}
                {(ticket.affectedDevice || ticket.location) && (
                  <span className="ticket-device">
                    {[ticket.affectedDevice, ticket.location].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className={`status-label status-${ticket.status.toLowerCase()}`}>
                <span />{ticketStatusLabels[ticket.status]}
              </span>
              <span className={`priority-label priority-${ticket.priority.toLowerCase()}`}>
                {ticketPriorityLabels[ticket.priority]}
              </span>
              <span className="ticket-updated">{formatTicketDate(ticket)}</span>
            </button>
          ))
        ) : (
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">—</span>
            <h3>No encontramos solicitudes</h3>
            <p>Prueba con otra búsqueda o crea un ticket nuevo.</p>
            <button type="button" className="text-action" onClick={resetFilters}>
              Ver todos los tickets <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </div>
      <p className="list-footnote">
        Mostrando {isLoading ? '…' : visibleTickets.length} de {tickets.length} solicitudes
      </p>
    </section>
  )
}
