import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import {
  changeKbArticleStatus,
  createKbArticle,
  getKbArticle,
  listKbArticles,
  searchKbArticles,
  updateKbArticle,
} from './api'
import { ARTICLE_STATUS_LABELS, ARTICLE_STATUS_NEXT } from './types'
import type { ArticleStatus, KbArticle, KbArticleListItem, KbSearchResult } from './types'

const STATUSES: ArticleStatus[] = ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']

export function KnowledgeBasePage() {
  const { session } = useAuth()
  const token = session?.accessToken ?? ''
  const role = session?.role ?? ''

  // Actually we don't have userId in session. Let's get it from /auth/me.
  // For simplicity, we'll track authorId from the article itself.

  const [articles, setArticles] = useState<KbArticleListItem[]>([])
  const [searchResults, setSearchResults] = useState<KbSearchResult[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ArticleStatus | 'ALL'>('ALL')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<KbArticle | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Editor state
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editVisibility, setEditVisibility] = useState('EMPLOYEE')
  const [previewMode, setPreviewMode] = useState(false)
  const [isNew, setIsNew] = useState(false)

  async function loadArticles() {
    setIsLoading(true)
    setError('')
    try {
      const status = statusFilter === 'ALL' ? undefined : statusFilter
      const data = await listKbArticles(token, status)
      setArticles(data)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar los artículos.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadArticles()
  }, [token, statusFilter])

  async function handleSearch() {
    if (searchQuery.trim().length < 2) {
      setSearchResults(null)
      return
    }
    try {
      const results = await searchKbArticles(token, searchQuery.trim())
      setSearchResults(results)
    } catch (err) {
      setError(getErrorMessage(err, 'Error en la búsqueda.'))
    }
  }

  async function handleSelect(id: number) {
    setSelectedId(id)
    setIsNew(false)
    setError('')
    setSuccess('')
    try {
      const article = await getKbArticle(token, id)
      setDetail(article)
      setEditTitle(article.title)
      setEditContent(article.content)
      setEditTags(article.tags.join(', '))
      setEditVisibility(article.visibilityRole)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el artículo.'))
    }
  }

  function handleNew() {
    setSelectedId(null)
    setDetail(null)
    setIsNew(true)
    setEditTitle('')
    setEditContent('')
    setEditTags('')
    setEditVisibility('EMPLOYEE')
    setError('')
    setSuccess('')
  }

  async function handleSave() {
    setIsSaving(true)
    setError('')
    setSuccess('')
    const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean)
    try {
      if (isNew) {
        const created = await createKbArticle(token, {
          title: editTitle,
          content: editContent,
          tags,
          visibilityRole: editVisibility,
        })
        setSuccess('Artículo creado como borrador.')
        setIsNew(false)
        setSelectedId(created.id)
        setDetail(created)
        await loadArticles()
      } else if (selectedId) {
        const updated = await updateKbArticle(token, selectedId, {
          title: editTitle,
          content: editContent,
          tags,
          visibilityRole: editVisibility,
        })
        setDetail(updated)
        setSuccess('Artículo actualizado.')
        await loadArticles()
      }
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo guardar el artículo.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleChangeStatus(status: ArticleStatus) {
    if (!selectedId) return
    setError('')
    setSuccess('')
    try {
      const updated = await changeKbArticleStatus(token, selectedId, status)
      setDetail(updated)
      setSuccess(`Estado cambiado a ${ARTICLE_STATUS_LABELS[status]}.`)
      await loadArticles()
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cambiar el estado.'))
    }
  }

  const isDraft = detail?.status === 'DRAFT' || isNew
  const canEdit = isDraft
  const nextStatuses = detail ? ARTICLE_STATUS_NEXT[detail.status] : []


  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> BASE DE CONOCIMIENTO</p>
          <h1>Gestión de<br /><span>artículos.</span></h1>
          <p className="intro-copy">Crea, edita y publica artículos para la base de conocimiento.</p>
        </div>
        <div className="page-heading-actions">
          <button className="primary-action" type="button" onClick={handleNew}>
            <span aria-hidden="true">+</span> Nuevo artículo
          </button>
        </div>
      </div>

      {error && (
        <div className="page-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>Cerrar</button>
        </div>
      )}
      {success && (
        <div className="page-alert page-alert-success" role="status">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess('')}>Cerrar</button>
        </div>
      )}

      <div className="kb-layout">
        {/* List panel */}
        <div className="kb-list-panel">
          <div className="kb-search">
            <input
              type="search"
              placeholder="Buscar artículos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            />
            <button type="button" className="secondary-action" onClick={() => void handleSearch()}>Buscar</button>
            {searchResults !== null && (
              <button type="button" className="text-action" onClick={() => { setSearchResults(null); setSearchQuery('') }}>
                Limpiar búsqueda
              </button>
            )}
          </div>

          <div className="kb-filters">
            <button
              type="button"
              className={`filter-button${statusFilter === 'ALL' ? ' filter-active' : ''}`}
              onClick={() => setStatusFilter('ALL')}
            >
              Todos
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-button${statusFilter === s ? ' filter-active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {ARTICLE_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="empty-state" role="status">Cargando artículos…</div>
          ) : (
            <ul className="kb-article-list">
              {(searchResults ?? articles).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`kb-article-item${selectedId === item.id ? ' kb-article-selected' : ''}`}
                    onClick={() => void handleSelect(item.id)}
                  >
                    <span className="kb-article-title">{item.title}</span>
                    <span className={`status-label status-${item.status.toLowerCase()}`}>
                      {ARTICLE_STATUS_LABELS[item.status as ArticleStatus]}
                    </span>
                  </button>
                </li>
              ))}
              {(searchResults ?? articles).length === 0 && (
                <li className="empty-state">No se encontraron artículos.</li>
              )}
            </ul>
          )}
        </div>

        {/* Editor panel */}
        <div className="kb-editor-panel">
          {(selectedId !== null || isNew) ? (
            <>
              <div className="kb-editor-header">
                <h2>{isNew ? 'Nuevo artículo' : detail?.title ?? 'Artículo'}</h2>
                {detail && (
                  <span className={`status-label status-${detail.status.toLowerCase()}`}>
                    {ARTICLE_STATUS_LABELS[detail.status]}
                  </span>
                )}
              </div>

              {!canEdit && detail && (
                <div className="page-alert" role="alert">
                  <span>Solo los borradores son editables. Devuelve a borrador para editar.</span>
                </div>
              )}

              <label>
                <span>TÍTULO</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={!canEdit}
                  placeholder="Título del artículo"
                />
              </label>

              <label>
                <span>CONTENIDO (Markdown)</span>
                <div className="kb-editor-tabs">
                  <button type="button" className={!previewMode ? 'tab-active' : ''} onClick={() => setPreviewMode(false)}>Editar</button>
                  <button type="button" className={previewMode ? 'tab-active' : ''} onClick={() => setPreviewMode(true)}>Vista previa</button>
                </div>
                {previewMode ? (
                  <div className="kb-preview">
                    <ReactMarkdown>{editContent}</ReactMarkdown>
                  </div>
                ) : (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    disabled={!canEdit}
                    rows={12}
                    placeholder="Escribe el contenido en Markdown..."
                  />
                )}
              </label>

              <label>
                <span>ETIQUETAS (separadas por coma)</span>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  disabled={!canEdit}
                  placeholder="vpn, red, wifi"
                />
              </label>

              <label>
                <span>VISIBILIDAD</span>
                <select value={editVisibility} onChange={(e) => setEditVisibility(e.target.value)} disabled={!canEdit}>
                  <option value="EMPLOYEE">Empleado</option>
                  <option value="AGENT">Agente</option>
                  <option value="MANAGER">Gerente</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>

              {canEdit && (
                <div className="form-actions">
                  <button className="primary-action" type="button" onClick={() => void handleSave()} disabled={isSaving}>
                    {isSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              )}

              {/* Lifecycle buttons */}
              {detail && (
                <div className="kb-lifecycle">
                  <span className="sidebar-label">CICLO DE VIDA</span>
                  <div className="kb-lifecycle-buttons">
                    {nextStatuses.map((s) => {
                      const needsReviewer = s === 'APPROVED' || s === 'PUBLISHED'
                      if (needsReviewer && role !== 'ADMIN' && role !== 'MANAGER') return null
                      // Backend enforces authorship: hide approve/publish for the author (non-admin)
                      return (
                        <button
                          key={s}
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleChangeStatus(s)}
                        >
                          {ARTICLE_STATUS_LABELS[s]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>Selecciona un artículo de la lista o crea uno nuevo.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}