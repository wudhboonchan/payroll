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
import { Search, Plus, User, FileUp, AlertCircle, Filter } from 'lucide-react'
import { formatThaiCurrency } from '../lib/formatters'
import EmployeeFormModal, { formatEmployeeName } from './EmployeeFormModal'
import EmployeeImportModal from '../components/employees/EmployeeImportModal'

export default function Employees() {
  const { user } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)

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
      return data as any[]
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
    
    // Hide inactive employees by default unless the user is actively searching
    if (searchTerm.trim() === '' && emp.status === 'inactive') {
      return false
    }
    
    return matchesSearch
  }) || []

  const pendingCount = employees?.filter(emp => emp.data_complete === false).length || 0

  const handleEdit = (id: string) => {
    setSelectedEmployeeId(id)
    setIsModalOpen(true)
  }

  const handleCreate = () => {
    setSelectedEmployeeId(null)
    setIsModalOpen(true)
  }

  return (
    <>
      <TopBar 
        title="ฐานข้อมูลพนักงาน" 
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setIsImportOpen(true)}
              className="border-[#1D9E75] text-[#1D9E75] hover:bg-[#1D9E75]/5"
            >
              <FileUp className="w-4 h-4 mr-2" />
              นำเข้า Excel
            </Button>
            <Button onClick={handleCreate} className="bg-[#1D9E75] hover:bg-[#157a5a]">
              <Plus className="w-4 h-4 mr-2" />
              เพิ่มพนักงาน
            </Button>
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
                className="pl-9 bg-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <Button
              variant={showPendingOnly ? "default" : "outline"}
              onClick={() => setShowPendingOnly(!showPendingOnly)}
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
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>รหัส</TableHead>
                <TableHead>ชื่อ-นามสกุล</TableHead>
                <TableHead>สัญชาติ</TableHead>
                <TableHead>ค่าแรง/12ชม.</TableHead>
                <TableHead>การรับเงิน</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    กำลังโหลดข้อมูล...
                  </TableCell>
                </TableRow>
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    ไม่พบข้อมูลพนักงาน
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp) => (
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
                      <Badge variant={emp.status === 'active' ? 'default' : 'secondary'} 
                             className={emp.status === 'active' ? 'bg-[#1D9E75] hover:bg-[#157a5a]' : 'bg-slate-100 text-slate-500'}>
                        {emp.status === 'active' ? 'พนักงานปัจจุบัน' : 'พ้นสภาพพนักงาน'}
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
