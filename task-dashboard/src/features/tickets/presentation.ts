import type { Ticket, TicketFilter, TicketStatus } from './types'

export const ticketFilters: { label: string; value: TicketFilter }[] = [
  { label: 'Todos', value: 'ALL' },
  { label: 'Abiertos', value: 'OPEN' },
  { label: 'En progreso', value: 'IN_PROGRESS' },
  { label: 'Resueltos', value: 'RESOLVED' },
]

export const ticketStatusLabels: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  ASSIGNED: 'Asignado',
  IN_PROGRESS: 'En progreso',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
}

export const ticketPriorityLabels: Record<Ticket['priority'], string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

export function matchesTicketFilter(ticket: Ticket, filter: TicketFilter): boolean {
  if (filter === 'ALL') return true
  if (filter === 'OPEN') return ticket.status === 'OPEN' || ticket.status === 'REOPENED'
  if (filter === 'IN_PROGRESS') return ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS'
  return ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
}

export function formatTicketDate(ticket: Ticket): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(ticket.createdAt))
}
