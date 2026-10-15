import type { AuthSession, LoginCredentials, LoginResponse, UserRole } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const SESSION_KEY = 'task-platform-session'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ApiOptions = {
  token?: string
  body?: unknown
  method?: 'GET' | 'POST'
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null)
    const serverMessage =
      typeof result === 'object' && result !== null && 'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : ''
    const message = serverMessage === 'Invalid email or password. Please try again.'
      ? 'Correo o contraseña incorrectos. Verifica tus datos.'
      : serverMessage === 'Too many failed attempts. Try again later.'
        ? 'Hubo demasiados intentos. Espera 15 minutos y vuelve a intentarlo.'
        : serverMessage || `No se pudo completar la solicitud (${response.status}).`
    throw new ApiError(message, response.status)
  }

  return response.json() as Promise<T>
}

export async function login(credentials: LoginCredentials): Promise<AuthSession> {
  const result = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: credentials,
  })
  return { ...result, email: credentials.email }
}

export function readSession(): AuthSession | null {
  const stored = sessionStorage.getItem(SESSION_KEY)
  if (!stored) return null

  try {
    const session: unknown = JSON.parse(stored)
    if (
      typeof session === 'object' &&
      session !== null &&
      'accessToken' in session &&
      typeof session.accessToken === 'string' &&
      'email' in session &&
      typeof session.email === 'string' &&
      'role' in session &&
      isUserRole(session.role)
    ) {
      return {
        accessToken: session.accessToken,
        email: session.email,
        role: session.role,
      }
    }
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }

  sessionStorage.removeItem(SESSION_KEY)
  return null
}

export function readEmployeeSession(): AuthSession | null {
  const session = readSession()
  if (session && session.role !== 'EMPLOYEE') {
    clearSession()
    return null
  }
  return session
}

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'EMPLOYEE' || value === 'AGENT' || value === 'MANAGER' || value === 'ADMIN'
}
