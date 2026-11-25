# T.A.S.K. — Plataforma de soporte (ITSM + Knowledge Base + IA)

Sistema de mesa de ayuda para la universidad: los empleados crean tickets, los agentes
los resuelven, la base de conocimiento alimenta un asistente RAG que intenta resolver
incidentes de Nivel 1 y, si no tiene una respuesta confiable, escala el caso a un humano.

## Componentes

| Carpeta           | Tecnología                          | Puerto por defecto |
| ----------------- | ----------------------------------- | ------------------ |
| `task-dashboard/` | React 19 + Vite + TypeScript        | `5173`             |
| `backend/`        | Node.js 20 + Express 4 + Prisma 5   | `3000`             |
| `ai-service/`     | Python + FastAPI + ChromaDB + Groq  | `8001`             |

Flujo de la IA: `Dashboard → Express (/api/v1/ai/query) → FastAPI (/api/v1/rag/troubleshoot) → ChromaDB + Groq`. Feedback: `Dashboard → Express (/api/v1/ai/feedback)`.
El frontend nunca llama al microservicio de IA directamente.

## Requisitos

- Node.js 20 o superior (`node --version`).
- Python 3.11 o superior (`py -3 --version` en Windows).
- Una base PostgreSQL (Neon en la nube o Postgres local).
- Una API key gratuita de Groq: <https://console.groq.com/keys>.
  Sin ella el chat funciona, pero **siempre** responderá que debe escalar el caso.

## Puesta en marcha desde cero

### 1. Configurar el backend

```powershell
cd backend
Copy-Item .env.example .env
# Edita .env con tus credenciales de PostgreSQL y tu JWT_SECRET
npm install
npx prisma migrate dev
npm run seed
npm run dev
```

`npm run seed` crea las cuentas de demostración (contraseña `ChangeMe123!`):

| Correo               | Rol      |
| -------------------- | -------- |
| `admin@task.local`    | ADMIN    |
| `agent@task.local`    | AGENT    |
| `manager@task.local`  | MANAGER  |
| `employee@task.local` | EMPLOYEE |

El backend expone `http://localhost:3000/api/v1`.

### 2. Configurar el microservicio de IA

```powershell
cd ai-service
Copy-Item .env.example .env
# Edita .env y coloca tu GROQ_API_KEY
py -3 -m pip install -r requirements.txt
py -3 scripts/seed_db.py
py -3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

- `seed_db.py` indexa los manuales de `data/seed_manuals.json` (35 artículos, 432 fragmentos)
  en ChromaDB. Sin este paso la colección está vacía y el asistente no responde.
- Cada artículo incluye una lista `symptoms` con las frases con las que los empleados
  describen el problema; se indexan por separado para que una pregunta corta compare
  contra una frase corta y no contra el artículo completo.
- La primera ejecución descarga el modelo de embeddings
  (`paraphrase-multilingual-MiniLM-L12-v2`, ~470 MB) desde Hugging Face.
- Verifica que esté arriba: `http://127.0.0.1:8001/health` debe devolver
  `"indexed_chunks": 432`.

### 3. Configurar el dashboard

```powershell
cd task-dashboard
Copy-Item .env.example .env
npm install
npm run dev
```

Abre `http://localhost:5173`, inicia sesión como `employee@task.local` y entra a
**Asistente IA**.

## Cómo funciona la decisión de la IA

1. La consulta se limpia (se tachan IPs, correos y valores de contraseñas/tokens).
2. Se vectoriza y se buscan los fragmentos más parecidos en ChromaDB (similitud coseno).
3. Si la mejor similitud es **menor al umbral** (`SIMILARITY_THRESHOLD`, por defecto
   `0.70`), no se llama al modelo: se responde `resolved_by_ai: false` y se recomienda
   escalar (BR-04).
4. Si supera el umbral, Groq redacta los pasos **usando solo los artículos recuperados**
   y cita la fuente. Si el contexto no alcanza, responde `INSUFFICIENT_CONTEXT` y también
   se escala.

Consecuencia importante: **el asistente solo puede responder sobre los temas que existen
en la base de conocimiento**. Preguntas fuera de esos temas se escalan a propósito.

## Cómo "entrenar" (agregar conocimiento a) la IA

La IA no se entrena en el sentido tradicional: es un sistema **RAG** que responde
usando los artículos publicados en la base de conocimiento. Para que responda sobre
más temas, agrega más artículos. Hay dos formas:

### Opción A — Editar el seed (desarrollo)

1. Abre `ai-service/data/seed_manuals.json`.
2. Agrega un objeto con `article_id`, `title`, `category`, `content` y `symptoms`
   (frases con las que los empleados describen el problema).
3. Ejecuta `py -3 scripts/seed_db.py` (reemplaza todo) o indexa uno solo con
   `POST /api/v1/knowledge/index`.

### Opción B — Desde la aplicación (producción)

1. Un agente o administrador crea un artículo en `DRAFT` desde el panel de KB.
2. Lo envía a revisión y un Manager/Admin lo aprueba y publica.
3. El backend llama automáticamente a `syncArticleIndex`, que indexa el artículo en
   ChromaDB. A partir de ese momento la IA ya puede responder sobre ese tema.

### Consejos para que la IA responda bien

- **Título con vocabulario del empleado**, no técnico.
- **Lista `symptoms`** con las frases reales que usaría un empleado.
- **Contenido con pasos numerados y claros**.
- **No incluyas datos sensibles** (IPs, contraseñas reales).
- **Reindexa** tras cambiar un artículo.

## Rutas y roles

| Ruta | Roles | Descripción |
|---|---|---|
| `/login` | Todos | Inicio de sesión |
| `/portal` | EMPLOYEE | Mis tickets, crear ticket con adjuntos, calificar |
| `/assistant` | Todos | Chat con el asistente de IA (RAG) |
| `/queue` | AGENT, ADMIN | Cola de tickets, tomar, clasificar, resolver, cerrar |
| `/tickets/:id` | AGENT, ADMIN | Detalle de ticket con acciones |
| `/kb` | AGENT, MANAGER, ADMIN | Gestión de base de conocimiento |
| `/dashboard` | MANAGER, ADMIN | Métricas y gráficos |
| `/admin` | ADMIN | Cola de tickets (vista admin) |
| `/admin/users` | ADMIN | Gestión de usuarios y categorías |

## Comandos útiles

```powershell
# Frontend
cd task-dashboard
npm run dev          # desarrollo (http://localhost:5173)
npm run build        # build de producción
npm run lint         # ESLint
npm run test         # Vitest (19 tests)
npm run test:watch   # Vitest en modo watch

# Backend
cd backend
npm run dev          # desarrollo (http://localhost:3000)
npm run build        # compilar TypeScript
npm run migrate      # migraciones Prisma
npm run seed         # seed de usuarios y categorías

# IA
cd ai-service
py -3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
py -3 scripts/seed_db.py   # indexar artículos en ChromaDB
```

## Estado del proyecto

### Implementado

- **F-01** Router, role guards, AuthProvider, apiRequest
- **F-02** Portal de empleado (detalle, adjuntos, polling, calificación, privacidad)
- **F-03** Cola de agentes (acciones, detalle, timeline, reglas de transición)
- **F-04** Campana de notificaciones (polling 30s, dropdown, marcar leído)
- **F-05** Widget de deflexión IA en el formulario de ticket
- **F-06** Quality pass (Vitest, 19 tests, loading/empty/error states)
- **F-07** Gestión de KB (lista, editor Markdown, preview, ciclo de vida)
- **F-08** Dashboard de manager (métricas, gráficos)
- **F-09** Panel de admin (cola, usuarios, categorías)
- **AI RAG** 35 artículos, 432 fragmentos, sanador, seguridad
- **B-05** Gestión de usuarios y categorías (admin)

### Pendiente

- **B-04** Cifrado AES-256-GCM de campos sensibles
- **B-06** Rutas AI gateway en backend (`/ai/query`, `/ai/feedback`)
- **B-07** Sincronización automática de artículos publicados con ChromaDB
- **I-01** Docker Compose del stack completo + CI
- **A-06** Evaluación con Ragas y benchmark de latencia
- **D-02** Manual de usuario y documentación final

## Problemas frecuentes

### El chat dice "El asistente de IA no está disponible"

El microservicio de IA no está corriendo o el backend no lo encuentra. Revisa
`http://127.0.0.1:8001/health` y que `AI_SERVICE_URL` en `backend/.env` apunte al puerto
correcto.

### El chat responde siempre "confianza 0%" o "similitud 0.0"

La caché del modelo de embeddings está corrupta o la colección está vacía.

```powershell
cd ai-service
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\huggingface\hub\models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2"
py -3 scripts/seed_db.py
py -3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

### El chat responde "similitud (0.xx) inferior al umbral"

Es el comportamiento esperado cuando no hay un artículo suficientemente relacionado:
crea el ticket para que un agente lo revise. Si el tema sí está en la base, revisa que el
artículo esté `PUBLISHED` y que se haya reindexado.

## Seguridad

- Los archivos `.env` y `chroma_db/` están en `.gitignore` (no se suben a GitHub).
- Se eliminaron los archivos `__pycache__/*.pyc` del índice de git.
- `backend/.env.example` y `ai-service/.env.example` contienen solo valores placeholder.
- Las cuentas demo (`ChangeMe123!`) son solo para desarrollo. Cámbialas antes de producción.
- El sanador (sanitizer) tacha IPs, correos y valores de contraseñas/tokens antes de que el texto llegue al modelo de IA.
- El backend valida roles en cada endpoint (401/403). El frontend solo es una guardia de UX.