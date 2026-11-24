import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '../auth/api'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from './api'
import type { AppNotification } from './types'

const POLL_INTERVAL_MS = 30000

type Props = {
  token: string
}

export function NotificationsBell({ token }: Props) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      const data = await getNotifications(token)
      setItems(data.items)
      setUnreadCount(data.unreadCount)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar las notificaciones.'))
    }
  }

  useEffect(() => {
    if (!token) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_INTERVAL_MS)

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('mousedown', handleClickOutside)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleMarkRead(notification: AppNotification) {
    if (notification.isRead) return
    try {
      await markNotificationRead(token, notification.id)
      setItems((prev) => prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo marcar como leída.'))
    }
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead(token)
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron marcar todas como leídas.'))
    }
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  }

  return (
    <div className="notifications-bell" ref={containerRef}>
      <button
        type="button"
        className="notifications-trigger"
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className="notifications-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notifications-dropdown" role="dialog" aria-label="Notificaciones">
          <div className="notifications-header">
            <strong>Notificaciones</strong>
            {unreadCount > 0 && (
              <button type="button" className="notifications-mark-all" onClick={() => void handleMarkAll()}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          {error && <p className="notifications-error" role="alert">{error}</p>}
          {items.length === 0 ? (
            <p className="notifications-empty">Sin notificaciones.</p>
          ) : (
            <ul className="notifications-list">
              {items.map((notification) => (
                <li
                  key={notification.id}
                  className={`notification-item${notification.isRead ? '' : ' notification-unread'}`}
                  onClick={() => void handleMarkRead(notification)}
                >
                  <span className="notification-message">{notification.message}</span>
                  <span className="notification-date">{formatDate(notification.createdAt)}</span>
                  {notification.ticketId && (
                    <span className="notification-ticket">Ticket {notification.ticketId}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}