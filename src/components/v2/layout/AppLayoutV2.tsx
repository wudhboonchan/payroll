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
  if (!user) return <Navigate to="/v2/login" state={{ from: location }} replace />
  if (allowedRoles && !allowedRoles.includes(user.role))
    return <Navigate to={user.role === 'normalUser' ? '/v2/payslip' : '/v2/dashboard'} replace />
  return <Outlet context={ctx} />
}

function VKFooter() {
  return (
    <footer style={{
      borderTop: '1px solid var(--vk-rule-soft)',
      backgroundColor: 'var(--vk-paper)',
      padding: '12px 24px',
      textAlign: 'center',
      fontSize: 11,
      color: 'var(--vk-ink-4)',
      fontFamily: 'var(--vk-sans)',
      letterSpacing: '0.02em',
      flexShrink: 0,
    }}>
      © 2026 Virankorn. All rights reserved.
      <span style={{ margin: '0 8px', color: 'var(--vk-rule-soft)' }}>|</span>
      Powered with ❤︎ by Wudh Boonchan
    </footer>
  )
}

export function AppLayoutV2() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="vk-root" style={{ display: 'flex', height: '100vh' }}>
      <SidebarV2 isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      <div className="vk-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <Outlet context={{ onMenuClick: () => setSidebarOpen(true) }} />
        <VKFooter />
      </div>
    </div>
  )
}
