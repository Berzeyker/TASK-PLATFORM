import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import { AuthContext } from './auth-context'
import type { AuthContextValue } from './auth-context'
import { RequireRole, HomeRedirect } from '../../app/RequireRole'

function makeAuth(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    session: null,
    user: null,
    role: null,
    isRestoring: false,
    notice: '',
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  }
}

function renderWithAuth(auth: AuthContextValue, initialPath: string) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route element={<RequireRole roles={['EMPLOYEE']} />}>
            <Route path="/portal" element={<div>Portal</div>} />
          </Route>
          <Route element={<RequireRole roles={['AGENT']} />}>
            <Route path="/queue" element={<div>Queue</div>} />
          </Route>
          <Route element={<RequireRole roles={['MANAGER', 'ADMIN']} />}>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
          </Route>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RequireRole guard', () => {
  it('redirects unauthenticated users to /login', () => {
    renderWithAuth(makeAuth({}), '/portal')
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('allows employee to access /portal', () => {
    renderWithAuth(makeAuth({ role: 'EMPLOYEE', isRestoring: false }), '/portal')
    expect(screen.getByText('Portal')).toBeInTheDocument()
  })

  it('redirects agent away from /portal to /queue', () => {
    renderWithAuth(makeAuth({ role: 'AGENT', isRestoring: false }), '/portal')
    expect(screen.getByText('Queue')).toBeInTheDocument()
  })

  it('redirects employee away from /queue to /portal', () => {
    renderWithAuth(makeAuth({ role: 'EMPLOYEE', isRestoring: false }), '/queue')
    expect(screen.getByText('Portal')).toBeInTheDocument()
  })

  it('shows restoring state while validating session', () => {
    renderWithAuth(makeAuth({ isRestoring: true }), '/portal')
    expect(screen.getByText(/Verificando/)).toBeInTheDocument()
  })
})

describe('HomeRedirect', () => {
  it('redirects authenticated user to their home', () => {
    renderWithAuth(makeAuth({ role: 'MANAGER', isRestoring: false }), '/')
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('redirects unauthenticated user to /login', () => {
    renderWithAuth(makeAuth({}), '/')
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})