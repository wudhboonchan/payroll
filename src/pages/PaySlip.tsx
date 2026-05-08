import { useState } from 'react'
import { TopBar } from '../components/layout/TopBar'
import { PaySlipPreview } from '../components/payroll/PaySlipPreview'
import type { PaySlipData } from '../components/payroll/PaySlipPreview'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Printer, Search, UserX } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatEmployeeName } from './EmployeeFormModal'

export default function PaySlipPage() {
  const { user } = useAppStore()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Fetch employees — active by default, show inactive only when searching
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-for-slip', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, prefix, nationality, status, payment_method, bank_name, bank_account')
        .eq('factory_id', user.factory_id)
        .order('employee_code')
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.factory_id,
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

  // Fetch actual payroll entry for selected employee
  const { data: payrollEntry } = useQuery({
    queryKey: ['payroll-entry', selectedId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedId || !currentPeriod?.id) return null
      const { data, error } = await supabase
        .from('payroll_entries')
        .select('*')
        .eq('period_id', currentPeriod.id)
        .eq('employee_id', selectedId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!selectedId && !!currentPeriod?.id
  })

  // Fetch advance payments for the period
  const { data: advances = [] } = useQuery({
    queryKey: ['advances-for-slip', selectedId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedId) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select('amount')
        .eq('employee_id', selectedId)
      // .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data
    },
    enabled: !!selectedId
  })

  const totalAdvance = advances.reduce((sum: number, adv: any) => sum + Number(adv.amount), 0)

  const isSearching = search.trim().length > 0

  const visibleEmployees = employees.filter((emp: any) => {
    if (isSearching) {
      const q = search.toLowerCase()
      return (
        emp.employee_code.toLowerCase().includes(q) ||
        emp.first_name.toLowerCase().includes(q) ||
        emp.last_name.toLowerCase().includes(q)
      )
    }
    // No search = show only active
    return emp.status === 'active'
  })

  // Build PaySlip data for selected employee
  const selectedEmp = employees.find((e: any) => e.id === selectedId) as any

  const slipData: PaySlipData | null = selectedEmp && currentPeriod
    ? {
        employee_code: selectedEmp.employee_code,
        first_name: selectedEmp.first_name,
        last_name: selectedEmp.last_name,
        factory_name: 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
        period_start: currentPeriod.period_start,
        period_end: currentPeriod.period_end,
        generated_at: new Date().toISOString(),
        amount_normal: Number(payrollEntry?.amount_normal || 0),
        amount_shift: Number(payrollEntry?.amount_shift || 0),
        amount_ot: Number(payrollEntry?.amount_ot || 0),
        amount_wood_excess: Number(payrollEntry?.amount_wood_excess || 0),
        amount_film: Number(payrollEntry?.amount_film || 0),
        amount_special: Number(payrollEntry?.amount_special || 0),
        amount_diligence: Number(payrollEntry?.amount_diligence || 0),
        amount_position: Number(payrollEntry?.amount_position || 0),
        deduct_social_security: Number(payrollEntry?.deduct_social_security || 0),
        deduct_advance: totalAdvance,
        deduct_safety_equipment: Number(payrollEntry?.deduct_safety_equipment || 0),
        deduct_uniform: Number(payrollEntry?.deduct_uniform || 0),
        total_income: 0, // Will be calculated by UI or logic
        total_deductions: 0,
        net_pay: 0,
        payment_method: selectedEmp.payment_method || 'cash',
        bank_name: selectedEmp.bank_name,
        bank_account: selectedEmp.bank_account,
      }
    : null

  // Calculate totals if we have data
  if (slipData) {
    slipData.total_income = 
      slipData.amount_normal + slipData.amount_shift + slipData.amount_ot +
      slipData.amount_wood_excess + slipData.amount_film + slipData.amount_special +
      slipData.amount_diligence + slipData.amount_position
    
    slipData.total_deductions = 
      slipData.deduct_social_security + slipData.deduct_advance +
      slipData.deduct_safety_equipment + slipData.deduct_uniform
    
    slipData.net_pay = slipData.total_income - slipData.total_deductions
  }

  const handlePrint = () => window.print()

  return (
    <>
      <TopBar
        title="ดูสลิปเงินเดือน"
        action={
          <Button
            className="bg-[#1D9E75] hover:bg-[#157a5a]"
            onClick={handlePrint}
            disabled={!slipData}
          >
            <Printer className="w-4 h-4 mr-2" />
            พิมพ์สลิป
          </Button>
        }
      />

      <div className="flex flex-col md:flex-row min-h-[calc(100vh-64px)] md:h-[calc(100vh-64px)]">

        {/* Left: Employee List */}
        <div className="w-full md:w-80 border-b md:border-b-0 md:border-r bg-white flex flex-col h-[40vh] md:h-auto shrink-0">
          <div className="p-4 border-b space-y-3 shrink-0">
            <Label className="text-sm font-semibold text-slate-700">รายชื่อพนักงาน</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="ค้นหา รหัส/ชื่อ..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {isSearching && (
              <p className="text-xs text-slate-500">
                แสดงผลการค้นหา (รวมพนักงานที่พ้นสภาพแล้ว)
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleEmployees.length === 0 && (
              <div className="text-center py-10 text-slate-400 text-sm">
                ไม่พบพนักงาน
              </div>
            )}
            {visibleEmployees.map((emp: any) => {
              const isInactive = emp.status !== 'active'
              const isSelected = selectedId === emp.id
              return (
                <div
                  key={emp.id}
                  onClick={() => setSelectedId(emp.id)}
                  className={`px-4 py-3 cursor-pointer border-b transition-colors flex items-center justify-between
                    ${isSelected ? 'bg-[#1D9E75]/10 border-l-4 border-l-[#1D9E75]' : 'hover:bg-slate-50'}
                    ${isInactive ? 'opacity-60' : ''}
                  `}
                >
                  <div>
                    <p className={`text-sm font-semibold ${isInactive ? 'text-slate-400' : 'text-slate-800'}`}>
                      {emp.employee_code} — {formatEmployeeName(emp)}
                    </p>
                    {isInactive && (
                      <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <UserX className="w-3 h-3" /> พ้นสภาพพนักงาน
                      </span>
                    )}
                  </div>
                  {isInactive && (
                    <div className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex-1 bg-slate-100 overflow-y-auto p-4 md:p-8 print:p-0 print:bg-white flex justify-center items-start">
          {slipData ? (
            <div className="shadow-lg print:shadow-none max-w-full overflow-x-auto">
              <PaySlipPreview data={slipData} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <Printer className="w-12 h-12 opacity-20" />
              <p className="text-lg font-medium">เลือกพนักงานเพื่อดูสลิป</p>
              <p className="text-sm">คลิกชื่อพนักงานจากรายการด้านซ้าย (ระบบจะแสดงเฉพาะงวดที่มีข้อมูล)</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
