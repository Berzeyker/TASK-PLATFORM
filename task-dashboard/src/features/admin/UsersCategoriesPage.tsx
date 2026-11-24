import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { allRoles, roleLabels } from '../auth/roles'
import type { UserRole } from '../auth/types'
import {
  createCategory, createUser, getCategories, getUsers, updateCategory, updateUser,
  type AdminCategory, type AdminUser, type UserUpdateInput,
} from './api'
import './UsersCategories.css'

const MIN_PASSWORD = 10

function EditModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ticket-modal admin-edit-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="modal-close" type="button" aria-label="Cerrar" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  )
}

export function UsersCategoriesPage() {
  const { session, user: me } = useAuth()
  const token = session?.accessToken ?? ''
  const [users, setUsers] = useState<AdminUser[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [userError, setUserError] = useState('')
  const [userNotice, setUserNotice] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [isSavingCategory, setIsSavingCategory] = useState(false)

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null)
  const [modalError, setModalError] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getUsers(token), getCategories(token)])
      .then(([userList, categoryList]) => {
        if (cancelled) return
        setUsers(userList)
        setCategories(categoryList)
        setLoadError('')
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error, 'No se pudieron cargar los datos.'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [token, reloadKey])

  function reload() {
    setIsLoading(true)
    setReloadKey((key) => key + 1)
  }

  function openUser(user: AdminUser) { setModalError(''); setEditingUser(user) }
  function openCategory(category: AdminCategory) { setModalError(''); setEditingCategory(category) }
  function closeModals() { if (!isSavingEdit) { setEditingUser(null); setEditingCategory(null) } }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password'))
    setUserNotice('')
    if (password.length < MIN_PASSWORD) {
      setUserError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    setUserError('')
    setIsSavingUser(true)
    try {
      const created = await createUser(token, {
        email: String(data.get('email')).trim().toLowerCase(),
        fullName: String(data.get('fullName')).trim(),
        role: String(data.get('role')) as UserRole,
        password,
      })
      form.reset()
      setUserNotice(`Usuario ${created.email} creado.`)
      reload()
    } catch (error) {
      setUserError(getErrorMessage(error, 'No se pudo crear el usuario.'))
    } finally {
      setIsSavingUser(false)
    }
  }

  async function handleEditUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingUser) return
    const data = new FormData(event.currentTarget)
    const update: UserUpdateInput = {}
    const fullName = String(data.get('fullName')).trim()
    const role = String(data.get('role')) as UserRole
    const isActive = data.get('isActive') === 'on'
    const password = String(data.get('password'))

    if (fullName !== editingUser.fullName) update.fullName = fullName
    if (role !== editingUser.role) update.role = role
    if (isActive !== editingUser.isActive) update.isActive = isActive
    if (password) {
      if (password.length < MIN_PASSWORD) {
        setModalError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
        return
      }
      update.password = password
    }
    if (!Object.keys(update).length) {
      setModalError('No hay cambios para guardar.')
      return
    }

    setModalError('')
    setIsSavingEdit(true)
    try {
      await updateUser(token, editingUser.id, update)
      setEditingUser(null)
      setUserNotice(`Usuario ${editingUser.email} actualizado.`)
      reload()
    } catch (error) {
      setModalError(getErrorMessage(error, 'No se pudo actualizar el usuario.'))
    } finally {
      setIsSavingEdit(false)
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get('name')).trim()
    setCategoryError('')
    setIsSavingCategory(true)
    try {
      await createCategory(token, name)
      form.reset()
      reload()
    } catch (error) {
      setCategoryError(getErrorMessage(error, 'No se pudo crear la categoría.'))
    } finally {
      setIsSavingCategory(false)
    }
  }

  async function saveCategory(category: AdminCategory, update: { name?: string; isActive?: boolean }, onDone?: () => void) {
    setCategoryError('')
    setIsSavingEdit(true)
    try {
      await updateCategory(token, category.id, update)
      onDone?.()
      reload()
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudo actualizar la categoría.')
      if (onDone) setModalError(message)
      else setCategoryError(message)
    } finally {
      setIsSavingEdit(false)
    }
  }

  function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingCategory) return
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    if (name === editingCategory.name) {
      setModalError('No hay cambios para guardar.')
      return
    }
    setModalError('')
    void saveCategory(editingCategory, { name }, () => setEditingCategory(null))
  }

  const activeAdmins = users.filter((user) => user.role === 'ADMIN' && user.isActive).length

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> ADMINISTRACIÓN</p>
          <h1>Usuarios y<br /><span>categorías.</span></h1>
          <p className="intro-copy">Da de alta al personal, edita sus cuentas y mantén el catálogo de categorías de tickets.</p>
        </div>
        <button className="secondary-action" type="button" onClick={reload} disabled={isLoading}>
          {isLoading ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </div>

      {loadError && (
        <div className="page-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={reload}>Reintentar</button>
        </div>
      )}

      <section className="tickets-section" aria-labelledby="users-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CUENTAS</p>
            <h2 id="users-title">Usuarios <span>{users.length}</span></h2>
          </div>
        </div>

        <form className="ticket-form inline-admin-form" onSubmit={handleCreateUser}>
          <label><span>NOMBRE COMPLETO</span><input name="fullName" required minLength={2} autoComplete="off" /></label>
          <label><span>CORREO</span><input name="email" type="email" required autoComplete="off" /></label>
          <label>
            <span>ROL</span>
            <select name="role" defaultValue="EMPLOYEE">
              {allRoles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}
            </select>
          </label>
          <label><span>CONTRASEÑA INICIAL</span><input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" /></label>
          <button className="primary-action" type="submit" disabled={isSavingUser}>
            {isSavingUser ? 'Creando…' : 'Crear usuario'} <span aria-hidden="true">→</span>
          </button>
        </form>
        {userError && <p className="form-error" role="alert">{userError}</p>}
        {userNotice && <p className="admin-success" role="status">{userNotice}</p>}

        <div className="admin-table" role="table" aria-label="Usuarios">
          <div className="admin-table-row admin-table-head" role="row" aria-hidden="true">
            <span>NOMBRE</span><span>CORREO</span><span>ROL</span><span>ESTADO</span><span />
          </div>
          {isLoading && !users.length ? (
            <div className="empty-state" role="status">Cargando usuarios…</div>
          ) : users.length ? (
            users.map((user) => (
              <div className={`admin-table-row${user.isActive ? '' : ' row-inactive'}`} role="row" key={user.id}>
                <span role="cell"><strong>{user.fullName}</strong>{user.id === me?.id && <small className="you-tag"> (tú)</small>}</span>
                <span role="cell">{user.email}</span>
                <span role="cell">{roleLabels[user.role]}</span>
                <span role="cell" className={user.isActive ? 'user-active' : 'user-inactive'}>{user.isActive ? 'Activo' : 'Inactivo'}</span>
                <span role="cell" className="row-actions">
                  <button className="text-action" type="button" onClick={() => openUser(user)} aria-label={`Editar a ${user.fullName}`}>Editar</button>
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state"><h3>Aún no hay usuarios</h3></div>
          )}
        </div>
      </section>

      <section className="tickets-section" aria-labelledby="categories-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CLASIFICACIÓN</p>
            <h2 id="categories-title">Categorías <span>{categories.length}</span></h2>
          </div>
        </div>
        <form className="ticket-form inline-admin-form" onSubmit={handleCreateCategory}>
          <label><span>NUEVA CATEGORÍA</span><input name="name" required minLength={2} autoComplete="off" /></label>
          <button className="primary-action" type="submit" disabled={isSavingCategory}>
            {isSavingCategory ? 'Creando…' : 'Agregar categoría'} <span aria-hidden="true">→</span>
          </button>
        </form>
        {categoryError && <p className="form-error" role="alert">{categoryError}</p>}

        <div className="admin-table" role="table" aria-label="Categorías">
          {categories.map((category) => (
            <div className={`admin-table-row category-row${category.isActive ? '' : ' row-inactive'}`} role="row" key={category.id}>
              <span role="cell"><strong>{category.name}</strong></span>
              <span role="cell" className={category.isActive ? 'user-active' : 'user-inactive'}>{category.isActive ? 'Activa' : 'Inactiva'}</span>
              <span role="cell" className="row-actions">
                <button className="text-action" type="button" onClick={() => openCategory(category)} aria-label={`Renombrar ${category.name}`}>Renombrar</button>
                <button
                  className="text-action"
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => void saveCategory(category, { isActive: !category.isActive })}
                  aria-label={`${category.isActive ? 'Desactivar' : 'Activar'} ${category.name}`}
                >
                  {category.isActive ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </div>
          ))}
        </div>
        <p className="list-footnote">Las categorías no se eliminan: al desactivarlas dejan de ofrecerse en tickets nuevos, pero los existentes las conservan.</p>
      </section>

      {editingUser && (
        <EditModal title={`Editar a ${editingUser.fullName}`} onClose={closeModals}>
          {/* key forces fresh defaults when switching between users */}
          <form className="ticket-form" key={editingUser.id} onSubmit={handleEditUser}>
            <label><span>NOMBRE COMPLETO</span><input name="fullName" defaultValue={editingUser.fullName} required minLength={2} autoFocus /></label>
            <label>
              <span>ROL</span>
              <select name="role" defaultValue={editingUser.role} disabled={editingUser.id === me?.id}>
                {allRoles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}
              </select>
            </label>
            <label className="check-field">
              <input name="isActive" type="checkbox" defaultChecked={editingUser.isActive} disabled={editingUser.id === me?.id || (editingUser.role === 'ADMIN' && editingUser.isActive && activeAdmins <= 1)} />
              <span>CUENTA ACTIVA</span>
            </label>
            {editingUser.id === me?.id && <p className="admin-closed-note">No puedes desactivar tu cuenta ni cambiar tu rol.</p>}
            <label>
              <span>NUEVA CONTRASEÑA <small>OPCIONAL · SE DESBLOQUEA LA CUENTA</small></span>
              <input name="password" type="password" minLength={MIN_PASSWORD} autoComplete="new-password" placeholder="Déjala vacía para no cambiarla" />
            </label>
            {modalError && <p className="form-error" role="alert">{modalError}</p>}
            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={closeModals} disabled={isSavingEdit}>Cancelar</button>
              <button className="primary-action" type="submit" disabled={isSavingEdit}>{isSavingEdit ? 'Guardando…' : 'Guardar cambios'} <span aria-hidden="true">→</span></button>
            </div>
          </form>
        </EditModal>
      )}

      {editingCategory && (
        <EditModal title="Renombrar categoría" onClose={closeModals}>
          <form className="ticket-form" key={editingCategory.id} onSubmit={handleRenameCategory}>
            <label><span>NOMBRE</span><input name="name" defaultValue={editingCategory.name} required minLength={2} autoFocus /></label>
            {modalError && <p className="form-error" role="alert">{modalError}</p>}
            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={closeModals} disabled={isSavingEdit}>Cancelar</button>
              <button className="primary-action" type="submit" disabled={isSavingEdit}>{isSavingEdit ? 'Guardando…' : 'Guardar'} <span aria-hidden="true">→</span></button>
            </div>
          </form>
        </EditModal>
      )}
    </section>
  )
}
