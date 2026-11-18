import type { UserRole } from './types'

/** Landing page for each role (also where a forbidden route redirects to). */
export const roleHome: Record<UserRole, string> = {
  EMPLOYEE: '/portal',
  AGENT: '/queue',
  MANAGER: '/dashboard',
  ADMIN: '/admin',
}

export const roleLabels: Record<UserRole, string> = {
  EMPLOYEE: 'Colaborador',
  AGENT: 'Agente',
  MANAGER: 'Gerente',
  ADMIN: 'Administrador',
}

export const allRoles: UserRole[] = ['EMPLOYEE', 'AGENT', 'MANAGER', 'ADMIN']
