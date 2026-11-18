import { useEffect, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../auth/api'
import { useAuth } from '../auth/auth-context'
import { allRoles, roleLabels } from '../auth/roles'
import type { UserRole } from '../auth/types'
import type { Category } from '../tickets/types'
import { createCategory, createUser, getCategories, getUsers, type AdminUser } from './api'
import './UsersCategories.css'

const MIN_PASSWORD = 10

export function UsersCategoriesPage() {
  const { session } = useAuth()
  const token = session?.accessToken ?? ''
  const [users, setUsers] = useState<AdminUser[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [userError, setUserError] = useState('')
  const [userNotice, setUserNotice] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [isSavingCategory, setIsSavingCategory] = useState(false)

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

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="accent-rule" /> ADMINISTRACIÓN</p>
          <h1>Usuarios y<br /><span>categorías.</span></h1>
          <p className="intro-copy">Da de alta al personal y mantén el catálogo de categorías de tickets.</p>
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
            <span>NOMBRE</span><span>CORREO</span><span>ROL</span><span>ESTADO</span>
          </div>
          {isLoading && !users.length ? (
            <div className="empty-state" role="status">Cargando usuarios…</div>
          ) : users.length ? (
            users.map((user) => (
              <div className="admin-table-row" role="row" key={user.id}>
                <span role="cell"><strong>{user.fullName}</strong></span>
                <span role="cell">{user.email}</span>
                <span role="cell">{roleLabels[user.role]}</span>
                <span role="cell" className={user.isActive ? 'user-active' : 'user-inactive'}>{user.isActive ? 'Activo' : 'Inactivo'}</span>
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
        <ul className="category-chips">
          {categories.map((category) => <li key={category.id}>{category.name}</li>)}
        </ul>
      </section>
    </section>
  )
}
