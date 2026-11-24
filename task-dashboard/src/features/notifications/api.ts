import { apiRequest } from '../auth/api'
import type { NotificationsResponse } from './types'

export async function getNotifications(token: string): Promise<NotificationsResponse> {
  return apiRequest<NotificationsResponse>('/notifications', { token })
}

export async function markNotificationRead(token: string, id: number): Promise<void> {
  await apiRequest(`/notifications/${id}/read`, { token, method: 'PUT' })
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  await apiRequest('/notifications/read-all', { token, method: 'PUT' })
}