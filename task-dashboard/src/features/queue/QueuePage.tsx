import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { ticketPriorityLabels, ticketStatusLabels } from '../tickets/presentation'
import type { TicketPriority, TicketStatus } from '../tickets/types'
import { getQueue, PAGE_SIZE } from './api'
import type { QueuePageData } from './types'
import './Queue.css'

const statusOptions = Object.keys(ticketStatusLabels) as TicketStatus[]
const priorityOptions = Object.keys(ticketPriorityLabels) as TicketPriority[]

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

export function QueuePage() {
  const { session, user } = useAuth()
  const token = session?.accessToken ?? ''
  const navigate = useNavigate()

  const [status, setStatus] = useState<TicketStatus | ''>('')
  const [priority, setPriority] = useState<TicketPriority | ''>('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<QueuePageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getQueue(token, { status: status || undefined, priority: priority || undefined, page })
      .then((result) => {
        if (cancelled) return
        const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize))
        if (result.items.length === 0 && page > lastPage) {
          setPage(lastPage) // the list shrank under us: jump back to the last real page
          return
        }
        setData(result)
        setError('')
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError, 'No se pudo cargar la cola de tickets.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, status, priority, page, reloadKey])

  function changeStatus(value: TicketStatus | '') {
    setIsLoading(true)
    setStatus(value)
    setPage(1)
  }

  function changePriority(value: TicketPriority | '') {
    setIsLoading(true)
    setPriority(value)
    setPage(1)
  }

  function goToPage(next: number) {
    setIsLoading(true)
    setPage(next)
  }

  function refresh() {
    setIsLoading(true)
    setReloadKey((key) => key + 1)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)
  const hasFilters = Boolean(status || priority)

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> COLA DE TRABAJO</p>
          <h1>Cola de<br /><span>tickets.</span></h1>
          <p className="intro-copy">Toma una solicitud, clasifícala y llévala hasta su resolución.</p>
        </div>
        <button className="secondary-action" type="button" onClick={refresh} disabled={isLoading}>
          {isLoading ? 'Actualizando…' : '↻ Actualizar cola'}
        </button>
      </div>

      {error && (
        <div className="page-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={refresh}>Reintentar</button>
        </div>
      )}

      <section className="tickets-section" aria-labelledby="queue-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SOLICITUDES</p>
            <h2 id="queue-title">Tickets <span>{total}</span></h2>
          </div>
        </div>

        <form className="queue-filters" onSubmit={(event) => event.preventDefault()} aria-label="Filtros de la cola">
          <label>
            <span>ESTADO</span>
            <select value={status} onChange={(event) => changeStatus(event.target.value as TicketStatus | '')}>
              <option value="">Todos</option>
              {statusOptions.map((value) => <option value={value} key={value}>{ticketStatusLabels[value]}</option>)}
            </select>
          </label>
          <label>
            <span>PRIORIDAD</span>
            <select value={priority} onChange={(event) => changePriority(event.target.value as TicketPriority | '')}>
              <option value="">Todas</option>
              {priorityOptions.map((value) => <option value={value} key={value}>{ticketPriorityLabels[value]}</option>)}
            </select>
          </label>
          {hasFilters && (
            <button className="text-action" type="button" onClick={() => { setIsLoading(true); setStatus(''); setPriority(''); setPage(1) }}>
              Limpiar filtros
            </button>
          )}
        </form>

        <div className="queue-table-wrap" aria-busy={isLoading}>
          <table className={`queue-table${isLoading && data ? ' queue-stale' : ''}`}>
            <caption className="sr-only">Cola de tickets, página {page} de {lastPage}</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Asunto</th>
                <th scope="col">Solicitante</th>
                <th scope="col">Categoría</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Estado</th>
                <th scope="col">Asignado a</th>
                <th scope="col">Creado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ticket) => (
                <tr key={ticket.id} className="queue-row" onClick={() => navigate(`/tickets/${ticket.id}`)}>
                  <td className="queue-id">{ticket.id}</td>
                  <td className="queue-title">
                    <Link to={`/tickets/${ticket.id}`} onClick={(event) => event.stopPropagation()}>{ticket.title}</Link>
                  </td>
                  <td>{ticket.requester.fullName}</td>
                  <td>{ticket.category?.name ?? <span className="muted">Sin categoría</span>}</td>
                  <td><span className={`priority-label priority-${ticket.priority.toLowerCase()}`}>{ticketPriorityLabels[ticket.priority]}</span></td>
                  <td>
                    <span className={`status-label status-${ticket.status.toLowerCase()}`}>
                      <span />{ticketStatusLabels[ticket.status]}
                    </span>
                  </td>
                  <td>
                    {ticket.assignedAgent
                      ? ticket.assignedAgent.id === user?.id ? <strong>Tú</strong> : ticket.assignedAgent.fullName
                      : <span className="muted">Sin asignar</span>}
                  </td>
                  <td className="queue-date">{dateFormat.format(new Date(ticket.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!data && isLoading && <div className="empty-state" role="status">Cargando tickets…</div>}
          {data && items.length === 0 && !isLoading && (
            <div className="empty-state">
              <span className="empty-mark" aria-hidden="true">—</span>
              <h3>{hasFilters ? 'No hay tickets con esos filtros' : 'La cola está vacía'}</h3>
              <p>{hasFilters ? 'Prueba con otro estado o prioridad.' : 'Cuando un colaborador cree un ticket aparecerá aquí.'}</p>
            </div>
          )}
        </div>

        {total > 0 && (
          <nav className="queue-pagination" aria-label="Paginación">
            <span>Mostrando {from}–{to} de {total}</span>
            <div>
              <button className="secondary-action" type="button" disabled={page <= 1 || isLoading} onClick={() => goToPage(page - 1)}>← Anterior</button>
              <span aria-current="page">{page} / {lastPage}</span>
              <button className="secondary-action" type="button" disabled={page >= lastPage || isLoading} onClick={() => goToPage(page + 1)}>Siguiente →</button>
            </div>
          </nav>
        )}
      </section>
    </section>
  )
}
