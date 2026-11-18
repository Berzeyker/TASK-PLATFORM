import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { formatTicketDate, ticketPriorityLabels, ticketStatusLabels } from '../tickets/presentation'
import type { Category, Ticket, TicketPriority, TicketStatus } from '../tickets/types'
import { getAdminPortal, updateAdminTicket, type AdminUser } from './api'
import './AdminDashboard.css'

type QueueFilter = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

const queueFilters: { value: QueueFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OPEN', label: 'Nuevos' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'RESOLVED', label: 'Resueltos' },
  { value: 'CLOSED', label: 'Cerrados' },
]

const nextStatuses: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: [],
  REOPENED: ['ASSIGNED'],
}

const priorityOptions: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function isInFilter(ticket: Ticket, filter: QueueFilter): boolean {
  if (filter === 'ALL') return true
  if (filter === 'OPEN') return ticket.status === 'OPEN' || ticket.status === 'REOPENED'
  if (filter === 'IN_PROGRESS') return ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS'
  if (filter === 'RESOLVED') return ticket.status === 'RESOLVED'
  return ticket.status === 'CLOSED'
}

export function AdminDashboard() {
  const { session } = useAuth()
  const token = session?.accessToken ?? ''
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [agents, setAgents] = useState<AdminUser[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [filter, setFilter] = useState<QueueFilter>('ALL')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')

  async function loadTickets(): Promise<boolean> {
    setIsLoading(true)
    try {
      const portal = await getAdminPortal(token)
      setTickets(portal.tickets)
      setCategories(portal.categories)
      setAgents(portal.agents)
      setError('')
      return true
    } catch (loadError) {
      setError(getErrorMessage(loadError))
      return false
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void getAdminPortal(token)
      .then((portal) => {
        if (cancelled) return
        setTickets(portal.tickets)
        setCategories(portal.categories)
        setAgents(portal.agents)
        setError('')
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const visibleTickets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    return tickets.filter((ticket) => {
      const requester = ticket.requester
      const searchable = [
        ticket.id,
        ticket.title,
        ticket.category,
        requester?.fullName,
        requester?.email,
        ticket.assignedAgent?.fullName,
      ].join(' ').toLocaleLowerCase('es')
      return isInFilter(ticket, filter) && (!query || searchable.includes(query))
    })
  }, [filter, search, tickets])

  const openCount = tickets.filter((ticket) => ticket.status === 'OPEN' || ticket.status === 'REOPENED').length
  const activeCount = tickets.filter((ticket) => ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS').length
  const urgentCount = tickets.filter((ticket) => ticket.priority === 'CRITICAL' || ticket.priority === 'HIGH').length

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTicket) return

    setFormError('')
    const formData = new FormData(event.currentTarget)
    const status = String(formData.get('status')) as TicketStatus
    const priority = String(formData.get('priority')) as TicketPriority
    const categoryValue = String(formData.get('categoryId'))
    const categoryId = Number(categoryValue)
    const agentId = Number(formData.get('agentId'))
    const resolutionNotes = String(formData.get('resolutionNotes')).trim()
    const update: {
      status?: TicketStatus
      priority?: TicketPriority
      categoryId?: number
      agentId?: number
      resolutionNotes?: string
    } = {}

    if (status !== selectedTicket.status) update.status = status
    if (priority !== selectedTicket.priority) update.priority = priority
    if (categoryValue && categoryId !== selectedTicket.categoryId) update.categoryId = categoryId
    if (agentId && agentId !== selectedTicket.assignedAgentId) update.agentId = agentId
    if (resolutionNotes !== (selectedTicket.resolutionNotes ?? '')) update.resolutionNotes = resolutionNotes
    if (status === 'ASSIGNED' && !agentId && !selectedTicket.assignedAgentId) {
      setFormError('Selecciona un agente antes de asignar el ticket.')
      return
    }
    if ((status === 'RESOLVED' || status === 'CLOSED') && (resolutionNotes.match(/[a-z0-9]/gi) ?? []).length < 20) {
      setFormError('Agrega una nota de resolución de al menos 20 caracteres alfanuméricos.')
      return
    }
    if (!Object.keys(update).length) {
      setFormError('No hay cambios para guardar.')
      return
    }

    setIsSaving(true)
    try {
      await updateAdminTicket(token, selectedTicket.id, update)
      if (await loadTickets()) {
        setSelectedTicket(null)
      } else {
        setFormError('Los cambios se guardaron, pero no se pudo actualizar la cola. Intenta actualizarla.')
      }
    } catch (saveError) {
      setFormError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
        <section className="page-content admin-page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow"><span className="accent-rule" /> OPERACIONES DE SOPORTE</p>
              <h1>Tickets del<br /><span>equipo.</span></h1>
              <p className="intro-copy">Revisa las solicitudes, asígnalas a un agente y acompaña cada resolución.</p>
            </div>
            <button className="secondary-action admin-refresh" type="button" onClick={() => {
              setIsLoading(true)
              void loadTickets()
            }} disabled={isLoading}>
              {isLoading ? 'Actualizando…' : '↻ Actualizar cola'}
            </button>
          </div>

          {error && (
            <div className="page-alert" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => {
                setIsLoading(true)
                void loadTickets()
              }}>Reintentar</button>
            </div>
          )}

          <div className="overview-strip admin-overview" aria-label="Resumen de la cola">
            <div className="overview-item">
              <span className="overview-number">{tickets.length.toString().padStart(2, '0')}</span>
              <span className="overview-label">TICKETS RECIBIDOS</span>
            </div>
            <div className="overview-item">
              <span className="overview-number">{openCount.toString().padStart(2, '0')}</span>
              <span className="overview-label">REQUIEREN ATENCIÓN</span>
            </div>
            <div className="overview-item">
              <span className="overview-number">{activeCount.toString().padStart(2, '0')}</span>
              <span className="overview-label">EN GESTIÓN</span>
            </div>
            <div className="overview-item admin-urgent">
              <span className="overview-number">{urgentCount.toString().padStart(2, '0')}</span>
              <span className="overview-label">PRIORIDAD ALTA / CRÍTICA</span>
            </div>
          </div>

          <section className="tickets-section admin-queue" aria-labelledby="admin-tickets-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ENTRADA DE SOPORTE</p>
                <h2 id="admin-tickets-title">Cola de solicitudes <span>{visibleTickets.length}</span></h2>
              </div>
              <label className="search-field admin-search-field">
                <span className="search-icon" aria-hidden="true" />
                <span className="sr-only">Buscar ticket, trabajador o agente</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar ticket o trabajador"
                />
              </label>
            </div>
            <div className="ticket-filters" role="group" aria-label="Filtrar cola de tickets">
              {queueFilters.map((item) => {
                const count = item.value === 'ALL'
                  ? tickets.length
                  : tickets.filter((ticket) => isInFilter(ticket, item.value)).length
                return (
                  <button
                    className={`filter-button${filter === item.value ? ' filter-active' : ''}`}
                    key={item.value}
                    type="button"
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}<span>{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="admin-ticket-list">
              <div className="admin-ticket-header" aria-hidden="true">
                <span>SOLICITUD</span><span>TRABAJADOR</span><span>ESTADO</span><span>PRIORIDAD</span><span>ASIGNADO A</span><span>CREADO</span>
              </div>
              {isLoading ? (
                <div className="empty-state" role="status">Cargando la cola de tickets…</div>
              ) : visibleTickets.length ? (
                visibleTickets.map((ticket) => (
                  <button className="admin-ticket-row" type="button" key={ticket.id} onClick={() => {
                    setFormError('')
                    setSelectedTicket(ticket)
                  }}>
                    <span className="admin-ticket-subject">
                      <span className={`status-mark status-mark-${ticket.status.toLowerCase()}`} aria-hidden="true" />
                      <span><strong>{ticket.title}</strong><small>{ticket.id} · {ticket.category}</small></span>
                    </span>
                    <span className="admin-requester">{ticket.requester?.fullName ?? 'Trabajador'}<small>{ticket.requester?.email ?? '—'}</small></span>
                    <span className={`status-label status-${ticket.status.toLowerCase()}`}><span />{ticketStatusLabels[ticket.status]}</span>
                    <span className={`priority-label priority-${ticket.priority.toLowerCase()}`}>{ticketPriorityLabels[ticket.priority]}</span>
                    <span className="admin-assignee">{ticket.assignedAgent?.fullName ?? 'Sin asignar'}</span>
                    <span className="ticket-updated">{formatTicketDate(ticket)}</span>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <span className="empty-mark" aria-hidden="true">—</span>
                  <h3>No encontramos tickets</h3>
                  <p>Prueba con otro filtro o término de búsqueda.</p>
                  <button className="text-action" type="button" onClick={() => {
                    setFilter('ALL')
                    setSearch('')
                  }}>Ver toda la cola <span aria-hidden="true">→</span></button>
                </div>
              )}
            </div>
            <p className="list-footnote">Mostrando {isLoading ? '…' : visibleTickets.length} de {tickets.length} tickets</p>
          </section>
        </section>

      {selectedTicket && (
        <AdminTicketModal
          ticket={selectedTicket}
          agents={agents}
          categories={categories}
          isSaving={isSaving}
          error={formError}
          onClose={() => {
            if (!isSaving) setSelectedTicket(null)
          }}
          onSubmit={handleUpdate}
        />
      )}
    </>
  )
}

type AdminTicketModalProps = {
  ticket: Ticket
  agents: AdminUser[]
  categories: Category[]
  isSaving: boolean
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function AdminTicketModal({ ticket, agents, categories, isSaving, error, onClose, onSubmit }: AdminTicketModalProps) {
  const choices = [ticket.status, ...nextStatuses[ticket.status]]
    .filter((status, index, list) => list.indexOf(status) === index)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="ticket-modal admin-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="admin-ticket-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow"><span className="accent-rule" /> {ticket.id}</p>
            <h2 id="admin-ticket-title">{ticket.title}</h2>
          </div>
          <button className="modal-close" type="button" aria-label="Cerrar detalle" onClick={onClose}>×</button>
        </div>
        <div className="admin-requester-card">
          <span className="admin-requester-avatar" aria-hidden="true">
            {(ticket.requester?.fullName ?? 'T').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span><strong>{ticket.requester?.fullName ?? 'Trabajador'}</strong><small>{ticket.requester?.email ?? '—'}</small></span>
          <span className={`status-label status-${ticket.status.toLowerCase()}`}><span />{ticketStatusLabels[ticket.status]}</span>
        </div>
        <div className="admin-ticket-description">
          <span className="sidebar-label">DESCRIPCIÓN DEL PROBLEMA</span>
          <p>{ticket.description}</p>
          {(ticket.affectedDevice || ticket.location) && (
            <small>{[ticket.affectedDevice, ticket.location].filter(Boolean).join(' · ')}</small>
          )}
        </div>
        <form className="ticket-form admin-ticket-form" onSubmit={onSubmit}>
          <div className="admin-form-grid">
            <label>
              <span>ESTADO</span>
              <select name="status" defaultValue={ticket.status} disabled={ticket.status === 'CLOSED'}>
                {choices.map((status) => <option value={status} key={status}>{ticketStatusLabels[status]}</option>)}
              </select>
            </label>
            <label>
              <span>PRIORIDAD</span>
              <select name="priority" defaultValue={ticket.priority}>
                {priorityOptions.map((priority) => <option value={priority} key={priority}>{ticketPriorityLabels[priority]}</option>)}
              </select>
            </label>
            <label>
              <span>ASIGNAR A AGENTE</span>
              <select name="agentId" defaultValue={ticket.assignedAgentId ?? ''}>
                <option value="">Sin cambios</option>
                {agents.map((agent) => (
                  <option value={agent.id} key={agent.id}>{agent.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>CATEGORÍA</span>
              <select name="categoryId" defaultValue={ticket.categoryId ?? ''}>
                <option value="">Sin categoría</option>
                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>NOTAS DE RESOLUCIÓN <small>REQUERIDAS PARA RESOLVER O CERRAR</small></span>
            <textarea name="resolutionNotes" defaultValue={ticket.resolutionNotes ?? ''} rows={3} placeholder="Documenta los pasos realizados y el resultado…" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {ticket.status === 'CLOSED' && <p className="admin-closed-note">Este ticket está cerrado y ya no admite cambios.</p>}
          {agents.length === 0 && <p className="admin-closed-note">No hay agentes activos para asignar tickets.</p>}
          <div className="form-actions">
            <button className="secondary-action" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button>
            <button className="primary-action" type="submit" disabled={isSaving || ticket.status === 'CLOSED'}>
              {isSaving ? 'Guardando…' : 'Guardar cambios'} <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
