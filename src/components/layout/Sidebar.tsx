import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'
import {
  LayoutDashboard,
  Users,
  CalendarClock,
  Calculator,
  CreditCard,
  FileText,
  Download,
  LogOut,
  Building2,
  Settings,
  Link2
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { supabase } from '../../lib/supabase'

export function Sidebar() {
  const { user, companyContext, setUser, setCompanyContext } = useAppStore()
  const location = useLocation()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setCompanyContext(null)
  }

  const navItems = [
    {
      title: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'ฐานข้อมูลพนักงาน',
      href: '/employees',
      icon: Users,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'กรอกกะ',
      href: '/shifts',
      icon: CalendarClock,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'กรอกค่าจ้าง',
      href: '/payroll',
      icon: Calculator,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'เบิกล่วงหน้า',
      href: '/advances',
      icon: CreditCard,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'ดูสลิปเงินเดือน',
      href: '/payslip',
      icon: FileText,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'สร้างลิงก์ดูสลิป',
      href: '/share-links',
      icon: Link2,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'Export ข้อมูล',
      href: '/export',
      icon: Download,
      roles: ['admin', 'superUser']
    },
    {
      title: 'ตั้งค่าระบบ',
      href: '/settings',
      icon: Settings,
      roles: ['admin', 'superUser']
    }
  ]

  const filteredNav = navItems.filter(item =>
    !user || item.roles.includes(user.role)
  )

  return (
    <div className="w-64 border-r bg-white h-screen flex flex-col fixed left-0 top-0">
      <div className="px-5 py-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-[#1D9E75] rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
            <Building2 className="text-white h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-xl text-slate-900 leading-none tracking-tight">หจก. วิราญกร</p>
            <p className="text-[10px] text-slate-400 mt-1 font-medium">ระบบจัดการค่าแรงพนักงาน</p>
          </div>
        </div>
        <div className="mt-5 bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">โรงงาน</p>
          <p className="text-sm font-bold text-[#1D9E75] mt-0.5">ผลิตภัณฑ์ตราเพชร</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 space-y-1">
        {filteredNav.map((item) => {
          const isActive = location.pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-[#1D9E75]/10 text-[#1D9E75]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive ? "text-[#1D9E75]" : "text-slate-400")} />
              {item.title}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-100">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium text-sm">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">
              {user?.full_name || 'ผู้ใช้งาน'}
            </p>
            <p className="text-xs text-slate-500 truncate capitalize">
              {user?.role === 'superUser' ? 'SuperAdmin' : user?.role === 'normalUser' ? 'User' : user?.role}
            </p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center w-full gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-5 w-5 text-slate-400 group-hover:text-red-600" />
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
