import type { TicketStatus } from '../tickets/types'
import type { TimelineEntry } from './types'

/** BR-02: resolution notes need at least this many letters or digits to resolve or close. */
export const MIN_RESOLUTION_CHARS = 20

/**
 * Must match the server exactly (`/[a-z0-9]/gi`): only ASCII letters and digits count,
 * so accented letters (á, ñ) do NOT add to the total.
 */
export function countResolutionChars(text: string): number {
  return (text.match(/[a-z0-9]/gi) ?? []).length
}

/** Mirror of the server's transition table. CLOSED is terminal (BR-03). */
export const nextStatuses: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['ASSIGNED'],
  CLOSED: [],
}

export function canMoveTo(from: TicketStatus, to: TicketStatus): boolean {
  return nextStatuses[from].includes(to)
}

/** The article id from the CONVERTED_TO_KB audit entry, if this ticket was already converted. */
export function convertedArticleId(entries: TimelineEntry[]): number | null {
  return entries.find((entry) => entry.action === 'CONVERTED_TO_KB')?.newValue?.articleId ?? null
}
