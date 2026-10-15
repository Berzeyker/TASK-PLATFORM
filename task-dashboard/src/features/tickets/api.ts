import { apiRequest } from '../auth/api'
import type { Category, CreateTicketInput, Ticket, TicketPage, TicketRecord } from './types'

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
