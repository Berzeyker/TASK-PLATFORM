import { createContext, useContext } from 'react'
import type { AuthSession, AuthUser, LoginCredentials, UserRole } from './types'

export type AuthContextValue = {
  session: AuthSession | null
  /** Profile from GET /auth/me; null until it loads. */
  user: AuthUser | null
  /** The server-confirmed role once known, otherwise the stored one. */
  role: UserRole | null
  /** True while a stored session is being validated against /auth/me. */
  isRestoring: boolean
  /** One-shot message for the login screen (for example "session expired"). */
  notice: string
  login: (credentials: LoginCredentials) => Promise<UserRole>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
