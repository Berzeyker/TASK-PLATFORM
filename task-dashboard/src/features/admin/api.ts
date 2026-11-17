import { apiRequest } from '../auth/api'
import type { UserRole } from '../auth/types'
import type { Category, Ticket, TicketPage, TicketRecord, TicketStatus, TicketPriority } from '../tickets/types'

export type AdminUser = {
  id: number
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
}

export type AdminPortal = {
  tickets: Ticket[]
  categories: Category[]
  agents: AdminUser[]
}

export type TicketUpdate = {
  status?: TicketStatus
  agentId?: number
  priority?: TicketPriority
  categoryId?: number
  resolutionNotes?: string
}

export async function getAdminPortal(token: string): Promise<AdminPortal> {
  const [firstPage, categories, users] = await Promise.all([
    apiRequest<TicketPage>('/tickets?page=1&pageSize=100', { token }),
    apiRequest<Category[]>('/categories', { token }),
    apiRequest<AdminUser[]>('/admin/users', { token }),
  ])
  const pageCount = Math.ceil(firstPage.total / firstPage.pageSize)
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      apiRequest<TicketPage>(`/tickets?page=${index + 2}&pageSize=100`, { token }),
    ),
  )
  const records = [firstPage, ...remainingPages].flatMap((page) => page.items)

  return {
    categories,
    agents: users.filter((user) => user.role === 'AGENT' && user.isActive),
    tickets: records.map((ticket) => ({
      ...ticket,
      category: categories.find((category) => category.id === ticket.categoryId)?.name ?? 'Sin categoría',
    })),
  }
}

export function updateAdminTicket(token: string, ticketId: string, update: TicketUpdate): Promise<TicketRecord> {
  return apiRequest<TicketRecord>(`/tickets/${encodeURIComponent(ticketId)}`, {
    token,
    method: 'PUT',
    body: update,
  })
}
