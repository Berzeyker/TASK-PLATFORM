import type { TicketPriority, TicketStatus } from '../tickets/types'

/** Response of GET /metrics (Manager and Admin). */
export type Metrics = {
  range: { from: string; to: string }
  totalTickets: number
  byStatus: Record<TicketStatus, number>
  byPriority: Record<TicketPriority, number>
  ticketsPerDay: { date: string; count: number }[]
  resolvedCount: number
  /** Mean time to resolve in hours; null when nothing was resolved in the range. */
  mttrHours: number | null
  deflectedCount: number
  /** 0..1; null until there is data. */
  deflectionRate: number | null
}

export type MetricsFilters = {
  /** yyyy-mm-dd from the date input, local time */
  from: string
  to: string
  categoryId: number | null
}
