export type UserRole = 'EMPLOYEE' | 'AGENT' | 'MANAGER' | 'ADMIN'

export type AuthSession = {
  accessToken: string
  email: string
  role: UserRole
}

/** Profile returned by GET /auth/me. */
export type AuthUser = {
  id: number
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
}

export type LoginResponse = {
  accessToken: string
  role: UserRole
}

export type LoginCredentials = {
  email: string
  password: string
}
