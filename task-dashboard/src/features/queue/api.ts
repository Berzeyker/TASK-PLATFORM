import { apiDownload, apiRequest } from '../auth/api'
import type { Category, TicketPriority, TicketStatus } from '../tickets/types'
import type { AgentOption, QueuePageData, TicketDetail, TicketUpdate } from './types'

export const PAGE_SIZE = 20

export type QueueFilters = {
  status?: TicketStatus
  priority?: TicketPriority
  page: number
}

export function getQueue(token: string, filters: QueueFilters): Promise<QueuePageData> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) })
  if (filters.status) params.set('status', filters.status)
  if (filters.priority) params.set('priority', filters.priority)
  return apiRequest<QueuePageData>(`/tickets?${params.toString()}`, { token })
}

export function getTicket(token: string, id: string): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(`/tickets/${encodeURIComponent(id)}`, { token })
}

export function updateTicket(token: string, id: string, update: TicketUpdate): Promise<unknown> {
  return apiRequest(`/tickets/${encodeURIComponent(id)}`, { token, method: 'PUT', body: update })
}

export function getAgents(token: string): Promise<AgentOption[]> {
  return apiRequest<AgentOption[]>('/users?role=AGENT', { token })
}

export function getActiveCategories(token: string): Promise<Category[]> {
  return apiRequest<Category[]>('/categories', { token })
}

export function convertToKb(token: string, id: string): Promise<{ id: number; title: string }> {
  return apiRequest(`/tickets/${encodeURIComponent(id)}/convert-to-kb`, { token, method: 'POST' })
}

/** Fetches the file with the Authorization header and saves it through a temporary link. */
export async function downloadAttachment(token: string, attachmentId: number, fileName: string): Promise<void> {
  const blob = await apiDownload(`/attachments/${attachmentId}`, token)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
