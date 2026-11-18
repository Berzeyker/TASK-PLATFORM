import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../features/auth/auth-context'
import { roleHome } from '../features/auth/roles'
import type { UserRole } from '../features/auth/types'

/**
 * Layout route that only renders its children for the listed roles.
 * Not signed in -> /login. Signed in with the wrong role -> that role's own home.
 * This is a UX guard only; the API enforces the same rules with 403.
 */
export function RequireRole({ roles }: { roles: UserRole[] }) {
  const { role, isRestoring } = useAuth()

  if (isRestoring) {
    return <div className="route-status" role="status">Verificando tu sesión…</div>
  }
  if (!role) return <Navigate to="/login" replace />
  if (!roles.includes(role)) return <Navigate to={roleHome[role]} replace />
  return <Outlet />
}

/** Sends "/" and unknown URLs to the right place for the current role. */
export function HomeRedirect() {
  const { role, isRestoring } = useAuth()
  if (isRestoring) return <div className="route-status" role="status">Verificando tu sesión…</div>
  return <Navigate to={role ? roleHome[role] : '/login'} replace />
}
