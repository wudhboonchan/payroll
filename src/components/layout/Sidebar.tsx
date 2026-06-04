import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { supabase } from '../../lib/supabase'
import { toast } from 'sonner'
import {
  LayoutDashboard, Users, CalendarClock, Calculator,
  CreditCard, FileText, Download, LogOut,
  Link2, UserCog, ChevronDown, X, Menu, KeyRound, Eye, EyeOff,
  ClipboardList
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface Factory { id: string; name: string; companies: any }

const NAV = [
  { href: '/dashboard',  label: 'Dashboard',         icon: LayoutDashboard, roles: ['admin','superUser'] },
  { href: '/employees',  label: 'ฐานข้อมูลพนักงาน', icon: Users,           roles: ['admin','superUser'] },
  { href: '/shifts',     label: 'กรอกกะรายวัน',      icon: CalendarClock,   roles: ['admin','superUser'] },
  { href: '/advances',   label: 'เบิกล่วงหน้า',      icon: CreditCard,      roles: ['admin','superUser'] },
  { href: '/payroll',    label: 'กรอกค่าจ้าง',       icon: Calculator,      roles: ['admin','superUser'] },
  { href: '/payslip',    label: 'ดูสลิปเงินเดือน',   icon: FileText,        roles: ['admin','superUser','normalUser'] },
  { href: '/employee-summary', label: 'สรุปภาพรวมพนักงาน', icon: ClipboardList, roles: ['admin','superUser','normalUser'] },
  { href: '/share-links',label: 'ลิงก์สลิปพนักงาน',  icon: Link2,           roles: ['admin','superUser','normalUser'] },
  { href: '/export',     label: 'ส่งออกข้อมูล',      icon: Download,        roles: ['admin','superUser','normalUser'] },
  { href: '/users',      label: 'จัดการผู้ใช้งาน',   icon: UserCog,         roles: ['admin'] },
]

interface SidebarProps { isOpen: boolean; setIsOpen: (v: boolean) => void }

export function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const { user, companyContext, setUser, setCompanyContext } = useAppStore()
  const location = useLocation()
  const [factories, setFactories] = useState<Factory[]>([])
  const [showPwModal, setShowPwModal] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

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

  const handleChangePassword = async () => {
    setPwError('')
    if (!pwForm.next || !pwForm.confirm) { setPwError('กรุณากรอกรหัสผ่านใหม่'); return }
    if (pwForm.next.length < 6) { setPwError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('รหัสผ่านใหม่ไม่ตรงกัน'); return }
    setPwLoading(true)
    try {
      // Re-authenticate first to verify current password
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.email) throw new Error('ไม่พบข้อมูลผู้ใช้')
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: session.user.email, password: pwForm.current })
      if (signInErr) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง')
      const { error } = await supabase.auth.updateUser({ password: pwForm.next })
      if (error) throw error
      toast.success('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว')
      setShowPwModal(false)
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e: any) {
      setPwError(e.message)
    } finally {
      setPwLoading(false)
    }
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
      }} className={`vk-root flex-col hidden md:flex ${isOpen ? '!flex' : ''}`}>

        {/* Brand */}
        <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid var(--vk-rule-soft)', position: 'relative', overflow: 'hidden' }}>
          {/* Giant tilted logo — purely decorative, clipped by overflow:hidden */}
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: -28,
              top: '50%',
              transform: 'translateY(-50%) rotate(35deg)',
              width: 116,
              height: 116,
              objectFit: 'contain',
              opacity: 0.18,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: 'var(--vk-ink)', lineHeight: 1.1 }}>วิราญกร</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 11, fontWeight: 500, color: 'var(--vk-ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>Payroll System</div>
          </div>
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

        {/* User */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--vk-rule-soft)' }}>
          <DropdownMenu>
            <DropdownMenuTrigger style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              className="hover:bg-[--vk-paper-2]">
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--vk-persimmon-tint)', color: 'var(--vk-persimmon-ink)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0, fontFamily: 'var(--vk-sans)' }}>
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.full_name || 'ผู้ใช้งาน'}</div>
                <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>{user?.role === 'superUser' ? 'SuperAdmin' : user?.role === 'normalUser' ? 'User' : user?.role}</div>
              </div>
              <ChevronDown style={{ width: 14, height: 14, color: 'var(--vk-ink-3)', flexShrink: 0 }} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-52 mb-1">
              <DropdownMenuItem onClick={() => { setShowPwModal(true); setPwError(''); setPwForm({ current: '', next: '', confirm: '' }) }} className="flex items-center gap-2 cursor-pointer">
                <KeyRound style={{ width: 15, height: 15, opacity: 0.5 }} /> เปลี่ยนรหัสผ่าน
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer">
                <LogOut style={{ width: 15, height: 15 }} /> ออกจากระบบ
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Change Password Modal ── */}
      {showPwModal && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(22,19,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowPwModal(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>เปลี่ยนรหัสผ่าน</div>
                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 1 }}>กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่</div>
              </div>
              <button onClick={() => setShowPwModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', opacity: 0.6, padding: 4 }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'รหัสผ่านปัจจุบัน', key: 'current' },
                { label: 'รหัสผ่านใหม่', key: 'next' },
                { label: 'ยืนยันรหัสผ่านใหม่', key: 'confirm' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--vk-ink-3)', marginBottom: 5 }}>{f.label}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={(pwForm as any)[f.key]}
                      onChange={e => setPwForm(p => ({ ...p, [f.key]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                      style={{ width: '100%', height: 36, padding: '0 36px 0 10px', fontSize: 13, fontFamily: 'var(--vk-sans)', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', boxSizing: 'border-box' }}
                    />
                    {f.key === 'next' && (
                      <button onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', padding: 0 }}>
                        {showPw ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {pwError && (
                <div style={{ padding: '8px 12px', background: 'var(--vk-crimson-tint)', border: '1px solid var(--vk-crimson)', fontSize: 12, color: 'var(--vk-crimson)' }}>
                  {pwError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', gap: 8 }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }} onClick={handleChangePassword} disabled={pwLoading}>
                {pwLoading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
              </button>
              <button className="vk-btn" onClick={() => setShowPwModal(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
