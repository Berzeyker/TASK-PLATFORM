import { createBrowserRouter } from 'react-router'
import { AdminDashboard } from '../features/admin/AdminDashboard'
import { UsersCategoriesPage } from '../features/admin/UsersCategoriesPage'
import { LoginRoute } from '../features/auth/LoginRoute'
import { allRoles } from '../features/auth/roles'
import { ManagerDashboard } from '../features/dashboard/ManagerDashboard'
import { AgentQueuePlaceholder } from '../features/tickets/AgentQueuePlaceholder'
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
              { element: <RequireRole roles={['EMPLOYEE']} />, children: [{ path: '/portal', element: <EmployeePortal /> }] },
              { element: <RequireRole roles={['AGENT']} />, children: [{ path: '/queue', element: <AgentQueuePlaceholder /> }] },
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
