import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { getErrorMessage } from './api'
import { useAuth } from './auth-context'
import { LoginPage } from './LoginPage'
import { roleHome } from './roles'

export function LoginRoute() {
  const { login, notice, role, session } = useAuth()
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Already signed in: go straight to the role's landing page.
  if (session && role) return <Navigate to={roleHome[role]} replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email')).trim().toLowerCase()
    const password = String(formData.get('password'))
    try {
      await login({ email, password })
      // The redirect above runs on the next render.
    } catch (loginError) {
      setError(getErrorMessage(loginError, 'No se pudo iniciar sesión.'))
      setIsSubmitting(false)
    }
  }

  return <LoginPage error={error || notice} isSubmitting={isSubmitting} onSubmit={handleSubmit} />
}
