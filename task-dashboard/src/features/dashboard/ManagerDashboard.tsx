import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { ticketPriorityLabels, ticketStatusLabels } from '../tickets/presentation'
import type { Category, TicketPriority, TicketStatus } from '../tickets/types'
import { getCategories, getMetrics } from './api'
import type { Metrics, MetricsFilters } from './types'
import './ManagerDashboard.css'

const DAY_MS = 24 * 3600 * 1000
const MAX_DAY_BARS = 120

const statusOrder: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED']
const priorityOrder: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function toInputDate(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

function defaultFilters(days = 30): MetricsFilters {
  const today = new Date()
  return { from: toInputDate(new Date(today.getTime() - (days - 1) * DAY_MS)), to: toInputDate(today), categoryId: null }
}

const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })
const shortDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The API omits days with no tickets; add them back so the chart has a continuous time axis. */
function fillDays(metrics: Metrics): { date: string; count: number }[] {
  const counts = new Map(metrics.ticketsPerDay.map((entry) => [entry.date, entry.count]))
  const start = Date.parse(`${metrics.range.from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${metrics.range.to.slice(0, 10)}T00:00:00Z`)
  const total = Math.floor((end - start) / DAY_MS) + 1
  if (!Number.isFinite(total) || total < 1 || total > MAX_DAY_BARS) return metrics.ticketsPerDay
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10)
    return { date, count: counts.get(date) ?? 0 }
  })
}

export function ManagerDashboard() {
  const { session } = useAuth()
  const token = session?.accessToken ?? ''
  const [filters, setFilters] = useState<MetricsFilters>(() => defaultFilters())
  const [categories, setCategories] = useState<Category[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getCategories(token)
      .then((items) => { if (!cancelled) setCategories(items) })
      .catch(() => { /* the filter just stays empty; metrics errors are shown below */ })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (filters.from > filters.to) return
    let cancelled = false
    void getMetrics(token, filters)
      .then((result) => {
        if (cancelled) return
        setMetrics(result)
        setError('')
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError, 'No se pudieron cargar las métricas.'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [token, filters, reloadKey])

  const invalidRange = filters.from > filters.to
  const days = useMemo(() => (metrics ? fillDays(metrics) : []), [metrics])
  const maxDay = Math.max(1, ...days.map((day) => day.count))
  const maxStatus = Math.max(1, ...(metrics ? statusOrder.map((key) => metrics.byStatus[key]) : [1]))
  const maxPriority = Math.max(1, ...(metrics ? priorityOrder.map((key) => metrics.byPriority[key]) : [1]))

  function update(next: Partial<MetricsFilters>) {
    setIsLoading(true)
    setFilters((current) => ({ ...current, ...next }))
  }

  function refresh() {
    setIsLoading(true)
    setReloadKey((key) => key + 1)
  }

  const noData = <span className="metric-nodata">Sin datos aún</span>

  return (
    <section className="page-content manager-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> MÉTRICAS DEL SERVICIO</p>
          <h1>Panorama<br /><span>del soporte.</span></h1>
          <p className="intro-copy">Volumen de tickets, tiempo de resolución y desvío de incidencias por IA.</p>
        </div>
        <button className="secondary-action" type="button" onClick={refresh} disabled={isLoading || invalidRange}>
          {isLoading ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </div>

      <form className="metrics-filters" onSubmit={(event) => event.preventDefault()} aria-label="Filtros de métricas">
        <label>
          <span>DESDE</span>
          <input type="date" value={filters.from} max={filters.to} onChange={(event) => event.target.value && update({ from: event.target.value })} />
        </label>
        <label>
          <span>HASTA</span>
          <input type="date" value={filters.to} min={filters.from} max={toInputDate(new Date())} onChange={(event) => event.target.value && update({ to: event.target.value })} />
        </label>
        <label>
          <span>CATEGORÍA</span>
          <select value={filters.categoryId ?? ''} onChange={(event) => update({ categoryId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Todas</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
        </label>
        <div className="metrics-quick" role="group" aria-label="Rangos rápidos">
          {[7, 30, 90].map((range) => (
            <button className="filter-button" type="button" key={range} onClick={() => update(defaultFilters(range))}>
              {range} días
            </button>
          ))}
        </div>
      </form>

      {invalidRange && <div className="page-alert" role="alert"><span>La fecha inicial no puede ser posterior a la final.</span></div>}
      {error && (
        <div className="page-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={refresh}>Reintentar</button>
        </div>
      )}

      {!metrics && isLoading ? (
        <div className="empty-state" role="status">Cargando métricas…</div>
      ) : metrics ? (
        <div className={isLoading ? 'metrics-body metrics-stale' : 'metrics-body'} aria-busy={isLoading}>
          <div className="overview-strip metrics-strip" aria-label="Indicadores principales">
            <div className="overview-item">
              <span className="overview-number">{metrics.totalTickets}</span>
              <span className="overview-label">TICKETS CREADOS</span>
            </div>
            <div className="overview-item">
              <span className="overview-number">{metrics.resolvedCount}</span>
              <span className="overview-label">RESUELTOS</span>
            </div>
            <div className="overview-item">
              <span className="overview-number">
                {metrics.mttrHours === null ? noData : <>{numberFormat.format(metrics.mttrHours)}<small> h</small></>}
              </span>
              <span className="overview-label">TIEMPO MEDIO DE RESOLUCIÓN</span>
            </div>
            <div className="overview-item">
              <span className="overview-number">
                {metrics.deflectionRate === null ? noData : <>{numberFormat.format(metrics.deflectionRate * 100)}<small> %</small></>}
              </span>
              <span className="overview-label">DESVÍO POR IA · {metrics.deflectedCount} CASOS</span>
            </div>
          </div>

          {metrics.totalTickets === 0 ? (
            <div className="empty-state">
              <span className="empty-mark" aria-hidden="true">—</span>
              <h3>No hay tickets en este rango</h3>
              <p>Prueba con otro periodo o categoría.</p>
            </div>
          ) : (
            <>
              <section className="chart-card" aria-labelledby="per-day-title">
                <div className="chart-heading">
                  <h2 id="per-day-title">Tickets por día</h2>
                  <span>Máx. {maxDay} en un día</span>
                </div>
                <div className="day-chart" role="img" aria-label={`Tickets creados por día, ${days.length} días, máximo ${maxDay}`}>
                  {days.map((day) => (
                    <span className="day-bar-slot" key={day.date} title={`${shortDate.format(new Date(`${day.date}T00:00:00Z`))}: ${day.count}`}>
                      <span className="day-bar" style={{ height: `${(day.count / maxDay) * 100}%` }} data-empty={day.count === 0} />
                    </span>
                  ))}
                </div>
                <div className="day-axis" aria-hidden="true">
                  <span>{days.length ? shortDate.format(new Date(`${days[0].date}T00:00:00Z`)) : ''}</span>
                  <span>{days.length ? shortDate.format(new Date(`${days[days.length - 1].date}T00:00:00Z`)) : ''}</span>
                </div>
              </section>

              <div className="chart-grid">
                <section className="chart-card" aria-labelledby="by-status-title">
                  <div className="chart-heading"><h2 id="by-status-title">Por estado</h2></div>
                  <ul className="hbar-list">
                    {statusOrder.map((key) => (
                      <li key={key}>
                        <span className="hbar-label">{ticketStatusLabels[key]}</span>
                        <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(metrics.byStatus[key] / maxStatus) * 100}%` }} /></span>
                        <span className="hbar-value">{metrics.byStatus[key]}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="chart-card" aria-labelledby="by-priority-title">
                  <div className="chart-heading"><h2 id="by-priority-title">Por prioridad</h2></div>
                  <ul className="hbar-list">
                    {priorityOrder.map((key) => (
                      <li key={key}>
                        <span className="hbar-label">{ticketPriorityLabels[key]}</span>
                        <span className="hbar-track"><span className="hbar-fill" data-priority={key} style={{ width: `${(metrics.byPriority[key] / maxPriority) * 100}%` }} /></span>
                        <span className="hbar-value">{metrics.byPriority[key]}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
