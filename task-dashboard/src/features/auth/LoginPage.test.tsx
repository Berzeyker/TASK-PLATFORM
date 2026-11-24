import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('renders email and password fields', () => {
    render(<LoginPage error="" isSubmitting={false} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('nombre@empresa.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ingresa tu contraseña')).toBeInTheDocument()
  })

  it('shows error message when provided', () => {
    render(<LoginPage error="Correo o contraseña incorrectos." isSubmitting={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.')
  })

  it('disables submit button while submitting', () => {
    render(<LoginPage error="" isSubmitting={true} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('calls onSubmit when form is submitted', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<LoginPage error="" isSubmitting={false} onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('nombre@empresa.com'), 'test@test.com')
    await user.type(screen.getByPlaceholderText('Ingresa tu contraseña'), 'password123')
    await user.click(screen.getByRole('button', { name: /Iniciar sesión/i }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('shows "Validando acceso…" while submitting', () => {
    render(<LoginPage error="" isSubmitting={true} onSubmit={vi.fn()} />)
    expect(screen.getByText('Validando acceso…')).toBeInTheDocument()
  })
})