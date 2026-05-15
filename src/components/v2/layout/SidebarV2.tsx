import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../../store/useAppStore'
import { supabase } from '../../../lib/supabase'
import {
  LayoutDashboard, Users, CalendarClock, Calculator,
  CreditCard, FileText, Download, LogOut, Building2,
  Link2, UserCog, ChevronDown, X, Menu, KeyRound
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../ui/dropdown-menu'

interface Factory { id: string; name: string; companies: any }

const NAV = [
  { href: '/v2/dashboard',  label: 'Dashboard',         icon: LayoutDashboard, roles: ['admin','superUser'] },
  { href: '/v2/employees',  label: 'ฐานข้อมูลพนักงาน', icon: Users,           roles: ['admin','superUser'] },
  { href: '/v2/shifts',     label: 'กรอกกะรายวัน',      icon: CalendarClock,   roles: ['admin','superUser'] },
  { href: '/v2/payroll',    label: 'กรอกค่าจ้าง',       icon: Calculator,      roles: ['admin','superUser'] },
  { href: '/v2/advances',   label: 'เบิกล่วงหน้า',      icon: CreditCard,      roles: ['admin','superUser'] },
  { href: '/v2/payslip',    label: 'ดูสลิปเงินเดือน',   icon: FileText,        roles: ['admin','superUser','normalUser'] },
  { href: '/v2/share-links',label: 'ลิงก์สลิป (LINE)',  icon: Link2,           roles: ['admin','superUser','normalUser'] },
  { href: '/v2/export',     label: 'ส่งออกข้อมูล',      icon: Download,        roles: ['admin','superUser'] },
  { href: '/v2/users',      label: 'จัดการผู้ใช้งาน',   icon: UserCog,         roles: ['admin'] },
]

interface SidebarV2Props { isOpen: boolean; setIsOpen: (v: boolean) => void }

export function SidebarV2({ isOpen, setIsOpen }: SidebarV2Props) {
  const { user, companyContext, setUser, setCompanyContext } = useAppStore()
  const location = useLocation()
  const [factories, setFactories] = useState<Factory[]>([])

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'superUser') {
      supabase.from('factories').select('id, name, companies(id, name, short_name, company_type)').order('name')
        .then(({ data }) => { if (data) setFactories(data) })
    }
  }, [user?.role])

  const handleFactoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const f = factories.find(f => f.id === e.target.value)
    if (f && user) {
      const company = Array.isArray(f.companies) ? f.companies[0] : f.companies
      setUser({ ...user, factory_id: f.id })
      setCompanyContext({ id: company?.id || companyContext?.id, name: company?.name || companyContext?.name, type: company?.company_type || companyContext?.type, factoryName: f.name })
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setCompanyContext(null)
  }

  const filtered = NAV.filter(n => !user || n.roles.includes(user.role))

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-40 md:hidden" style={{ background: 'rgba(22,19,17,0.5)' }}
          onClick={() => setIsOpen(false)} />
      )}

      <aside style={{
        position: 'fixed', insetBlock: 0, left: 0, zIndex: 50, width: 'var(--vk-sidebar-w)',
        background: 'var(--vk-bone)', borderRight: '1px solid var(--vk-rule)',
        display: 'flex', flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : undefined,
      }} className={`vk-root hidden md:flex ${isOpen ? '!flex' : ''}`}>

        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--vk-rule-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 style={{ width: 32, height: 32, flexShrink: 0, color: 'var(--vk-persimmon)', padding: 6, background: 'var(--vk-persimmon-tint)', borderRadius: 6 }} />
            <div>
              <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', color: 'var(--vk-ink)' }}>หจก. วิราญกร</div>
              <div style={{ fontFamily: 'var(--vk-thai)', fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 1 }}>Payroll System v2</div>
            </div>
          </div>
          <button className="md:hidden vk-btn vk-btn--ghost" style={{ width: 28, height: 28, padding: 0 }} onClick={() => setIsOpen(false)}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Factory picker */}
        <div style={{ margin: '10px 12px', padding: '10px 12px', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 6 }}>
          <div className="vk-eyebrow" style={{ marginBottom: 3 }}>โรงงาน · บริษัท</div>
          {(user?.role === 'admin' || user?.role === 'superUser') ? (
            <select value={user?.factory_id || ''} onChange={handleFactoryChange}
              style={{ width: '100%', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13, color: 'var(--vk-persimmon-ink)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', outline: 'none' }}>
              <option value="" disabled>เลือกโรงงาน</option>
              {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : (
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-persimmon-ink)' }}>{companyContext?.factoryName || '—'}</div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {filtered.map(item => {
            const active = location.pathname === item.href || location.pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link key={item.href} to={item.href} onClick={() => setIsOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  borderRadius: 6, fontSize: 14, fontWeight: active ? 600 : 500,
                  color: active ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-2)',
                  background: active ? 'var(--vk-persimmon-tint)' : 'transparent',
                  textDecoration: 'none', transition: 'background 160ms', marginBottom: 2,
                }}>
                <Icon style={{ width: 17, height: 17, flexShrink: 0, opacity: active ? 1 : 0.6 }} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* V1 switcher */}
        <div style={{ padding: '0 10px 8px' }}>
          <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)', border: '1px dashed var(--vk-rule-soft)', textDecoration: 'none', background: 'transparent' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 3, background: 'var(--vk-rule-soft)', color: 'var(--vk-ink)', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>1</span>
            กลับ V1 (ปัจจุบัน)
          </a>
        </div>

        {/* User */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--vk-rule-soft)' }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                className="hover:bg-[--vk-paper-2]">
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--vk-persimmon-tint)', color: 'var(--vk-persimmon-ink)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0, fontFamily: 'var(--vk-sans)' }}>
                  {user?.full_name?.charAt(0) || 'U'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.full_name || 'ผู้ใช้งาน'}</div>
                  <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>{user?.role === 'superUser' ? 'SuperAdmin' : user?.role === 'normalUser' ? 'User' : user?.role}</div>
                </div>
                <ChevronDown style={{ width: 14, height: 14, color: 'var(--vk-ink-3)', flexShrink: 0 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-52 mb-1">
              <DropdownMenuItem>
                <Link to="/settings" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <KeyRound style={{ width: 15, height: 15, opacity: 0.5 }} /> เปลี่ยนรหัสผ่าน
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer">
                <LogOut style={{ width: 15, height: 15 }} /> ออกจากระบบ
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  )
}
