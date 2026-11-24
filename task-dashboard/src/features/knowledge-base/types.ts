export type ArticleStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'

export type KbArticle = {
  id: number
  title: string
  content: string
  status: ArticleStatus
  categoryId: number | null
  tags: string[]
  authorId: number
  reviewerId: number | null
  visibilityRole: string
  version: number
  createdAt: string
  publishedAt: string | null
  sourceTicketId: string | null
}

export type KbArticleListItem = {
  id: number
  title: string
  status: ArticleStatus
  tags: string[]
  categoryId: number | null
  authorId: number
  version: number
  createdAt: string
  publishedAt: string | null
}

export type KbSearchResult = {
  id: number
  title: string
  tags: string[]
  categoryId: number | null
  snippet: string
  score: number
}

export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'Borrador',
  UNDER_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivado',
}

export const ARTICLE_STATUS_NEXT: Record<ArticleStatus, ArticleStatus[]> = {
  DRAFT: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['DRAFT', 'PUBLISHED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
}