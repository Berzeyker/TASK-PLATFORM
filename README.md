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

Flujo de la IA: `Dashboard → Express (/api/v1/kb/troubleshoot) → FastAPI (/api/v1/rag/troubleshoot) → ChromaDB + Groq`.
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

- `seed_db.py` indexa los manuales de `data/seed_manuals.json` (23 artículos, 289 fragmentos)
  en ChromaDB. Sin este paso la colección está vacía y el asistente no responde.
- Cada artículo incluye una lista `symptoms` con las frases con las que los empleados
  describen el problema; se indexan por separado para que una pregunta corta compare
  contra una frase corta y no contra el artículo completo.
- La primera ejecución descarga el modelo de embeddings
  (`paraphrase-multilingual-MiniLM-L12-v2`, ~470 MB) desde Hugging Face.
- Verifica que esté arriba: `http://127.0.0.1:8001/health` debe devolver
  `"indexed_chunks": 146`.

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

Ejemplo mínimo:

```json
{
  "article_id": "KB-012",
  "title": "Cómo resetear la contraseña del Wi-Fi invitado",
  "category": "Redes",
  "content": "Pasos para resetear... 1. ... 2. ...",
  "symptoms": [
    "No puedo conectarme al Wi-Fi de invitados",
    "El Wi-Fi de visitas no funciona"
  ]
}
```

### Opción B — Desde la aplicación (producción)

1. Un agente o administrador crea un artículo en `DRAFT` desde el panel de KB.
2. Lo envía a revisión y un Manager/Admin lo aprueba y publica.
3. El backend llama automáticamente a `syncArticleIndex`, que indexa el artículo en
   ChromaDB. A partir de ese momento la IA ya puede responder sobre ese tema.

### Consejos para que la IA responda bien

- **Título con vocabulario del empleado**, no técnico: "Computadora no enciende" mejor
  que "Falla de encendido en estación de trabajo".
- **Lista `symptoms`** con las frases reales que usaría un empleado (incluye
  sinónimos, typos comunes y variantes).
- **Contenido con pasos numerados y claros**: el modelo los reproduce tal cual.
- **No incluyas datos sensibles** (IPs, contraseñas reales): el sanador los tacha,
  pero mejor no ponerlos.
- **Reindexa** tras cambiar un artículo: `py -3 scripts/seed_db.py` (dev) o
  republica el artículo (prod).

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

## Estado del proyecto

Las tareas pendientes (frontend, backend, IA, infraestructura y documentación) están
detalladas en `TASK_CONTEXT.md`. Lo que aún no está implementado en este repositorio:

- Docker Compose del stack completo y CI (I-01).
- Notificaciones por correo (B-08) y cifrado AES-256-GCM de campos (B-04).
- Pruebas automatizadas (B-01, B-02, I-03, I-04, I-05).
- Evaluación con Ragas y benchmark de latencia (A-06).
- Manual de usuario y documentación final (D-02).
