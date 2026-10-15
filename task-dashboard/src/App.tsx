import { useEffect, useState, type FormEvent } from 'react'
import { LoginPage } from './features/auth/LoginPage'
import {
  ApiError,
  clearSession,
  login,
  readEmployeeSession,
  saveSession,
} from './features/auth/api'
import type { AuthSession } from './features/auth/types'
import { TicketSummary } from './features/dashboard/TicketSummary'
import { createWorkerTicket, getWorkerPortal } from './features/tickets/api'
import { TicketDetailModal } from './features/tickets/TicketDetailModal'
import { TicketFormModal } from './features/tickets/TicketFormModal'
import { matchesTicketFilter } from './features/tickets/presentation'
import { TicketList } from './features/tickets/TicketList'
import type { Category, CreateTicketInput, Ticket } from './features/tickets/types'
import './App.css'

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'La API tardó demasiado en responder. Verifica el backend y la base de datos.'
  }
  if (error instanceof TypeError) {
    return 'No se pudo conectar con la API. Verifica que el backend esté funcionando.'
  }
  return error instanceof Error ? error.message : fallback
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readEmployeeSession())
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(Boolean(session))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pageError, setPageError] = useState('')
  const [formError, setFormError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  useEffect(() => {
    if (!session) return

    let cancelled = false
    void getWorkerPortal(session.accessToken)
      .then((portal) => {
        if (cancelled) return
        setPageError('')
        setTickets(portal.tickets)
        setCategories(portal.categories)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          clearSession()
          setSession(null)
          setTickets([])
          setCategories([])
          setLoginError('Tu sesión venció. Inicia sesión de nuevo.')
          return
        }
        setPageError(getErrorMessage(error, 'No se pudieron cargar tus solicitudes.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')
    setIsLoggingIn(true)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email')).trim().toLowerCase()
    const password = String(formData.get('password'))

    try {
      const authenticatedSession = await login({ email, password })
      if (authenticatedSession.role !== 'EMPLOYEE') {
        setLoginError('Este portal es para trabajadores. Usa una cuenta de trabajador.')
        return
      }
      setIsLoading(true)
      saveSession(authenticatedSession)
      setSession(authenticatedSession)
    } catch (error) {
      setLoginError(getErrorMessage(error, 'No se pudo iniciar sesión.'))
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return

    setFormError('')
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const input: CreateTicketInput = {
      title: String(formData.get('title')).trim(),
      description: String(formData.get('description')).trim(),
      categoryId: Number(formData.get('categoryId')),
      affectedDevice: String(formData.get('device')).trim() || undefined,
      location: String(formData.get('location')).trim() || undefined,
    }

    try {
      await createWorkerTicket(session.accessToken, input)
      setIsFormOpen(false)
      try {
        const portal = await getWorkerPortal(session.accessToken)
        setPageError('')
        setTickets(portal.tickets)
        setCategories(portal.categories)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          expireSession()
          return
        }
        setPageError(
          `El ticket se creó, pero no se pudo actualizar la lista. ${getErrorMessage(error, 'Intenta recargarla.')}`,
        )
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        expireSession()
      } else {
        setFormError(getErrorMessage(error, 'No se pudo crear el ticket.'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function expireSession() {
    clearSession()
    setSession(null)
    setTickets([])
    setCategories([])
    setIsFormOpen(false)
    setSelectedTicket(null)
    setLoginError('Tu sesión venció. Inicia sesión de nuevo.')
  }

  function signOut() {
    clearSession()
    setSession(null)
    setTickets([])
    setCategories([])
    setLoginError('')
    setIsFormOpen(false)
    setSelectedTicket(null)
  }

  async function retryLoading() {
    if (!session) return
    setIsLoading(true)
    try {
      const portal = await getWorkerPortal(session.accessToken)
      setPageError('')
      setTickets(portal.tickets)
      setCategories(portal.categories)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        expireSession()
      } else {
        setPageError(getErrorMessage(error, 'No se pudieron cargar tus solicitudes.'))
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (!session) {
    return (
      <LoginPage
        error={loginError}
        isSubmitting={isLoggingIn}
        onSubmit={handleLogin}
      />
    )
  }

  const displayName = session.email.split('@')[0].replace(/[._-]+/g, ' ')
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const openCount = tickets.filter((ticket) => matchesTicketFilter(ticket, 'OPEN')).length
  const inProgressCount = tickets.filter((ticket) => matchesTicketFilter(ticket, 'IN_PROGRESS')).length

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="Navegación principal">
        <a className="brand" href="/" aria-label="TASK, inicio">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="brand-name">T.A.S.K.</span>
        </a>

        <div className="sidebar-section">
          <span className="sidebar-label">ESPACIO DE TRABAJO</span>
          <button className="nav-link nav-link-active" type="button">
            <span className="nav-indicator" aria-hidden="true" />
            Mis tickets
            <span className="nav-count">{tickets.length}</span>
          </button>
          <button className="nav-link" type="button" disabled>
            <span className="nav-glyph" aria-hidden="true">⌘</span>
            Base de conocimiento
            <span className="nav-soon">PRONTO</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          <span className="sidebar-label">¿NECESITAS AYUDA?</span>
          <p>Estamos para ayudarte a volver al trabajo.</p>
          <a className="sidebar-help" href="mailto:soporte@task.local">
            Contactar a soporte <span aria-hidden="true">↗</span>
          </a>
          <div className="profile">
            <span className="avatar" aria-hidden="true">{initials || 'TR'}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <span>{session.email}</span>
            </span>
            <button className="profile-menu" type="button" onClick={signOut} aria-label="Cerrar sesión">Salir</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="breadcrumb">PORTAL DEL COLABORADOR <span>/</span> MIS TICKETS</span>
          <span className="service-status"><span /> Soporte disponible</span>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow"><span className="accent-rule" /> CENTRO DE SOPORTE</p>
              <h1>Tu trabajo,<br /><span>sin interrupciones.</span></h1>
              <p className="intro-copy">
                Reporta un problema y sigue cada actualización desde un solo lugar.
              </p>
            </div>
            <button className="primary-action" type="button" onClick={() => {
              setFormError('')
              setIsFormOpen(true)
            }}>
              <span aria-hidden="true">+</span> Crear ticket
            </button>
          </div>

          {pageError && (
            <div className="page-alert" role="alert">
              <span>{pageError}</span>
              <button type="button" onClick={() => void retryLoading()}>Reintentar</button>
            </div>
          )}

          <TicketSummary
            total={tickets.length}
            open={openCount}
            inProgress={inProgressCount}
          />

          <TicketList
            tickets={tickets}
            isLoading={isLoading}
            onSelect={setSelectedTicket}
          />
        </section>

        <footer className="page-footer">
          <span>T.A.S.K. <span className="footer-separator">/</span> SOPORTE QUE TE DEJA SEGUIR</span>
          <span>¿Algo urgente? Escribe a <a href="mailto:soporte@task.local">soporte@task.local</a></span>
        </footer>
      </main>

      {isFormOpen && (
        <TicketFormModal
          categories={categories}
          error={formError}
          isSubmitting={isSubmitting}
          onClose={() => setIsFormOpen(false)}
          onSubmit={handleCreateTicket}
        />
      )}

      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  )
}

export default App
