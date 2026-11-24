import { apiRequest } from '../auth/api'
import { API_URL } from '../../config/env'
import type { Attachment, Category, CreateTicketInput, Ticket, TicketPage, TicketRecord } from './types'

export async function getWorkerPortal(token: string): Promise<{ tickets: Ticket[]; categories: Category[] }> {
  const [ticketPage, categories] = await Promise.all([
    apiRequest<TicketPage>('/tickets', { token }),
    apiRequest<Category[]>('/categories', { token }),
  ])

  return {
    categories,
    tickets: ticketPage.items.map((ticket) => ({
      ...ticket,
      category: categories.find((category) => category.id === ticket.categoryId)?.name ?? 'Sin categoría',
    })),
  }
}

export function createWorkerTicket(token: string, input: CreateTicketInput): Promise<TicketRecord> {
  return apiRequest<TicketRecord>('/tickets', {
    token,
    method: 'POST',
    body: input,
  })
}

export async function getTicketDetail(token: string, ticketId: string): Promise<Ticket> {
  return apiRequest<Ticket>(`/tickets/${ticketId}`, { token })
}

export async function uploadAttachments(token: string, ticketId: string, files: File[]): Promise<Attachment[]> {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  return apiRequest<Attachment[]>(`/tickets/${ticketId}/attachments`, {
    token,
    method: 'POST',
    body: formData,
  })
}

export async function downloadAttachment(token: string, attachmentId: number): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${API_URL}/api/v1/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('No se pudo descargar el archivo.')
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const fileName = match ? match[1] : 'archivo'
  const blob = await response.blob()
  return { blob, fileName }
}

export async function rateTicket(token: string, ticketId: string, rating: number): Promise<void> {
  await apiRequest(`/tickets/${ticketId}/rating`, {
    token,
    method: 'PUT',
    body: { rating },
  })
}