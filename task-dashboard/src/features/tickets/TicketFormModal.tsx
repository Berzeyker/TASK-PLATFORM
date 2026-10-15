import type { FormEvent } from 'react'
import type { Category } from './types'

type TicketFormModalProps = {
  categories: Category[]
  error: string
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function TicketFormModal({
  categories,
  error,
  isSubmitting,
  onClose,
  onSubmit,
}: TicketFormModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow"><span className="accent-rule" /> NUEVA SOLICITUD</p>
            <h2 id="new-ticket-title">¿En qué podemos<br />ayudarte?</h2>
          </div>
          <button className="modal-close" type="button" aria-label="Cerrar formulario" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy">Cuéntanos qué ocurre. Nuestro equipo revisará tu solicitud.</p>
        <form className="ticket-form" onSubmit={onSubmit}>
          <label>
            <span>ASUNTO</span>
            <input name="title" type="text" minLength={5} maxLength={150} placeholder="Ej. No puedo acceder a mi correo" required />
          </label>
          <label>
            <span>CATEGORÍA</span>
            <select name="categoryId" defaultValue="" required>
              <option value="" disabled>Selecciona una categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>DESCRIPCIÓN</span>
            <textarea name="description" minLength={10} rows={4} placeholder="Describe el problema y qué estabas intentando hacer…" required />
          </label>
          <label>
            <span>DISPOSITIVO <small>OPCIONAL</small></span>
            <input name="device" type="text" placeholder="Ej. Laptop de oficina" />
          </label>
          <label>
            <span>UBICACIÓN <small>OPCIONAL</small></span>
            <input name="location" type="text" placeholder="Ej. Piso 2, oficina norte" />
          </label>
          <div className="form-actions">
            <button className="secondary-action" type="button" onClick={onClose} disabled={isSubmitting}>Cancelar</button>
            <button className="primary-action" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando…' : 'Enviar solicitud'} <span aria-hidden="true">→</span>
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="form-note">Al enviar, tu solicitud aparecerá en “Mis solicitudes”.</p>
        </form>
      </section>
    </div>
  )
}
