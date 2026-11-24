import type { UserRole } from '../auth/types'
import type { Category, TicketPriority, TicketStatus } from '../tickets/types'

export type PersonRef = { id: number; fullName: string }

/** One row of GET /tickets for staff. */
export type QueueTicket = {
  id: string
  title: string
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  category: Category | null
  requester: { id: number; fullName: string; email: string }
  assignedAgent: PersonRef | null
}

export type QueuePageData = {
  items: QueueTicket[]
  total: number
  page: number
  pageSize: number
}

export type AttachmentInfo = {
  id: number
  fileName: string
  mimeType: string
  sizeBytes: number
}

/** The ticket fields the audit log snapshots (plus the few extras other actions store). */
export type AuditSnapshot = {
  status?: TicketStatus
  priority?: TicketPriority
  categoryId?: number | null
  assignedAgentId?: number | null
  files?: string[]
  articleId?: number
}

export type TimelineEntry = {
  id: number
  action: string
  createdAt: string
  oldValue: AuditSnapshot | null
  newValue: AuditSnapshot | null
  /** Staff get a name; employees only get the role. */
  actor: { id?: number; fullName?: string; role: UserRole } | null
}

export type TicketDetail = QueueTicket & {
  description: string
  affectedDevice: string | null
  location: string | null
  resolutionNotes: string | null
  satisfactionRating: number | null
  assignedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  attachments: AttachmentInfo[]
  auditLogs: TimelineEntry[]
}

export type AgentOption = { id: number; fullName: string; email: string }

export type TicketUpdate = {
  status?: TicketStatus
  agentId?: number
  priority?: TicketPriority
  categoryId?: number
  resolutionNotes?: string
}
