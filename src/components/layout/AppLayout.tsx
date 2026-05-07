import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAppStore } from '../../store/useAppStore'

interface RequireAuthProps {
  allowedRoles?: string[]
}

export function RequireAuth({ allowedRoles }: RequireAuthProps) {
  const { user } = useAppStore()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // If user is logged in but doesn't have permission
    return <Navigate to="/shifts" replace />
  }

  return <Outlet />
}

interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        <main className="flex-1 pb-8">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  )
}
