import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../features/auth/auth-context'
import { roleLabels } from '../features/auth/roles'
import type { UserRole } from '../features/auth/types'
import './shell.css'

/** `also`: other URL prefixes that should keep this item highlighted (e.g. a ticket opened from the queue). */
type NavItem = { to: string; label: string; end?: boolean; also?: string[] }

const navByRole: Record<UserRole, NavItem[]> = {
  EMPLOYEE: [{ to: '/portal', label: 'Mis tickets' }],
  AGENT: [{ to: '/queue', label: 'Cola de tickets', also: ['/tickets/'] }],
  MANAGER: [{ to: '/dashboard', label: 'Métricas' }],
  ADMIN: [
    { to: '/admin', label: 'Cola de tickets', end: true },
    { to: '/dashboard', label: 'Métricas' },
    { to: '/admin/users', label: 'Usuarios y categorías' },
  ],
}

export function AppShell() {
  const { session, user, role, logout } = useAuth()
  const { pathname } = useLocation()
  if (!session || !role) return null

  const items = navByRole[role]
  const belongsTo = (item: NavItem) => pathname === item.to || (item.also ?? []).some((prefix) => pathname.startsWith(prefix))
  const current = items.find(belongsTo) ?? items.find((item) => pathname.startsWith(item.to))
  const displayName = user?.fullName ?? session.email.split('@')[0].replace(/[._-]+/g, ' ')
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="Navegación principal">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="brand-name">T.A.S.K.</span>
        </span>

        <nav className="sidebar-section" aria-label={roleLabels[role]}>
          <span className="sidebar-label">{roleLabels[role].toUpperCase()}</span>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive || belongsTo(item) ? ' nav-link-active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  {(isActive || belongsTo(item)) && <span className="nav-indicator" aria-hidden="true" />}
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar" aria-hidden="true">{initials || 'TR'}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <span>{roleLabels[role]}</span>
            </span>
            <button className="profile-menu" type="button" onClick={logout} aria-label="Cerrar sesión">Salir</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="breadcrumb">
            {roleLabels[role].toUpperCase()} <span>/</span> {(current?.label ?? 'INICIO').toUpperCase()}
          </span>
          <span className="service-status"><span /> Sistema operativo</span>
        </header>
        <Outlet />
        <footer className="page-footer">
          <span>T.A.S.K. <span className="footer-separator">/</span> SOPORTE QUE TE DEJA SEGUIR</span>
          <span>{session.email}</span>
        </footer>
      </main>
    </div>
  )
}
