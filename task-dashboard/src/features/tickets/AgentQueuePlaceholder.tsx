/** Stand-in until F-03 (agent queue) is built, so agents can log in without being kicked out. */
export function AgentQueuePlaceholder() {
  return (
    <section className="page-content placeholder-page">
      <p className="eyebrow"><span className="accent-rule" /> COLA DE TICKETS</p>
      <h1>Próximamente.</h1>
      <p className="intro-copy">La cola de trabajo para agentes se está construyendo.</p>
    </section>
  )
}
