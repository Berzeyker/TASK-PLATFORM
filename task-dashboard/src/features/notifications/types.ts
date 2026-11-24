export type AppNotification = {
  id: number
  userId: number
  ticketId: string | null
  message: string
  channel: string
  isRead: boolean
  createdAt: string
}

export type NotificationsResponse = {
  items: AppNotification[]
  unreadCount: number
}