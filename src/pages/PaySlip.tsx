import { useState, useRef } from 'react'
import { TopBar } from '../components/layout/TopBar'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
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
  const slipWrapRef = useRef<HTMLDivElement>(null)

  // Fetch employees — active by default, show inactive only when searching
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-for-slip', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, prefix, nationality, status, payment_method, bank_name, bank_account, position')
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

  // Fetch shifts for day count display on slip
  const { data: slipShifts = [] } = useQuery({
    queryKey: ['shifts-for-slip', selectedId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedId || !currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('is_holiday_ot, is_half_shift, ot_hours')
        .eq('employee_id', selectedId)
        .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data as any[]
    },
    enabled: !!selectedId && !!currentPeriod?.id
  })

  const selectedEmpForSlip = employees.find((e: any) => e.id === selectedId) as any
  const isClerkSlip = selectedEmpForSlip?.position === 'clerk'

  const normalShiftsForSlip = slipShifts.filter((s: any) => !s.is_holiday_ot)
  const days_normal = normalShiftsForSlip.length
  const days_shift = normalShiftsForSlip.filter((s: any) => !s.is_half_shift).length
  // Workers: count holiday OT days; Clerks: sum ot_hours
  const days_ot = isClerkSlip
    ? slipShifts.reduce((sum: number, s: any) => sum + Number(s.ot_hours || 0), 0)
    : slipShifts.filter((s: any) => s.is_holiday_ot).length

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
        position: selectedEmp.position || 'worker',
        amount_normal: Number(payrollEntry?.amount_normal || 0),
        amount_shift: Number(payrollEntry?.amount_shift || 0),
        amount_ot: Number(payrollEntry?.amount_ot || 0),
        amount_wood_excess: Number(payrollEntry?.amount_wood_excess || 0),
        amount_film: Number(payrollEntry?.amount_film || 0),
        amount_special: Number(payrollEntry?.amount_special || 0),
        amount_diligence: Number(payrollEntry?.amount_diligence || 0),
        amount_position: Number(payrollEntry?.amount_position || 0),
        days_normal: slipShifts.length > 0 ? days_normal : undefined,
        days_shift: slipShifts.length > 0 ? days_shift : undefined,
        days_ot: slipShifts.length > 0 && days_ot > 0 ? days_ot : undefined,
        deduct_social_security: Number(payrollEntry?.deduct_social_security || 0),
        deduct_advance: totalAdvance,
        deduct_safety_equipment: Number(payrollEntry?.deduct_safety_equipment || 0),
        deduct_uniform: Number(payrollEntry?.deduct_uniform || 0),
        total_income: 0,
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

  const handlePrint = () => {
    if (!slipData || !slipWrapRef.current) return

    // ตั้งชื่อไฟล์ PDF: รหัส_ชื่อ_นามสกุล_mmyyyy
    const mm = String(new Date(currentPeriod!.period_start).getMonth() + 1).padStart(2, '0')
    const yyyy = new Date(currentPeriod!.period_start).getFullYear()
    const filename = `${slipData.employee_code}_${slipData.first_name}_${slipData.last_name}_${mm}${yyyy}`

    // เปิด window ใหม่ที่มีแค่สลิป — ไม่มีปัญหา 2 หน้าหรือ CSS ขัดกันอีกต่อไป
    const content = slipWrapRef.current.innerHTML
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: white; font-family: sans-serif; }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>${content}</body>
</html>`)
    win.document.close()
    win.focus()
    // รอให้ render เสร็จก่อน print
    setTimeout(() => {
      win.print()
      win.close()
    }, 400)
  }

  return (
    <>
      <TopBar
        title="ดูสลิปเงินเดือน"
        action={
          <div className="flex items-center gap-3">
            <Button
              className="bg-[#1D9E75] hover:bg-[#157a5a] h-10 px-5 font-bold shadow-sm"
              onClick={handlePrint}
              disabled={!slipData}
            >
              <Printer className="w-4 h-4 mr-2" />
              พิมพ์สลิป
            </Button>
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
          </div>
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
                    <div className={`flex items-center gap-3 text-sm font-bold ${isInactive ? 'text-slate-400' : 'text-slate-800'}`}>
                      <span className="w-12 shrink-0 tabular-nums">{emp.employee_code}</span>
                      <span className="text-slate-300 font-normal">—</span>
                      <span className="truncate">{formatEmployeeName(emp)}</span>
                    </div>
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
            <div ref={slipWrapRef} className="w-full shadow-lg overflow-x-auto">
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
