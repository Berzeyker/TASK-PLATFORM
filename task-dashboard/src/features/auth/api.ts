import { API_URL } from '../../config/env'
import type { AuthSession, LoginCredentials, LoginResponse, UserRole } from './types'

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
  /** Plain objects are sent as JSON; FormData is sent as-is (the browser sets the boundary). */
  body?: unknown
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  timeoutMs?: number
}

// AuthProvider registers this so any 401 on an authenticated call ends the session in one place.
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

const serverMessages: Record<string, string> = {
  'Invalid email or password. Please try again.': 'Correo o contraseña incorrectos. Verifica tus datos.',
  'Too many failed attempts. Try again later.': 'Hubo demasiados intentos. Espera 15 minutos y vuelve a intentarlo.',
  'Access denied. You do not have permissions for this action.': 'No tienes permisos para realizar esta acción.',
  'Access denied.': 'No tienes permisos para ver este recurso.',
  'Email already registered': 'Ya existe un usuario con ese correo.',
  'Invalid date range': 'El rango de fechas no es válido.',
  'You cannot deactivate your own account.': 'No puedes desactivar tu propia cuenta.',
  'You cannot change your own role.': 'No puedes cambiar tu propio rol.',
  'At least one active administrator is required.': 'Debe quedar al menos un administrador activo.',
  'A category with that name already exists.': 'Ya existe una categoría con ese nombre.',
  'That record already exists.': 'Ese registro ya existe.',
  'Conflicting update. Please try again.': 'Hubo un conflicto al guardar. Inténtalo de nuevo.',
  'User not found': 'El usuario ya no existe.',
  'Category not found': 'La categoría ya no existe.',
  'Ticket not found': 'El ticket no existe o ya no tienes acceso a él.',
  'Invalid category': 'La categoría seleccionada no es válida.',
  'Invalid agent': 'El agente seleccionado no es válido o está inactivo.',
  'Nothing to update': 'No hay cambios para guardar.',
  'A category is required first (BR-01)': 'Primero clasifica el ticket con una categoría (BR-01).',
  'A resolution note of at least 20 alphanumeric characters is required (BR-02)':
    'La nota de resolución necesita al menos 20 letras o números (BR-02). Las letras con acento no cuentan.',
  'This ticket is closed. Open a new ticket for a recurring issue.':
    'Este ticket está cerrado y ya no se puede modificar (BR-03).',
  'Only resolved tickets with resolution notes can be converted':
    'Solo se pueden convertir tickets resueltos que tengan notas de resolución.',
  'This ticket was already converted to an article': 'Este ticket ya se convirtió en un artículo.',
  'Attachment not found': 'El archivo adjunto ya no existe.',
  'File not found on server': 'El archivo no se encontró en el servidor.',
}

const patternMessages: [RegExp, string][] = [
  [/^Cannot move ticket from \w+ to \w+$/, 'Ese cambio de estado no está permitido desde el estado actual. Actualiza el ticket e inténtalo de nuevo.'],
]

function messageFromBody(result: unknown, status: number): string {
  const body = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
  const serverMessage = typeof body.error === 'string' ? body.error : ''

  if (serverMessage === 'Validation failed' && Array.isArray(body.issues)) {
    const details = body.issues
      .map((issue) => (typeof issue === 'object' && issue !== null ? (issue as { message?: unknown }).message : null))
      .filter((text): text is string => typeof text === 'string')
      .slice(0, 2)
    return details.length ? `Revisa los datos: ${details.join('; ')}.` : 'Revisa los datos ingresados.'
  }
  const byPattern = patternMessages.find(([pattern]) => pattern.test(serverMessage))
  return serverMessages[serverMessage] ?? byPattern?.[1] ?? (serverMessage || `No se pudo completar la solicitud (${status}).`)
}

async function rejectResponse(response: Response, hadToken: boolean): Promise<never> {
  const result: unknown = await response.json().catch(() => null)
  if (response.status === 401 && hadToken) unauthorizedHandler?.()
  throw new ApiError(messageFromBody(result, response.status), response.status)
}

/** Downloads a protected file as a Blob. A plain <a href> cannot send the Authorization header. */
export async function apiDownload(path: string, token: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) await rejectResponse(response, true)
  return response.blob()
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const isFormData = options.body instanceof FormData
  const hasBody = options.body !== undefined && options.body !== null

  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: isFormData ? (options.body as FormData) : JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  })

  if (!response.ok) await rejectResponse(response, Boolean(options.token))

  // 204 / empty bodies are valid responses
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Turns any thrown value into a message that is safe to show to the user. */
export function getErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'La API tardó demasiado en responder. Verifica el backend y la base de datos.'
  }
  if (error instanceof TypeError) return 'No se pudo conectar con la API. Verifica que el backend esté funcionando.'
  return error instanceof Error ? error.message : fallback
}

export async function login(credentials: LoginCredentials): Promise<AuthSession> {
  const result = await apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: credentials })
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
      return { accessToken: session.accessToken, email: session.email, role: session.role }
    }
  } catch {
    // fall through and clear the corrupt value
  }

  sessionStorage.removeItem(SESSION_KEY)
  return null
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
