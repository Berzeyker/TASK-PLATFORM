import { Outlet } from 'react-router'
import { AuthProvider } from '../features/auth/AuthProvider'

/** Root route element: everything below it can call useAuth() and useNavigate(). */
export function AppProvider() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}
