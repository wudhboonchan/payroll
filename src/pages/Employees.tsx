import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Search, Plus, User, FileUp, AlertCircle, Filter, ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react'
import { formatThaiCurrency } from '../lib/formatters'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { formatEmployeeName } from '../lib/formatters'
import EmployeeFormModal from './EmployeeFormModal'
import EmployeeImportModal from '../components/employees/EmployeeImportModal'

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix: string
  nationality: string
  status: string
  rate_per_12h: number
  payment_method: string
  bank_name: string
  bank_account: string
  position: string
  data_complete: boolean
}

export default function Employees() {
  const { user } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [showInactiveOnly, setShowInactiveOnly] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)

  type SortCol = 'employee_code' | 'name' | 'nationality' | 'rate' | 'payment_method' | 'position'
  const [sortCol, setSortCol] = useState<SortCol>('employee_code')
  const [sortAsc, setSortAsc] = useState(true)

  const POSITIONS: Record<string, string> = {
    worker: 'พนักงานทั่วไป',
    clerk: 'เสมียน',
    foreman: 'หัวหน้างาน',
    office: 'พนักงานออฟฟิศ',
    manager: 'ผู้จัดการ',
  }

  // Fetch current period
  const { data: currentPeriod } = useQuery({
    queryKey: ['current-period', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return null
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('factory_id', user.factory_id)
        .eq('status', 'draft')
        .order('period_end', { ascending: false })
        .limit(1)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!user?.factory_id
  })

  // Fetch employees
  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('factory_id', user.factory_id)
        .order('employee_code', { ascending: true })

      if (error) throw error
      return data as Employee[]
    },
    enabled: !!user?.factory_id
  })

  const filteredEmployees = employees?.filter(emp => {
    const matchesSearch =
      (emp.employee_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(searchTerm.toLowerCase())

    if (showPendingOnly) {
      return matchesSearch && emp.data_complete === false
    }

    if (showInactiveOnly) {
      return matchesSearch && emp.status === 'inactive'
    }

    // Hide inactive employees by default unless the user is actively searching
    if (searchTerm.trim() === '' && emp.status === 'inactive') {
      return false
    }

    return matchesSearch
  }) || []

  const sortedEmployees = [...filteredEmployees].sort((a, b) => {
    let valA: string | number;
    let valB: string | number;

    switch (sortCol) {
      case 'name':
        valA = formatEmployeeName(a);
        valB = formatEmployeeName(b);
        break;
      case 'rate':
        valA = Number(a.rate_per_12h || 0);
        valB = Number(b.rate_per_12h || 0);
        break;
      case 'employee_code':
        valA = a.employee_code || '';
        valB = b.employee_code || '';
        break;
      case 'nationality':
        valA = a.nationality || '';
        valB = b.nationality || '';
        break;
      case 'payment_method':
        valA = a.payment_method || '';
        valB = b.payment_method || '';
        break;
      case 'position':
        valA = a.position || '';
        valB = b.position || '';
        break;
      default:
        valA = '';
        valB = '';
    }
    
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  })

  const pendingCount = employees?.filter(emp => emp.data_complete === false).length || 0
  const inactiveCount = employees?.filter(emp => emp.status === 'inactive').length || 0

  const handleEdit = (id: string) => {
    setSelectedEmployeeId(id)
    setIsModalOpen(true)
  }

  const handleCreate = () => {
    setSelectedEmployeeId(null)
    setIsModalOpen(true)
  }

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(col)
      setSortAsc(true)
    }
  }

  const renderSortIcon = (col: SortCol) => {
    if (sortCol !== col) return <ArrowUpDown className="ml-1 w-3 h-3 text-slate-300" />
    return sortAsc 
      ? <ArrowUp className="ml-1 w-3 h-3 text-[#1D9E75]" />
      : <ArrowDown className="ml-1 w-3 h-3 text-[#1D9E75]" />
  }

  return (
    <>
      <TopBar
        title="ฐานข้อมูลพนักงาน"
        action={
          <div className="bg-white border border-slate-200 px-5 py-2 rounded-full shadow-sm flex items-center min-h-[42px]">
            <span className="text-[15px] font-bold text-slate-700">
              งวด: {currentPeriod ? (
                (() => {
                  const start = new Date(currentPeriod.period_start)
                  const end = new Date(currentPeriod.period_end)
                  const thaiYear = start.getFullYear() + 543
                  return format(start, 'MMMM', { locale: th }) === format(end, 'MMMM', { locale: th })
                    ? `${format(start, 'd', { locale: th })} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                    : `${format(start, 'd MMMM', { locale: th })} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                })()
              ) : (
                'ยังไม่ได้สร้างงวด'
              )}
            </span>
          </div>
        }
      />

      <div className="p-4 md:p-8">
        <div className="flex flex-col mb-4 md:mb-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="ค้นหารหัส หรือชื่อพนักงาน..."
                className="pl-9 bg-white h-10 shadow-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setIsImportOpen(true)}
                className="border-slate-200 text-slate-600 hover:bg-slate-50 h-10 shadow-sm"
              >
                <FileUp className="w-4 h-4 mr-2" />
                นำเข้า Excel
              </Button>

              <Button onClick={handleCreate} className="bg-[#1D9E75] hover:bg-[#157a5a] h-10 shadow-sm px-5">
                <Plus className="w-4 h-4 mr-2" />
                เพิ่มพนักงาน
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-4">
          <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3">
            <Button
              variant={showPendingOnly ? "default" : "outline"}
              onClick={() => {
                setShowPendingOnly(!showPendingOnly)
                if (!showPendingOnly) setShowInactiveOnly(false)
              }}
              className={showPendingOnly
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-200 font-semibold"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}
            >
              <Filter className="w-4 h-4 mr-2" />
              เฉพาะที่ต้องอัปเดต (Pending)
              {pendingCount > 0 && (
                <span className="ml-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </Button>

            <Button
              variant={showInactiveOnly ? "default" : "outline"}
              onClick={() => {
                setShowInactiveOnly(!showInactiveOnly)
                if (!showInactiveOnly) setShowPendingOnly(false)
              }}
              className={showInactiveOnly
                ? "bg-slate-200 text-slate-800 hover:bg-slate-300 border-slate-300 font-semibold"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}
            >
              <Filter className="w-4 h-4 mr-2" />
              พนักงานพ้นสภาพ
              {inactiveCount > 0 && (
                <span className="ml-2 bg-slate-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {inactiveCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('employee_code')}>
                    <div className="flex items-center">รหัส {renderSortIcon('employee_code')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('name')}>
                    <div className="flex items-center">ชื่อ-นามสกุล {renderSortIcon('name')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('nationality')}>
                    <div className="flex items-center">สัญชาติ {renderSortIcon('nationality')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('rate')}>
                    <div className="flex items-center">ค่าแรง/เงินเดือน {renderSortIcon('rate')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('payment_method')}>
                    <div className="flex items-center">การรับเงิน {renderSortIcon('payment_method')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleSort('position')}>
                    <div className="flex items-center">กลุ่มงาน {renderSortIcon('position')}</div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      กำลังโหลดข้อมูล...
                    </TableCell>
                  </TableRow>
                ) : sortedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      ไม่พบข้อมูลพนักงาน
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedEmployees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => handleEdit(emp.id)}
                    >
                      <TableCell className="font-medium text-slate-900">{emp.employee_code}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                            <User className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">{formatEmployeeName(emp)}</span>
                            {emp.data_complete === false && (
                              <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1 mt-0.5 bg-amber-50 w-fit px-1.5 py-0.5 rounded">
                                <AlertCircle className="w-3 h-3" />
                                ข้อมูลไม่สมบูรณ์
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-slate-500 text-sm">
                          {emp.nationality === 'เมียนมา' || emp.nationality === 'เมียนมาร์'
                            ? 'เมียนมา/กะเหรี่ยง'
                            : (emp.nationality || 'ไทย')}
                        </span>
                      </TableCell>
                      <TableCell>{formatThaiCurrency(emp.rate_per_12h)} ฿</TableCell>
                      <TableCell>
                        {emp.payment_method === 'bank_transfer' ? (
                          <div className="flex flex-col">
                            <span className="text-sm">โอนผ่านบัญชี</span>
                            <span className="text-xs text-slate-500">
                              {emp.bank_name} - {emp.bank_account?.slice(0, 3)}XXXX{emp.bank_account?.slice(-3)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm">เงินสด</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                          {POSITIONS[emp.position] || emp.position}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <EmployeeFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        employeeId={selectedEmployeeId}
      />
      <EmployeeImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
    </>
  )
}
