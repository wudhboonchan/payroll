import { useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />
      
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen w-full min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b h-16 flex items-center px-4 sticky top-0 z-30">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-md"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="ml-4 font-bold text-slate-900">วิราญกร Payroll</div>
        </header>

        <main className="flex-1 pb-8 w-full overflow-x-hidden">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  )
}
