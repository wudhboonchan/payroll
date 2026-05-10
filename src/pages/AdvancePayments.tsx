import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
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
import { Label } from '../components/ui/label'
import { Search, Plus, CreditCard, AlertCircle } from 'lucide-react'
import { formatThaiCurrency, formatThaiDate } from '../lib/formatters'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { formatEmployeeName } from './EmployeeFormModal'

export default function AdvancePayments() {
  const { user } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Fetch employees for the selector
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('factory_id', user.factory_id)
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch the current payroll period
  const { data: currentPeriod } = useQuery({
    queryKey: ['current-period', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return null
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('factory_id', user.factory_id)
        .order('period_start', { ascending: false })
        .limit(1)
        .single()
      
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!user?.factory_id
  })

  const period_id = currentPeriod?.id || '00000000-0000-0000-0000-000000000000'

  // Mock advances for UI
  const { data: advances = [] } = useQuery({
    queryKey: ['advances', user?.factory_id, period_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select(`
          id, amount, request_date, notes, entered_by,
          employee:employees!inner(employee_code, first_name, last_name, factory_id),
          admin:profiles!entered_by(full_name)
        `)
        .eq('employees.factory_id', user.factory_id)
        .eq('period_id', period_id)
      
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.factory_id
  })

  // Count advances per employee to show limits
  const advanceCounts = advances.reduce((acc: any, curr: any) => {
    const code = curr.employee.employee_code
    acc[code] = (acc[code] || 0) + 1
    return acc
  }, {})

  const filteredAdvances = advances.filter((adv: any) => 
    adv.employee.employee_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${adv.employee.first_name} ${adv.employee.last_name}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <>
      <TopBar 
        title="เบิกล่วงหน้า (Advance Payments)" 
        action={
          <div className="bg-white border border-slate-200 px-5 py-2 rounded-full shadow-sm">
            <span className="text-base font-bold text-slate-600">
              งวด: {currentPeriod ? (
                `${format(new Date(currentPeriod.period_start), 'd', { locale: th })} - ${format(new Date(currentPeriod.period_end), 'd MMMM yyyy', { locale: th })}`
              ) : (
                'ยังไม่ได้สร้างงวด'
              )}
            </span>
          </div>
        } 
      />
      
      <div className="p-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input 
                placeholder="ค้นหารหัส หรือชื่อพนักงาน..." 
                className="pl-9 h-11"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button onClick={() => setIsModalOpen(true)} className="bg-[#1D9E75] hover:bg-[#157a5a] h-11 px-6 shadow-md rounded-xl font-bold">
              <Plus className="w-5 h-5 mr-2" />
              เพิ่มรายการเบิก
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>พนักงาน</TableHead>
                <TableHead>วันที่เบิก</TableHead>
                <TableHead>จำนวนเงิน</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead>ผู้บันทึก</TableHead>
                <TableHead>โควต้าการเบิก</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdvances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    ไม่พบข้อมูลการเบิกเงินล่วงหน้า
                  </TableCell>
                </TableRow>
              ) : (
                filteredAdvances.map((adv: any) => {
                  const count = advanceCounts[adv.employee.employee_code]
                  return (
                    <TableRow key={adv.id}>
                      <TableCell className="font-medium text-slate-900">
                        {adv.employee.employee_code} — {formatEmployeeName(adv.employee)}
                      </TableCell>
                      <TableCell>{formatThaiDate(adv.request_date)}</TableCell>
                      <TableCell className="font-semibold text-rose-600">
                        {formatThaiCurrency(adv.amount)} ฿
                      </TableCell>
                      <TableCell className="text-slate-600">{adv.notes || '-'}</TableCell>
                      <TableCell className="text-slate-500 text-sm">
                        {adv.admin?.full_name || 'ผู้ดูแลระบบ'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={count >= 2 ? "destructive" : "secondary"} className={count < 2 ? "bg-slate-100 text-slate-600" : ""}>
                          {count} / 2 ครั้ง
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AdvanceModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        employees={employees}
        currentPeriod={currentPeriod}
      />
    </>
  )
}

function AdvanceModal({ isOpen, onClose, employees, currentPeriod }: { 
  isOpen: boolean, 
  onClose: () => void, 
  employees: any[],
  currentPeriod: any
}) {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: async (newData: any) => {
      let periodId = currentPeriod?.id

      // CRITICAL: If no draft period exists, we must create one first to satisfy foreign key constraints
      if (!periodId) {
        const { data: newPeriod, error: periodError } = await supabase
          .from('payroll_periods')
          .insert([{
            factory_id: user?.factory_id,
            label: '1-15 พฤษภาคม 2569',
            period_start: '2026-05-01',
            period_end: '2026-05-15',
            status: 'draft'
          }])
          .select()
          .single()
        
        if (periodError) throw new Error('กรุณาสร้างงวดการจ่ายเงินก่อน: ' + periodError.message)
        periodId = newPeriod.id
      }

      const { error } = await supabase
        .from('advance_payments')
        .insert([{
          ...newData,
          period_id: periodId,
          entered_by: user?.id
        }])
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['current-period'] })
      toast.success('บันทึกข้อมูลการเบิกล่วงหน้าสำเร็จ')
      setEmployeeId('')
      setAmount('')
      setNotes('')
      onClose()
    },
    onError: (error: any) => {
      toast.error('เกิดข้อผิดพลาด', { description: error.message })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId || !amount) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    mutation.mutate({
      employee_id: employeeId,
      amount: parseFloat(amount),
      request_date: requestDate,
      notes
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-none shadow-2xl">
        {/* Green Header - Kept as requested */}
        <div className="bg-[#1D9E75] p-6 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <CreditCard className="w-6 h-6" />
              บันทึกรายการเบิกล่วงหน้า
            </DialogTitle>
            <p className="text-emerald-100 mt-1 text-sm">กรอกรายละเอียดการเบิกเงินของพนักงานให้ครบถ้วน</p>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="p-6 bg-white space-y-6">
          {/* 1-Column Layout: One field per row, making it very wide and easy to read */}
          
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">เลือกพนักงาน *</Label>
            <select 
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
            >
              <option value="">ค้นหาและเลือกพนักงาน...</option>
              {employees
                .filter(emp => emp.status === 'active')
                .map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_code} — {formatEmployeeName(emp)}
                  </option>
                ))}
            </select>
            <div className="flex items-center gap-1.5 mt-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <p className="text-xs text-amber-700">เบิกได้สูงสุด 2 ครั้งต่องวด</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">วันที่ทำรายการ *</Label>
            <Input 
              type="date"
              className="w-full"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">จำนวนเงินที่เบิก (บาท) *</Label>
            <div className="relative group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">฿</span>
              <Input 
                type="number"
                className="pl-8 text-base font-semibold text-[#1D9E75] w-full"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">หมายเหตุ / รายละเอียดเพิ่มเติม</Label>
            <textarea 
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
              placeholder="ระบุเหตุผลการเบิก..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
            >
              ยกเลิก
            </Button>
            <Button 
              type="submit" 
              className="bg-[#1D9E75] hover:bg-[#157a5a]"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรายการเบิก'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
