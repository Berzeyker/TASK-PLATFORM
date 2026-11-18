import { apiRequest } from '../auth/api'
import type { Category } from '../tickets/types'
import type { Metrics, MetricsFilters } from './types'

export function getMetrics(token: string, filters: MetricsFilters): Promise<Metrics> {
  const params = new URLSearchParams()
  // Date inputs give local calendar days: cover the whole first and last day.
  params.set('from', new Date(`${filters.from}T00:00:00`).toISOString())
  params.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString())
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
  return apiRequest<Metrics>(`/metrics?${params.toString()}`, { token })
}

export function getCategories(token: string): Promise<Category[]> {
  return apiRequest<Category[]>('/categories', { token })
}
