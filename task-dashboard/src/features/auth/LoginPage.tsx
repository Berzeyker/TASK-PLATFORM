import type { FormEvent } from 'react'

type LoginPageProps = {
  error: string
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function LoginPage({ error, isSubmitting, onSubmit }: LoginPageProps) {
  return (
    <main className="login-page">
      <div className="login-topbar">
        <a className="brand" href="/" aria-label="TASK, inicio">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span className="brand-name">T.A.S.K.</span>
        </a>
        <span className="login-top-note">PORTAL DEL TRABAJADOR</span>
      </div>

      <div className="login-layout">
        <section className="login-manifesto">
          <p className="eyebrow"><span className="accent-rule" /> SOPORTE INTERNO</p>
          <h1>El problema<br />no tiene que<br /><span>detenerte.</span></h1>
          <p>Tienes algun problema reportalo aquí.</p>
          <span className="login-index" aria-hidden="true">01 / 01</span>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <div>
            <p className="eyebrow">ACCESO SEGURO</p>
            <h2 id="login-title">Bienvenido<br />de vuelta.</h2>
            <p className="login-instruction">Inicia sesión con tu cuenta de trabajador.</p>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="login-field">
              <span>CORREO DE TRABAJADOR</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="nombre@empresa.com"
                required
              />
            </label>
            <label className="login-field">
              <span>CONTRASEÑA</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Ingresa tu contraseña"
                required
              />
            </label>

            {error && <p className="login-error" role="alert">{error}</p>}

            <button className="login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Validando acceso…' : 'Iniciar sesión'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="login-support">
            ¿No puedes entrar? <a href="mailto:soporte@task.local">Contacta a soporte</a>
          </p>
          <p className="login-security">
            <span aria-hidden="true">●</span> Tu conexión está protegida
          </p>
        </section>
      </div>

      <footer className="login-footer">
        <span>T.A.S.K. <span className="footer-separator">/</span> SOPORTE 24/7</span>
        <span>SOLO PERSONAL AUTORIZADO</span>
      </footer>
    </main>
  )
}
