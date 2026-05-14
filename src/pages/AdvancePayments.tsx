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
import { formatEmployeeName } from '../lib/formatters'

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  factory_id: string
  status?: string
}

interface Advance {
  id: string
  amount: number
  request_date: string
  notes?: string
  entered_by: string
  employee: Employee
  admin?: { full_name: string }
}

interface PayrollPeriod {
  id: string
  factory_id: string
  label: string
  period_start: string
  period_end: string
  status: string | null
}

export default function AdvancePayments() {
  const { user } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedAdvance, setSelectedAdvance] = useState<Advance | null>(null)

  // Fetch employees for the selector
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, factory_id, status')
        .eq('factory_id', user.factory_id)
      if (error) throw error
      return data as Employee[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch the current payroll period
  const { data: currentPeriod } = useQuery({
    queryKey: ['current-period', user?.factory_id],
    queryFn: async (): Promise<PayrollPeriod | null> => {
      if (!user?.factory_id) return null
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('id, factory_id, label, period_start, period_end, status')
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
          employee:employees!inner(id, employee_code, first_name, last_name, factory_id),
          admin:profiles!entered_by(full_name)
        `)
        .eq('employees.factory_id', user.factory_id)
        .eq('period_id', period_id)

      if (error) throw error
      return data as Advance[]
    },
    enabled: !!user?.factory_id
  })

  // Count advances per employee to show limits
  const advanceCounts = advances.reduce((acc: Record<string, number>, curr: Advance) => {
    const code = curr.employee.employee_code
    acc[code] = (acc[code] || 0) + 1
    return acc
  }, {})

  const filteredAdvances = advances.filter((adv: Advance) =>
    adv.employee.employee_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${adv.employee.first_name} ${adv.employee.last_name}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddNew = () => {
    setSelectedAdvance(null)
    setIsModalOpen(true)
  }

  const handleEdit = (adv: Advance) => {
    setSelectedAdvance(adv)
    setIsModalOpen(true)
  }

  return (
    <>
      <TopBar
        title="เบิกล่วงหน้า (Advance Payments)"
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
            <Button onClick={handleAddNew} className="bg-[#1D9E75] hover:bg-[#157a5a] h-11 px-6 shadow-md rounded-xl font-bold">
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
                filteredAdvances.map((adv: Advance) => {
                  const count = advanceCounts[adv.employee.employee_code]
                  return (
                    <TableRow
                      key={adv.id}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => handleEdit(adv)}
                    >
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
        onClose={() => {
          setIsModalOpen(false)
          setSelectedAdvance(null)
        }}
        employees={employees}
        currentPeriod={currentPeriod}
        advances={advances}
        initialData={selectedAdvance}
      />
    </>
  )
}

function AdvanceModal({ isOpen, onClose, employees, currentPeriod, advances, initialData }: {
  isOpen: boolean,
  onClose: () => void,
  employees: Employee[],
  currentPeriod: PayrollPeriod | null | undefined,
  advances: Advance[],
  initialData: Advance | null
}) {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  const isEdit = !!initialData

  // Set initial data when editing
  useState(() => {
    if (initialData) {
      setEmployeeId(initialData.employee.id)
      setAmount(initialData.amount.toString())
      setRequestDate(initialData.request_date.split('T')[0])
      setNotes(initialData.notes || '')
    }
  })

  // Also update when initialData changes (modal opens for edit)
  const [prevInitialData, setPrevInitialData] = useState<Advance | null>(null)
  if (initialData !== prevInitialData) {
    if (initialData) {
      setEmployeeId(initialData.employee.id)
      setAmount(initialData.amount.toString())
      setRequestDate(initialData.request_date.split('T')[0])
      setNotes(initialData.notes || '')
    } else {
      setEmployeeId('')
      setAmount('')
      setRequestDate(new Date().toISOString().split('T')[0])
      setNotes('')
    }
    setPrevInitialData(initialData)
  }

  const mutation = useMutation({
    mutationFn: async (newData: { employee_id: string; amount: number; request_date: string; notes: string }) => {
      if (isEdit) {
        const { error } = await supabase
          .from('advance_payments')
          .update(newData)
          .eq('id', initialData.id)
        if (error) throw error
      } else {
        let periodId = currentPeriod?.id

        if (!periodId) {
          const newPeriodPayload = {
            factory_id: user?.factory_id as string,
            label: formatThaiDate(new Date().toISOString()),
            period_start: format(new Date(), 'yyyy-MM-01'),
            period_end: format(new Date(), 'yyyy-MM-15'),
            status: 'draft' as const
          }

          const { data: newPeriod, error: periodError } = await supabase
            .from('payroll_periods')
            .insert([newPeriodPayload])
            .select()
            .single()

          if (periodError) throw new Error('กรุณาสร้างงวดการจ่ายเงินก่อน: ' + periodError.message)
          periodId = newPeriod.id
        }

        const advancePayload = {
          ...newData,
          period_id: periodId as string,
          entered_by: user?.id || null
        }

        const { error } = await supabase
          .from('advance_payments')
          .insert([advancePayload])
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      queryClient.invalidateQueries({ queryKey: ['current-period'] })
      toast.success(isEdit ? 'อัปเดตข้อมูลสำเร็จ' : 'บันทึกข้อมูลการเบิกล่วงหน้าสำเร็จ')
      onClose()
    },
    onError: (error: Error) => {
      toast.error('เกิดข้อผิดพลาด', { description: error.message })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!initialData) return
      const { error } = await supabase
        .from('advance_payments')
        .delete()
        .eq('id', initialData.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      toast.success('ลบรายการสำเร็จ')
      onClose()
    },
    onError: (error: Error) => {
      toast.error('ลบไม่สำเร็จ', { description: error.message })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId || !amount) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    // Only block if NOT editing the same employee's existing record
    if (!isEdit) {
      const selectedEmp = employees.find(e => e.id === employeeId)
      const countByCode = selectedEmp
        ? advances.filter(adv => adv.employee.employee_code === selectedEmp.employee_code).length
        : 0

      if (countByCode >= 2) {
        toast.error('ไม่สามารถเบิกได้', {
          description: `${selectedEmp ? selectedEmp.employee_code + ' — ' + selectedEmp.first_name : 'พนักงาน'} เบิกล่วงหน้าครบ 2 ครั้งในงวดนี้แล้ว ไม่อนุญาตให้เบิกเพิ่ม`,
          duration: 5000,
        })
        return
      }
    }

    mutation.mutate({
      employee_id: employeeId,
      amount: parseFloat(amount),
      request_date: requestDate,
      notes
    })
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-[#1D9E75] p-6 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <CreditCard className="w-6 h-6" />
              {isEdit ? 'แก้ไขรายการเบิกล่วงหน้า' : 'บันทึกรายการเบิกล่วงหน้า'}
            </DialogTitle>
            <p className="text-emerald-100 mt-1 text-sm">
              {isEdit ? 'แก้ไขรายละเอียดการเบิกเงินของพนักงาน' : 'กรอกรายละเอียดการเบิกเงินของพนักงานให้ครบถ้วน'}
            </p>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="p-6 bg-white space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">เลือกพนักงาน *</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              disabled={isEdit}
            >
              <option value="">ค้นหาและเลือกพนักงาน...</option>
              {employees
                .filter(emp => emp.status !== 'inactive' || (isEdit && emp.id === employeeId))
                .map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_code} — {formatEmployeeName(emp)}
                  </option>
                ))}
            </select>
            {!isEdit && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                <p className="text-xs text-amber-700">เบิกได้สูงสุด 2 ครั้งต่องวด</p>
              </div>
            )}
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

          <div className="flex justify-between items-center pt-6 border-t border-slate-100">
            <div>
              {isEdit && isAdmin && (
                <Button
                  type="button"
                  variant="destructive"
                  className="bg-rose-50 text-rose-600 hover:bg-rose-100 border-none shadow-none"
                  onClick={() => {
                    if (confirm('คุณต้องการลบรายการเบิกนี้ใช่หรือไม่?')) {
                      deleteMutation.mutate()
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบรายการ'}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
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
                {mutation.isPending ? 'กำลังบันทึก...' : isEdit ? 'อัปเดตรายการ' : 'บันทึกรายการเบิก'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
