export type TicketStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'

export type TicketFilter = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type Ticket = {
  id: string
  title: string
  description: string
  categoryId: number | null
  category: string
  affectedDevice?: string | null
  location?: string | null
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  assignedAt?: string | null
  resolvedAt?: string | null
  closedAt?: string | null
}

export type TicketRecord = Omit<Ticket, 'category'>

export type Category = {
  id: number
  name: string
}

export type TicketPage = {
  items: TicketRecord[]
  total: number
  page: number
  pageSize: number
}

export type CreateTicketInput = {
  title: string
  description: string
  categoryId: number
  affectedDevice?: string
  location?: string
}
