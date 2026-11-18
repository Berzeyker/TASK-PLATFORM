import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  apiRequest,
  clearSession,
  login as loginRequest,
  readSession,
  saveSession,
  setUnauthorizedHandler,
} from './api'
import { AuthContext, type AuthContextValue } from './auth-context'
import type { AuthSession, AuthUser } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [session, setSession] = useState<AuthSession | null>(() => readSession())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isRestoring, setIsRestoring] = useState(() => Boolean(readSession()))
  const [notice, setNotice] = useState('')

  const endSession = useCallback(
    (message = '') => {
      clearSession()
      setSession(null)
      setUser(null)
      setIsRestoring(false)
      setNotice(message)
      navigate('/login', { replace: true })
    },
    [navigate],
  )

  // Any 401 from an authenticated request ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession('Tu sesión venció. Inicia sesión de nuevo.'))
    return () => setUnauthorizedHandler(null)
  }, [endSession])

  // Validate the stored token and learn the real role from the server.
  const token = session?.accessToken
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void apiRequest<AuthUser>('/auth/me', { token })
      .then((profile) => {
        if (cancelled) return
        setUser(profile)
        // The server is the source of truth for the role, not sessionStorage.
        setSession((current) => {
          if (!current || current.role === profile.role) return current
          const corrected = { ...current, role: profile.role }
          saveSession(corrected)
          return corrected
        })
      })
      .catch(() => {
        // 401 is handled globally by the unauthorized handler; other failures
        // (for example a network error) keep the stored session.
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const login = useCallback<AuthContextValue['login']>(async (credentials) => {
    const next = await loginRequest(credentials)
    saveSession(next)
    setNotice('')
    setUser(null)
    setIsRestoring(true)
    setSession(next)
    return next.role
  }, [])

  const logout = useCallback(() => endSession(), [endSession])

  const value = useMemo<AuthContextValue>(
    () => ({ session, user, role: user?.role ?? session?.role ?? null, isRestoring, notice, login, logout }),
    [session, user, isRestoring, notice, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
