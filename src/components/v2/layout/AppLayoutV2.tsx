import { useState } from 'react'
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { useAppStore } from '../../../store/useAppStore'
import { SidebarV2 } from './SidebarV2'
import '../../../styles/v2-tokens.css'

interface RequireAuthV2Props { allowedRoles?: string[] }

export function RequireAuthV2({ allowedRoles }: RequireAuthV2Props) {
  const { user } = useAppStore()
  const location = useLocation()
  const ctx = useOutletContext()
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (allowedRoles && !allowedRoles.includes(user.role))
    return <Navigate to={user.role === 'normalUser' ? '/v2/payslip' : '/v2/dashboard'} replace />
  return <Outlet context={ctx} />
}

export function AppLayoutV2() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="vk-root" style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarV2 isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      <div style={{ flex: 1, marginLeft: 'var(--vk-sidebar-w)', display: 'flex', flexDirection: 'column', minWidth: 0 }} className="md:ml-[248px] ml-0">
        <Outlet context={{ onMenuClick: () => setSidebarOpen(true) }} />
      </div>
    </div>
  )
}
