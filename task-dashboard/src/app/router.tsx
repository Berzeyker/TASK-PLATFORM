import { createBrowserRouter } from 'react-router'
import { AdminDashboard } from '../features/admin/AdminDashboard'
import { UsersCategoriesPage } from '../features/admin/UsersCategoriesPage'
import { AssistantPage } from '../features/ai-assistant/AssistantPage'
import { LoginRoute } from '../features/auth/LoginRoute'
import { allRoles } from '../features/auth/roles'
import { ManagerDashboard } from '../features/dashboard/ManagerDashboard'
import { QueuePage } from '../features/queue/QueuePage'
import { TicketDetailPage } from '../features/queue/TicketDetailPage'
import { EmployeePortal } from '../features/tickets/EmployeePortal'
import { AppShell } from './AppShell'
import { AppProvider } from './provider'
import { HomeRedirect, RequireRole } from './RequireRole'

export const router = createBrowserRouter([
  {
    element: <AppProvider />,
    children: [
      { path: '/login', element: <LoginRoute /> },
      {
        // any signed-in user gets the shell; each child then narrows by role
        element: <RequireRole roles={allRoles} />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/assistant', element: <AssistantPage /> },
              { element: <RequireRole roles={['EMPLOYEE']} />, children: [{ path: '/portal', element: <EmployeePortal /> }] },
              {
                // PUT /tickets/:id is allowed for agents and admins only
                element: <RequireRole roles={['AGENT', 'ADMIN']} />,
                children: [
                  { path: '/queue', element: <QueuePage /> },
                  { path: '/tickets/:id', element: <TicketDetailPage /> },
                ],
              },
              { element: <RequireRole roles={['MANAGER', 'ADMIN']} />, children: [{ path: '/dashboard', element: <ManagerDashboard /> }] },
              {
                element: <RequireRole roles={['ADMIN']} />,
                children: [
                  { path: '/admin', element: <AdminDashboard /> },
                  { path: '/admin/users', element: <UsersCategoriesPage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <HomeRedirect /> },
    ],
  },
])
