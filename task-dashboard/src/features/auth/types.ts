export type UserRole = 'EMPLOYEE' | 'AGENT' | 'MANAGER' | 'ADMIN'

export type AuthSession = {
  accessToken: string
  email: string
  role: UserRole
}

export type LoginResponse = {
  accessToken: string
  role: UserRole
}

export type LoginCredentials = {
  email: string
  password: string
}