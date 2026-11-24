export type TicketStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'

export type TicketFilter = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type Attachment = {
  id: number
  ticketId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedBy: number
  uploadedAt: string
}

export type AuditLog = {
  id: number
  ticketId: string | null
  actorType: string
  actorId: number | null
  action: string
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  createdAt: string
}

export type TicketCategory = string | { id: number; name: string }

export type Ticket = {
  id: string
  title: string
  description: string
  categoryId: number | null
  category: TicketCategory
  affectedDevice?: string | null
  location?: string | null
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  assignedAt?: string | null
  resolvedAt?: string | null
  closedAt?: string | null
  requester?: {
    id: number
    fullName: string
    email: string
  }
  assignedAgent?: {
    id: number
    fullName: string
  } | null
  assignedAgentId?: number | null
  resolutionNotes?: string | null
  satisfactionRating?: number | null
  attachments?: Attachment[]
  auditLogs?: AuditLog[]
}

export type TicketRecord = Omit<Ticket, 'category' | 'attachments' | 'auditLogs'>

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
