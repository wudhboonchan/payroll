import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
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
  KeyRound,
  Link2,
  ChevronDown,
  X
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { supabase } from '../../lib/supabase'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface SidebarProps {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
}

export function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const { user, companyContext, setUser, setCompanyContext } = useAppStore()
  const location = useLocation()
  const [factories, setFactories] = useState<any[]>([])

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'superUser') {
      const fetchFactories = async () => {
        const { data } = await supabase
          .from('factories')
          .select('id, name, companies(id, name, short_name, company_type)')
          .order('name')
        if (data) setFactories(data)
      }
      fetchFactories()
    }
  }, [user?.role])

  const handleFactoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFactoryId = e.target.value
    const selectedFactory = factories.find(f => f.id === newFactoryId)
    
    if (selectedFactory && user) {
      const company = Array.isArray(selectedFactory.companies) 
        ? selectedFactory.companies[0] 
        : selectedFactory.companies;

      setUser({ ...user, factory_id: newFactoryId })
      setCompanyContext({
        id: company?.id || companyContext?.id,
        name: company?.name || companyContext?.name,
        type: company?.company_type || companyContext?.type,
        factoryName: selectedFactory.name
      })
    }
  }

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
      title: 'ภาพรวมการเข้างาน',
      href: '/attendance',
      icon: LayoutDashboard,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'เบิกล่วงหน้า',
      href: '/advances',
      icon: CreditCard,
      roles: ['admin', 'superUser', 'normalUser']
    },
    {
      title: 'กรอกค่าจ้าง',
      href: '/payroll',
      icon: Calculator,
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
    }
  ]

  const filteredNav = navItems.filter(item =>
    !user || item.roles.includes(user.role)
  )

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r flex flex-col transform transition-transform duration-200 ease-in-out md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-5 py-6 border-b border-slate-100 flex justify-between items-start">
          <div>
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
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">โรงงาน / สาขา</p>
              {(user?.role === 'admin' || user?.role === 'superUser') ? (
                <select
                  value={user?.factory_id || ''}
                  onChange={handleFactoryChange}
                  className="w-full text-sm font-bold text-[#1D9E75] bg-transparent border-none p-0 focus:ring-0 cursor-pointer"
                >
                  <option value="" disabled>เลือกโรงงาน</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-bold text-[#1D9E75]">{companyContext?.factoryName || 'ไม่พบข้อมูลโรงงาน'}</p>
              )}
            </div>
          </div>
          
          <button 
            className="md:hidden text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-md"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

      <nav className="flex-1 overflow-y-auto px-4 space-y-1">
        {filteredNav.map((item) => {
          const isActive = location.pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setIsOpen(false)}
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
        <DropdownMenu>
          <DropdownMenuTrigger>
            <div className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors group cursor-pointer">
              <div className="h-8 w-8 rounded-full bg-[#1D9E75]/10 flex items-center justify-center text-[#1D9E75] font-bold text-sm flex-shrink-0">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {user?.full_name || 'ผู้ใช้งาน'}
                </p>
                <p className="text-xs text-slate-500 truncate capitalize">
                  {user?.role === 'superUser' ? 'SuperAdmin' : user?.role === 'normalUser' ? 'User' : user?.role}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 flex-shrink-0" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52 mb-1">
            <DropdownMenuItem>
              <Link to="/settings" onClick={() => setIsOpen(false)} className="flex items-center gap-2 cursor-pointer">
                <KeyRound className="w-4 h-4 text-slate-400" />
                เปลี่ยนรหัสผ่าน
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              ออกจากระบบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    </>
  )
}
