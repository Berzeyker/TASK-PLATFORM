import { apiRequest } from '../auth/api'
import type { KbArticle, KbArticleListItem, KbSearchResult, ArticleStatus } from './types'

export async function listKbArticles(token: string, status?: ArticleStatus): Promise<KbArticleListItem[]> {
  const qs = status ? `?status=${status}` : ''
  return apiRequest<KbArticleListItem[]>(`/kb/articles${qs}`, { token })
}

export async function getKbArticle(token: string, id: number): Promise<KbArticle> {
  return apiRequest<KbArticle>(`/kb/articles/${id}`, { token })
}

export async function searchKbArticles(token: string, query: string): Promise<KbSearchResult[]> {
  return apiRequest<KbSearchResult[]>(`/kb/search?q=${encodeURIComponent(query)}`, { token })
}

export async function createKbArticle(
  token: string,
  data: { title: string; content: string; categoryId?: number; tags?: string[]; visibilityRole?: string },
): Promise<KbArticle> {
  return apiRequest<KbArticle>('/kb/articles', { token, method: 'POST', body: data })
}

export async function updateKbArticle(
  token: string,
  id: number,
  data: { title?: string; content?: string; categoryId?: number; tags?: string[]; visibilityRole?: string },
): Promise<KbArticle> {
  return apiRequest<KbArticle>(`/kb/articles/${id}`, { token, method: 'PUT', body: data })
}

export async function changeKbArticleStatus(token: string, id: number, status: ArticleStatus): Promise<KbArticle> {
  return apiRequest<KbArticle>(`/kb/articles/${id}/status`, { token, method: 'PUT', body: { status } })
}