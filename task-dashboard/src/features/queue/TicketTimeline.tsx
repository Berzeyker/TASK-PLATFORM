import { roleLabels } from '../auth/roles'
import { ticketPriorityLabels, ticketStatusLabels } from '../tickets/presentation'
import type { Category } from '../tickets/types'
import type { AgentOption, AuditSnapshot, TimelineEntry } from './types'

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

type Lookups = {
  categories: Category[]
  agents: AgentOption[]
  /** people already known from the ticket itself (assigned agent, requester) */
  known: { id: number; fullName: string }[]
}

function agentName(id: number | null | undefined, lookups: Lookups): string {
  if (!id) return 'Sin asignar'
  return lookups.agents.find((a) => a.id === id)?.fullName ?? lookups.known.find((p) => p.id === id)?.fullName ?? `Agente #${id}`
}

function categoryName(id: number | null | undefined, lookups: Lookups): string {
  if (!id) return 'Sin categoría'
  return lookups.categories.find((c) => c.id === id)?.name ?? `Categoría #${id}`
}

/** Both STATUS_CHANGED and TICKET_UPDATED store a before/after snapshot: describe what differs. */
function describeDiff(oldValue: AuditSnapshot | null, newValue: AuditSnapshot | null, lookups: Lookups): string[] {
  if (!oldValue || !newValue) return []
  const lines: string[] = []
  if (oldValue.status !== newValue.status && oldValue.status && newValue.status)
    lines.push(`Estado: ${ticketStatusLabels[oldValue.status]} → ${ticketStatusLabels[newValue.status]}`)
  if (oldValue.priority !== newValue.priority && oldValue.priority && newValue.priority)
    lines.push(`Prioridad: ${ticketPriorityLabels[oldValue.priority]} → ${ticketPriorityLabels[newValue.priority]}`)
  if ((oldValue.categoryId ?? null) !== (newValue.categoryId ?? null))
    lines.push(`Categoría: ${categoryName(oldValue.categoryId, lookups)} → ${categoryName(newValue.categoryId, lookups)}`)
  if ((oldValue.assignedAgentId ?? null) !== (newValue.assignedAgentId ?? null))
    lines.push(`Asignado a: ${agentName(oldValue.assignedAgentId, lookups)} → ${agentName(newValue.assignedAgentId, lookups)}`)
  return lines
}

function describe(entry: TimelineEntry, lookups: Lookups): string[] {
  switch (entry.action) {
    case 'TICKET_CREATED':
      return ['Ticket creado']
    case 'STATUS_CHANGED':
    case 'TICKET_UPDATED': {
      const lines = describeDiff(entry.oldValue, entry.newValue, lookups)
      return lines.length ? lines : ['Notas de resolución actualizadas']
    }
    case 'ATTACHMENT_ADDED':
      return [`Archivos adjuntados: ${(entry.newValue?.files ?? []).join(', ') || '—'}`]
    case 'CONVERTED_TO_KB':
      return [`Convertido en borrador de la base de conocimiento (artículo #${entry.newValue?.articleId ?? '?'})`]
    default:
      return [entry.action]
  }
}

function actorLabel(entry: TimelineEntry): string {
  if (!entry.actor) return 'Sistema'
  return entry.actor.fullName ?? roleLabels[entry.actor.role]
}

export function TicketTimeline({ entries, lookups }: { entries: TimelineEntry[]; lookups: Lookups }) {
  if (!entries.length) return <p className="muted">Todavía no hay actividad registrada.</p>
  return (
    <ol className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="timeline-dot" aria-hidden="true" />
          <div>
            {describe(entry, lookups).map((line) => <p className="timeline-line" key={line}>{line}</p>)}
            <small>{actorLabel(entry)} · <time dateTime={entry.createdAt}>{dateFormat.format(new Date(entry.createdAt))}</time></small>
          </div>
        </li>
      ))}
    </ol>
  )
}
