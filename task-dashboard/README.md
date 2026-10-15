# TASK Dashboard

Portal para que los trabajadores inicien sesión, creen solicitudes de soporte y consulten sus tickets.

## Tecnologías

- React y TypeScript
- Vite
- API REST de Express en `http://localhost:3000`

## Desarrollo local

Ejecuta los comandos desde la raíz del repositorio.

1. Inicia PostgreSQL y crea `backend/.env` a partir de [backend/.env.example](../backend/.env.example), con los datos de conexión de tu base.
2. En una terminal, inicia el backend:

   ```powershell
   cd backend
   npm install
   npm run migrate
   npm run seed
   npm run dev
   ```

3. En otra terminal, inicia el frontend:

   ```powershell
   cd task-dashboard
   npm install
   npm run dev
   ```

Abre `http://localhost:5173`. El frontend usa `http://localhost:3000` como URL predeterminada de la API. Para cambiarla, crea `task-dashboard/.env` basándote en `.env.example`.

El script de seed crea la cuenta de desarrollo `employee@task.local` con contraseña `ChangeMe123!`. Es solo para desarrollo; cambia o elimina estas credenciales antes de usar datos reales.

## Comandos

- `npm run dev`: servidor de desarrollo.
- `npm run build`: verificación de TypeScript y build de producción.
- `npm run lint`: ESLint.
