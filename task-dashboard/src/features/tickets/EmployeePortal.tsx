import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { TicketSummary } from '../dashboard/TicketSummary'
import { createWorkerTicket, getTicketDetail, getWorkerPortal, rateTicket, uploadAttachments } from './api'
import { matchesTicketFilter } from './presentation'
import { TicketDetailModal } from './TicketDetailModal'
import { TicketFormModal } from './TicketFormModal'
import { TicketList } from './TicketList'
import type { Category, CreateTicketInput, Ticket } from './types'

const POLL_INTERVAL_MS = 15000

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

  async function reload(failureMessage: string) {
    try {
      const portal = await getWorkerPortal(token)
      setPageError('')
      setTickets(portal.tickets)
      setCategories(portal.categories)
      // Keep the detail modal in sync with the latest data.
      if (selectedTicket) {
        const fresh = portal.tickets.find((t) => t.id === selectedTicket.id)
        if (fresh) {
          try {
            const detail = await getTicketDetail(token, fresh.id)
            setSelectedTicket(detail)
          } catch {
            setSelectedTicket(fresh)
          }
        }
      }
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

  // Poll every 15 s only while the tab is visible (TR-04).
  useEffect(() => {
    if (!token) return
    let intervalId: number | null = null
    let cancelled = false

    function startPolling() {
      if (intervalId !== null) return
      intervalId = window.setInterval(() => {
        if (cancelled) return
        if (document.visibilityState === 'visible') {
          void reload('No se pudieron actualizar tus solicitudes.')
        }
      }, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void reload('No se pudieron actualizar tus solicitudes.')
        startPolling()
      } else {
        stopPolling()
      }
    }

    if (document.visibilityState === 'visible') startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedTicket?.id])

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const input: CreateTicketInput = {
      title: String(formData.get('title') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim(),
      categoryId: Number(formData.get('categoryId')),
      affectedDevice: String(formData.get('device') ?? '').trim() || undefined,
      location: String(formData.get('location') ?? '').trim() || undefined,
    }

    const files = Array.from(formData.getAll('files')).filter((value): value is File => value instanceof File && value.size > 0)

    // Client-side validation for attachments.
    if (files.length > 5) {
      setFormError('Solo puedes adjuntar hasta 5 archivos.')
      setIsSubmitting(false)
      return
    }
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        setFormError(`El archivo "${file.name}" supera los 10 MB.`)
        setIsSubmitting(false)
        return
      }
      const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']
      if (!allowed.includes(file.type) && !/\.(pdf|png|jpe?g|txt)$/i.test(file.name)) {
        setFormError(`El archivo "${file.name}" no tiene un formato permitido (PDF, PNG, JPG, TXT).`)
        setIsSubmitting(false)
        return
      }
    }

    try {
      const created = await createWorkerTicket(token, input)
      let uploadWarning = ''
      if (files.length > 0) {
        try {
          await uploadAttachments(token, created.id, files)
        } catch (uploadError) {
          uploadWarning = ` El ticket se creó, pero no se pudieron subir los archivos: ${getErrorMessage(uploadError, 'error de carga')}.`
        }
      }
      setIsFormOpen(false)
      await reload('Intenta recargarla.')
      if (uploadWarning) {
        setPageError(uploadWarning.trim())
      }
    } catch (error) {
      setFormError(getErrorMessage(error, 'No se pudo crear el ticket.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRate(ticketId: string, rating: number) {
    try {
      await rateTicket(token, ticketId, rating)
      await reload('No se pudo actualizar la calificación.')
    } catch (error) {
      setPageError(getErrorMessage(error, 'No se pudo registrar la calificación.'))
    }
  }

  async function retryLoading() {
    setIsLoading(true)
    await reload('No se pudieron cargar tus solicitudes.')
    setIsLoading(false)
  }

  async function handleSelectTicket(ticket: Ticket) {
    try {
      const detail = await getTicketDetail(token, ticket.id)
      setSelectedTicket(detail)
    } catch {
      setSelectedTicket(ticket)
    }
  }
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
        <TicketList tickets={tickets} isLoading={isLoading} onSelect={handleSelectTicket} />
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
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          token={token}
          onClose={() => setSelectedTicket(null)}
          onRate={(rating) => void handleRate(selectedTicket.id, rating)}
        />
      )}
    </>
  )
}