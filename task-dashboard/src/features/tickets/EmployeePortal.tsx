import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { TicketSummary } from '../dashboard/TicketSummary'
import { createWorkerTicket, getWorkerPortal } from './api'
import { matchesTicketFilter } from './presentation'
import { TicketDetailModal } from './TicketDetailModal'
import { TicketFormModal } from './TicketFormModal'
import { TicketList } from './TicketList'
import type { Category, CreateTicketInput, Ticket } from './types'

export function EmployeePortal() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const token = session?.accessToken ?? ''
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pageError, setPageError] = useState('')
  const [formError, setFormError] = useState('')

  // A 401 anywhere is handled globally (session ends, redirect to /login).
  async function reload(failureMessage: string) {
    try {
      const portal = await getWorkerPortal(token)
      setPageError('')
      setTickets(portal.tickets)
      setCategories(portal.categories)
    } catch (error) {
      setPageError(getErrorMessage(error, failureMessage))
    }
  }

  useEffect(() => {
    let cancelled = false
    void getWorkerPortal(token)
      .then((portal) => {
        if (cancelled) return
        setPageError('')
        setTickets(portal.tickets)
        setCategories(portal.categories)
      })
      .catch((error: unknown) => {
        if (!cancelled) setPageError(getErrorMessage(error, 'No se pudieron cargar tus solicitudes.'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      await createWorkerTicket(token, input)
      setIsFormOpen(false)
      await reload('Intenta recargarla.')
    } catch (error) {
      setFormError(getErrorMessage(error, 'No se pudo crear el ticket.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryLoading() {
    setIsLoading(true)
    await reload('No se pudieron cargar tus solicitudes.')
    setIsLoading(false)
  }

  const openCount = tickets.filter((ticket) => matchesTicketFilter(ticket, 'OPEN')).length
  const inProgressCount = tickets.filter((ticket) => matchesTicketFilter(ticket, 'IN_PROGRESS')).length

  return (
    <>
      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow"><span className="accent-rule" /> CENTRO DE SOPORTE</p>
            <h1>Tu trabajo,<br /><span>sin interrupciones.</span></h1>
            <p className="intro-copy">Reporta un problema y sigue cada actualización desde un solo lugar.</p>
          </div>
          <div className="page-heading-actions">
            <button className="secondary-action" type="button" onClick={() => navigate('/assistant')}>
              Preguntar a la IA
            </button>
            <button className="primary-action" type="button" onClick={() => {
              setFormError('')
              setIsFormOpen(true)
            }}>
              <span aria-hidden="true">+</span> Crear ticket
            </button>
          </div>
        </div>

        {pageError && (
          <div className="page-alert" role="alert">
            <span>{pageError}</span>
            <button type="button" onClick={() => void retryLoading()}>Reintentar</button>
          </div>
        )}

        <TicketSummary total={tickets.length} open={openCount} inProgress={inProgressCount} />
        <TicketList tickets={tickets} isLoading={isLoading} onSelect={setSelectedTicket} />
      </section>

      {isFormOpen && (
        <TicketFormModal
          categories={categories}
          error={formError}
          isSubmitting={isSubmitting}
          onClose={() => setIsFormOpen(false)}
          onSubmit={handleCreateTicket}
        />
      )}
      {selectedTicket && <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </>
  )
}
