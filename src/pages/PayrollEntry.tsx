import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isWeekend, parseISO } from 'date-fns'
import { th } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { Search, Save, Lock, Edit2, AlertCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { formatThaiCurrency } from '../lib/formatters'
import { calculatePayroll } from '../lib/payrollCalc'
import type { PayrollCalculationInput } from '../lib/payrollCalc'
import { formatEmployeeName } from '../lib/formatters'

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix?: string
  nationality?: string
  position: string
  wage_type: string
  rate_per_12h: number
  payment_method: string
  status: string
  job_title?: string
  factory_id?: string
}

interface ShiftAssignment {
  id?: string
  employee_id?: string
  work_date?: string
  shift_type?: string
  is_holiday_ot?: boolean
  is_half_shift?: boolean
  wood_excess?: number
  film_amount?: number
  ot_hours?: number
  is_cross_position?: boolean
  cross_position_title?: string | null
  cross_position_extra_pay?: number
  employee?: {
    employee_code?: string
    first_name?: string
    last_name?: string
    prefix?: string | null
    nationality?: string | null
  }
}

interface AdvancePayment {
  id?: string
  employee_id?: string
  amount?: number
  period_id?: string
}

interface PayrollEntryRow {
  employee_id?: string
  amount_normal?: number
  amount_shift?: number
  amount_ot?: number
  amount_wood_excess?: number
  amount_film?: number
  amount_special?: number
  override_special?: number | null
  special_note?: string | null
  amount_diligence?: number
  amount_position?: number
  deduct_social_security?: number
  deduct_safety_equipment?: number
  deduct_uniform?: number
  deduct_advance?: number
  override_normal?: number | null
  override_reason?: string | null
}

export default function PayrollEntry() {
  const { user } = useAppStore()

  const queryClient = useQueryClient()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [socialSecurityRate, setSocialSecurityRate] = useState(0.05)
  const [isApproved] = useState(false)

  // Override states
  const [overrideNormal, setOverrideNormal] = useState<number | null>(null)
  const [isEditingNormal, setIsEditingNormal] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideWood, setOverrideWood] = useState<number | null>(null)
  const [overrideFilm, setOverrideFilm] = useState<number | null>(null)
  const [isEditingWood, setIsEditingWood] = useState(false)
  const [isEditingFilm, setIsEditingFilm] = useState(false)
  const [overrideSpecial, setOverrideSpecial] = useState<number | null>(null)
  const [specialNote, setSpecialNote] = useState('')
  const [isEditingSpecial, setIsEditingSpecial] = useState(false)

  const [manualEntries, setManualEntries] = useState({
    amount_wood_excess: 0,
    amount_film: 0,
    amount_special: 0,
    amount_diligence: 0,
    amount_position: 0,
    deduct_safety_equipment: 0,
    deduct_uniform: 0
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, prefix, nationality, position, wage_type, rate_per_12h, payment_method, status, job_title, factory_id')
        .eq('factory_id', user.factory_id)
      if (error) throw error
      return data as Employee[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch the target period (default to global selection or latest)
  const { data: periods = [] } = useQuery({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('id, factory_id, label, period_start, period_end, status, social_security_rate')
        .eq('factory_id', user.factory_id)
        .order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id
  })

  const currentPeriod = periods[0]

  // Fetch shift assignments for calculation
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('id, employee_id, shift_type, is_holiday_ot, is_half_shift, wood_excess, film_amount, ot_hours, work_date, is_cross_position, cross_position_title, cross_position_extra_pay')
        .eq('employee_id', selectedEmployeeId)
        .eq('period_id', currentPeriod?.id)
      if (error) throw error
      return (data as unknown) as ShiftAssignment[]
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id
  })

  // Fetch advance payments
  const { data: advances = [] } = useQuery({
    queryKey: ['advances', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select('id, amount, period_id')
        .eq('employee_id', selectedEmployeeId)
        .eq('period_id', currentPeriod?.id)
      if (error) throw error
      return (data as unknown) as AdvancePayment[]
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id,
    staleTime: 30_000,
  })

  // Fetch ALL payroll entries for this period to show status in sidebar
  // Only select fields needed for status comparison (not all columns)
  const { data: allPeriodEntries = [] } = useQuery({
    queryKey: ['all-payroll-entries', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('payroll_entries')
        .select('employee_id, amount_normal, amount_shift, amount_ot, amount_wood_excess, amount_film, amount_special, amount_diligence, amount_position, deduct_social_security, deduct_safety_equipment, deduct_uniform, deduct_advance, override_normal, override_reason, override_special, special_note')
        .eq('period_id', currentPeriod?.id)
      if (error) throw error
      return (data as unknown) as PayrollEntryRow[]
    },
    enabled: !!currentPeriod?.id,
    staleTime: 30_000,
  })

  // Fetch ALL advances for this period to show OUTDATED status in sidebar
  const { data: allPeriodAdvances = [] } = useQuery({
    queryKey: ['advances', 'all', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select('id, employee_id, amount, period_id')
        .eq('period_id', currentPeriod?.id)
      if (error) throw error
      return (data as unknown) as AdvancePayment[]
    },
    enabled: !!currentPeriod?.id,
    staleTime: 30_000,
  })

  // Fetch ALL shift assignments for this period to detect "Outdated" status for everyone
  const { data: allPeriodShifts = [] } = useQuery({
    queryKey: ['all-period-shifts', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments' as any)
        .select(`
          id, employee_id, shift_type, is_holiday_ot,
          is_half_shift, wood_excess, film_amount, ot_hours, work_date,
          is_cross_position, cross_position_title, cross_position_extra_pay,
          employee:employees(employee_code, first_name, last_name, prefix, nationality)
        `)
        .eq('period_id', currentPeriod?.id)
      if (error) throw error
      return (data as unknown) as ShiftAssignment[]
    },
    enabled: !!currentPeriod?.id,
    staleTime: 30_000,
  })

  // Fetch existing payroll entry for the selected employee (full detail)
  const { data: existingEntry } = useQuery({
    queryKey: ['payroll-entry', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return null
      const { data, error } = await supabase
        .from('payroll_entries' as any)
        .select('employee_id, amount_normal, amount_shift, amount_ot, amount_wood_excess, amount_film, amount_special, override_special, special_note, amount_diligence, amount_position, deduct_social_security, deduct_safety_equipment, deduct_uniform, deduct_advance, override_normal, override_reason')
        .eq('period_id', currentPeriod?.id)
        .eq('employee_id', selectedEmployeeId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return (data as unknown) as PayrollEntryRow | null
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id
  })

  // Update form when existing entry is loaded
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (existingEntry) {
        setManualEntries({
          amount_wood_excess: Number(existingEntry.amount_wood_excess || 0),
          amount_film: Number(existingEntry.amount_film || 0),
          amount_special: Number(existingEntry.amount_special || 0),
          amount_diligence: Number(existingEntry.amount_diligence || 0),
          amount_position: Number(existingEntry.amount_position || 0),
          deduct_safety_equipment: Number(existingEntry.deduct_safety_equipment || 0),
          deduct_uniform: Number(existingEntry.deduct_uniform || 0)
        })
        setOverrideNormal(existingEntry.override_normal != null ? Number(existingEntry.override_normal) : null)
        setOverrideReason(existingEntry.override_reason || '')
        setOverrideSpecial(existingEntry.override_special != null ? Number(existingEntry.override_special) : null)
        setSpecialNote(existingEntry.special_note || '')
      } else {
        setManualEntries({
          amount_wood_excess: 0,
          amount_film: 0,
          amount_special: 0,
          amount_diligence: 0,
          amount_position: 0,
          deduct_safety_equipment: 0,
          deduct_uniform: 0
        })
        setOverrideNormal(null)
        setOverrideReason('')
        setOverrideWood(null)
        setOverrideFilm(null)
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [existingEntry, selectedEmployeeId])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  // Consolidated calculations for stability
  const { 
    calc, totalAdvance, effectiveWood, effectiveFilm, 
    isClerk, normalDays, halfShiftDays, holidayOtHours, 
    autoClerkOtHours, autoClerkOt1xHours, autoWood, autoFilm,
    autoSpecial, autoSpecialNote, effectiveSpecial
  } = useMemo(() => {
    const isClerk = selectedEmployee?.position === 'clerk'
    const advTotal = advances.reduce((sum: number, adv) => sum + Number(adv.amount), 0)
    const normShifts = shifts.filter(s => !s.is_holiday_ot)
    const normDays = normShifts.filter(s => !s.is_half_shift).length
    const halfDays = normShifts.filter(s => s.is_half_shift).length
    const holHours = shifts.filter(s => s.is_holiday_ot).reduce((sum: number, s) => {
      const base = s.is_half_shift ? 8 : 12
      return sum + base + Number(s.ot_hours || 0)
    }, 0)
    const clerkNormDays = normShifts.length
    const isWeekendDay = (dateStr: string) => {
      const d = parseISO(dateStr);
      const day = d.getDay();
      return day === 0 || day === 6; // 0=Sunday, 6=Saturday
    };

    const autoClerkOt = shifts.filter(s => !isWeekendDay(s.work_date)).reduce((sum: number, s) => sum + Number(s.ot_hours || 0), 0)
    const autoClerkOt1x = shifts.filter(s => isWeekendDay(s.work_date)).reduce((sum: number, s) => sum + Number(s.ot_hours || 0), 0)
    const autoW = shifts.reduce((sum: number, s) => sum + Number(s.wood_excess || 0), 0)
    const autoF = shifts.reduce((sum: number, s) => sum + Number(s.film_amount || 0), 0)
    
    // Auto Special from Cross Position (Job Rotation)
    const crossPosShifts = shifts.filter(s => s.is_cross_position)
    const autoSpecial = crossPosShifts.reduce((sum: number, s) => sum + Number(s.cross_position_extra_pay || 0), 0)
    
    // Generate auto special note
    const autoSpecialNote = crossPosShifts.length > 0 
      ? crossPosShifts.map(s => `${s.cross_position_title || 'สลับตำแหน่ง'} (${s.cross_position_extra_pay}฿)`).join(', ')
      : ''

    const woodVal: number = overrideWood !== null ? overrideWood : autoW
    const filmVal: number = overrideFilm !== null ? overrideFilm : autoF

    const input: PayrollCalculationInput = {
      position: (selectedEmployee?.position as 'worker' | 'clerk') || 'worker',
      wage_type: (selectedEmployee?.wage_type as 'daily' | 'monthly') || 'daily',
      rate_per_12h: selectedEmployee?.rate_per_12h || 0,
      normal_days: isClerk ? clerkNormDays : normDays,
      half_shift_days: isClerk ? 0 : halfDays,
      holiday_ot_hours: holHours,
      clerk_ot_hours: autoClerkOt,
      clerk_ot_1x_hours: autoClerkOt1x,
      override_normal: overrideNormal,
      social_security_rate: socialSecurityRate,
      deduct_advance: advTotal,
      amount_wood_excess: isClerk ? 0 : woodVal,
      amount_film: isClerk ? 0 : filmVal,
      amount_special: autoSpecial,
      override_special: overrideSpecial,
      amount_diligence: manualEntries.amount_diligence,
      amount_position: manualEntries.amount_position,
      deduct_safety_equipment: manualEntries.deduct_safety_equipment,
      deduct_uniform: manualEntries.deduct_uniform,
    }

    return {
      calc: calculatePayroll(input),
      totalAdvance: advTotal,
      effectiveWood: woodVal,
      effectiveFilm: filmVal,
      isClerk,
      normalDays: normDays,
      halfShiftDays: halfDays,
      holidayOtHours: holHours,
      autoClerkOtHours: autoClerkOt,
      autoClerkOt1xHours: autoClerkOt1x,
      autoWood: autoW,
      autoFilm: autoF,
      autoSpecial,
      autoSpecialNote,
      effectiveSpecial: overrideSpecial !== null ? overrideSpecial : autoSpecial,
    }
  }, [
    selectedEmployee?.position,
    selectedEmployee?.wage_type,
    selectedEmployee?.rate_per_12h,
    advances,
    shifts,
    overrideWood,
    overrideFilm,
    overrideNormal,
    overrideSpecial,
    specialNote,
    socialSecurityRate,
    manualEntries.amount_diligence,
    manualEntries.amount_position,
    manualEntries.deduct_safety_equipment,
    manualEntries.deduct_uniform
  ])

  // Check if underlying data changed since last save — compare calc output vs DB entry directly
  const isOutdated = useMemo(() => {
    if (!existingEntry) return false;

    const r = (v: number) => Math.round(v * 100) / 100  // round to 2dp to avoid float drift

    const checks = [
      Math.abs(r(calc.amount_normal) - r(Number(existingEntry.amount_normal || 0))) > 0.01,
      Math.abs(r(calc.amount_shift)  - r(Number(existingEntry.amount_shift  || 0))) > 0.01,
      Math.abs(r(calc.amount_ot + calc.amount_ot_1x) - r(Number(existingEntry.amount_ot || 0))) > 0.01,
      Math.abs(r(calc.amount_wood_excess) - r(Number(existingEntry.amount_wood_excess || 0))) > 0.01,
      Math.abs(r(calc.amount_film)        - r(Number(existingEntry.amount_film        || 0))) > 0.01,
      Math.abs(r(calc.amount_special)     - r(Number(existingEntry.amount_special || 0))) > 0.01,
      Math.abs(manualEntries.amount_diligence - Number(existingEntry.amount_diligence || 0)) > 0.01,
      Math.abs(manualEntries.amount_position  - Number(existingEntry.amount_position  || 0)) > 0.01,
      Math.abs(r(calc.deduct_social_security) - r(Number(existingEntry.deduct_social_security || 0))) > 0.01,
      Math.abs(manualEntries.deduct_safety_equipment - Number(existingEntry.deduct_safety_equipment || 0)) > 0.01,
      Math.abs(manualEntries.deduct_uniform          - Number(existingEntry.deduct_uniform          || 0)) > 0.01,
      Math.abs(totalAdvance - Number(existingEntry.deduct_advance || 0)) > 0.01,
      (overrideNormal ?? null) !== (existingEntry.override_normal != null ? Number(existingEntry.override_normal) : null),
      (overrideSpecial ?? null) !== (existingEntry.override_special != null ? Number(existingEntry.override_special) : null),
      (specialNote || autoSpecialNote) !== (existingEntry.special_note || ''),
    ];

    return checks.some(Boolean);
  }, [calc, existingEntry, totalAdvance, overrideNormal, overrideSpecial, specialNote, autoSpecialNote, manualEntries])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return

      const payload = {
        period_id: currentPeriod.id,
        employee_id: selectedEmployeeId,
        amount_normal: Math.round(calc.amount_normal * 100) / 100,
        amount_shift: Math.round(calc.amount_shift * 100) / 100,
        amount_ot: Math.round((calc.amount_ot + calc.amount_ot_1x) * 100) / 100,
        amount_wood_excess: isClerk ? 0 : Math.round(effectiveWood * 100) / 100,
        amount_film: isClerk ? 0 : Math.round(effectiveFilm * 100) / 100,
        amount_special: Math.round(autoSpecial * 100) / 100,
        override_special: overrideSpecial,
        special_note: (specialNote || autoSpecialNote || '').trim(),
        amount_diligence: Math.round(manualEntries.amount_diligence * 100) / 100,
        amount_position: Math.round(manualEntries.amount_position * 100) / 100,
        deduct_safety_equipment: Math.round(manualEntries.deduct_safety_equipment * 100) / 100,
        deduct_uniform: Math.round(manualEntries.deduct_uniform * 100) / 100,
        override_normal: overrideNormal,
        override_reason: overrideReason,
        deduct_social_security: Math.round(calc.deduct_social_security * 100) / 100,
        deduct_advance: Math.round(totalAdvance * 100) / 100,
        entered_by: user?.id
      }

      // Mandatory note validation
      if (calc.effective_special > 0 && !(specialNote || autoSpecialNote)) {
        throw new Error("กรุณากรอกหมายเหตุสำหรับเงินพิเศษ")
      }

      const { error } = await supabase
        .from('payroll_entries' as any)
        .upsert([payload], { onConflict: 'period_id,employee_id' })

      if (error) throw error
    },
    onSuccess: () => {
      // Invalidate only payroll-specific data, not shifts (which haven't changed)
      queryClient.invalidateQueries({ queryKey: ['payroll-entry', selectedEmployeeId, currentPeriod?.id] })
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries', currentPeriod?.id] })
      toast.success('บันทึกข้อมูลค่าจ้างสำเร็จ')
    },
    onError: (error: Error) => {
      toast.error('เกิดข้อผิดพลาดในการบันทึก', { description: error.message })
    }
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setManualEntries(prev => ({
      ...prev,
      [name]: Number(value) || 0
    }))
  }

  return (
    <>
      <TopBar
        title="บันทึกข้อมูลค่าจ้าง"
        action={
          <div className="flex items-center gap-4">
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
            {user?.role === 'superUser' && (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
                <span className="text-[10px] font-bold text-slate-500 uppercase">ประกันสังคม:</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    className="w-14 h-7 text-right text-sm font-bold"
                    value={socialSecurityRate * 100}
                    onChange={(e) => setSocialSecurityRate(Number(e.target.value) / 100)}
                    disabled={isApproved}
                  />
                  <span className="text-sm font-medium text-slate-400">%</span>
                </div>
              </div>
            )}
          </div>
        }
      />

      <div className="flex flex-col md:flex-row min-h-[calc(100vh-64px)] md:h-[calc(100vh-64px)]">
        {/* Left Sidebar: Employee List */}
        <div className="w-full md:w-80 border-b md:border-b-0 md:border-r bg-white flex flex-col h-[40vh] md:h-auto shrink-0">
          <div className="p-4 border-b space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="ค้นหาพนักงาน..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {employees
              .filter(emp => {
                const matchesSearch = emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  emp.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  emp.last_name.toLowerCase().includes(searchTerm.toLowerCase())

                if (searchTerm.trim().length > 0) return matchesSearch
                return emp.status === 'active' && matchesSearch
              })
              .map(emp => {
                const isInactive = emp.status !== 'active'
                const isSelected = selectedEmployeeId === emp.id
                const entry = allPeriodEntries.find(e => e.employee_id === emp.id)

                // ── Status Logic (Using central calculatePayroll) ──
                const empShifts = allPeriodShifts.filter(s => s.employee_id === emp.id)
                const normalShifts = empShifts.filter(s => !s.is_holiday_ot)
                const isEmpClerk = emp.position === 'clerk'

                const sidebarWood = empShifts.reduce((sum: number, s) => sum + Number(s.wood_excess || 0), 0)
                const sidebarFilm = empShifts.reduce((sum: number, s) => sum + Number(s.film_amount || 0), 0)
                let status: 'grey' | 'green' | 'orange' = 'grey'
                try {
                  if (entry) {
                    const isWeekendDay = (dateStr: string) => {
                      if (!dateStr) return false
                      const d = parseISO(dateStr);
                      const day = d.getDay();
                      return day === 0 || day === 6;
                    };

                    const sidebarClerkOt = empShifts.filter(s => !isWeekendDay(s.work_date)).reduce((sum: number, s) => sum + Number(s.ot_hours || 0), 0)
                    const sidebarClerkOt1x = empShifts.filter(s => isWeekendDay(s.work_date)).reduce((sum: number, s) => sum + Number(s.ot_hours || 0), 0)

                    const sidebarHolHours = empShifts.filter(s => s.is_holiday_ot).reduce((sum: number, s) => {
                      const base = s.is_half_shift ? 8 : 12
                      return sum + base + Number(s.ot_hours || 0)
                    }, 0)

                    const sidebarWood = empShifts.reduce((sum: number, s) => sum + Number(s.wood_excess || 0), 0)
                    const sidebarFilm = empShifts.reduce((sum: number, s) => sum + Number(s.film_amount || 0), 0)
                    const sidebarAutoSpecial = empShifts
                      .filter(s => s.is_cross_position)
                      .reduce((sum: number, s) => sum + Number(s.cross_position_extra_pay || 0), 0)
                    
                    const crossPosShifts = empShifts.filter(s => s.is_cross_position)
                    const sidebarAutoSpecialNote = crossPosShifts.length > 0 
                      ? crossPosShifts.map(s => `${s.cross_position_title || 'สลับตำแหน่ง'} (${s.cross_position_extra_pay}฿)`).join(', ')
                      : ''

                    const calcInput: PayrollCalculationInput = {
                      position: (emp.position as 'worker' | 'clerk') || 'worker',
                      wage_type: (emp.wage_type as 'daily' | 'monthly') || 'daily',
                      rate_per_12h: Number(emp.rate_per_12h || 0),
                      normal_days: isEmpClerk ? normalShifts.length : normalShifts.filter(s => !s.is_half_shift).length,
                      half_shift_days: isEmpClerk ? 0 : normalShifts.filter(s => s.is_half_shift).length,
                      holiday_ot_hours: sidebarHolHours,
                      clerk_ot_hours: sidebarClerkOt,
                      clerk_ot_1x_hours: sidebarClerkOt1x,
                      social_security_rate: socialSecurityRate,
                      override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
                      amount_wood_excess: isEmpClerk ? 0 : sidebarWood,
                      amount_film: isEmpClerk ? 0 : sidebarFilm,
                      amount_special: sidebarAutoSpecial,
                      override_special: entry.override_special != null ? Number(entry.override_special) : null,
                      deduct_advance: allPeriodAdvances
                        .filter(a => a.employee_id === emp.id)
                        .reduce((sum: number, a) => sum + Number(a.amount), 0),
                    }

                    const currentCalc = calculatePayroll(calcInput)
                    const r = (v: number) => Math.round(v * 100) / 100

                    const diffs = [
                      Math.abs(r(currentCalc.amount_normal) - r(Number(entry.amount_normal || 0))) > 0.01,
                      Math.abs(r(currentCalc.amount_shift) - r(Number(entry.amount_shift || 0))) > 0.01,
                      Math.abs(r(currentCalc.amount_ot + (currentCalc.amount_ot_1x || 0)) - r(Number(entry.amount_ot || 0))) > 0.01,
                      Math.abs(r(currentCalc.amount_wood_excess) - r(Number(entry.amount_wood_excess || 0))) > 0.01,
                      Math.abs(r(currentCalc.amount_film) - r(Number(entry.amount_film || 0))) > 0.01,
                      Math.abs(r(currentCalc.amount_special) - r(Number(entry.amount_special || 0))) > 0.01,
                      Math.abs(r(currentCalc.deduct_advance) - r(Number(entry.deduct_advance || 0))) > 0.01,
                      (entry.special_note || '').trim() !== (sidebarAutoSpecialNote || '').trim() && !(entry.special_note || '').includes(sidebarAutoSpecialNote)
                    ]

                    status = diffs.some(Boolean) ? 'orange' : 'green'
                  }
                } catch (err) {
                  console.error('Sidebar status error for', emp.employee_code, err)
                  status = 'orange' // Show as outdated if calculation fails
                }

                return (
                  <div
                    key={emp.id}
                    onClick={() => !isInactive && setSelectedEmployeeId(emp.id)}
                    className={`
                      relative p-3 pl-4 rounded-xl cursor-pointer transition-all flex justify-between items-center border
                      ${isSelected
                        ? 'bg-[#1D9E75]/10 border-[#1D9E75] text-[#1D9E75] font-bold shadow-sm'
                        : 'bg-white border-slate-100 hover:border-slate-200 text-slate-700'
                      }
                      ${isInactive ? 'opacity-50 grayscale' : ''}
                    `}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold opacity-60">{emp.employee_code}</span>
                        {emp.position === 'clerk' && (
                          <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded leading-none">
                            👩🏻‍🏫 เสมียน
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-medium truncate max-w-[140px]">
                        {formatEmployeeName(emp)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {status === 'orange' && (
                        <span className="text-[9px] font-black text-orange-600 uppercase animate-pulse">Outdated</span>
                      )}
                      {/* Status Dot */}
                      <div className={`w-3.5 h-3.5 rounded-full shadow-inner border ${status === 'grey' ? 'bg-slate-200 border-slate-300' :
                        status === 'green' ? 'bg-[#1D9E75] border-[#157a5a]' :
                          'bg-orange-500 border-orange-600'
                        }`} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Right Area: Form */}
        <div className="flex-1 bg-slate-50/50 p-4 md:p-8 overflow-y-auto">
          {!selectedEmployeeId ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Edit2 className="w-8 h-8 text-slate-300" />
              </div>
              <p>เลือกพนักงานจากรายชื่อด้านซ้ายเพื่อกรอกตัวเลข</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">

              {/* Header Info */}
              <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-3">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-800">
                    {formatEmployeeName(selectedEmployee || { first_name: '', prefix: undefined, last_name: undefined, nationality: undefined })}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm text-slate-500">
                    <span>รหัสพนักงาน: <strong className="text-slate-700">{selectedEmployee?.employee_code}</strong></span>
                    <span>อัตราค่าจ้าง: <strong className="text-slate-700">{formatThaiCurrency(selectedEmployee?.rate_per_12h)} บาท/{selectedEmployee?.wage_type === 'monthly' ? 'เดือน' : 'วัน'}</strong></span>
                    <span>กลุ่มงาน: <strong className={isClerk ? 'text-red-600' : 'text-slate-700'}>{isClerk ? 'เสมียน' : 'พนักงานทั่วไป'}</strong></span>
                    {selectedEmployee?.job_title && (
                      <span>ตำแหน่ง: <strong className="text-slate-700">{selectedEmployee.job_title}</strong></span>
                    )}
                    <span>การรับเงิน: <strong className="text-slate-700">{selectedEmployee?.payment_method === 'bank_transfer' ? 'โอนบัญชี' : 'เงินสด'}</strong></span>
                  </div>
                </div>

                {isApproved && (
                  <Badge className="bg-amber-100 text-amber-800 border-none px-4 py-1.5 flex items-center w-fit">
                    <Lock className="w-4 h-4 mr-2" />
                    งวดถูกอนุมัติแล้ว ไม่สามารถแก้ไขได้
                  </Badge>
                )}
              </div>

              {/* Sync Warning */}
              {isOutdated && !isApproved && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm animate-in fade-in slide-in-from-top-2">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-bold text-amber-800">
                        แจ้งเตือน: ข้อมูลกะทำงานมีการเปลี่ยนแปลง!
                      </h3>
                      <div className="mt-1 text-sm text-amber-700">
                        <p>
                          พบว่าหลังจากที่คุณบันทึกค่าจ้างล่าสุด มีการเข้าไปแก้ไขกะทำงาน (หรือยอดเบิกล่วงหน้า) ของพนักงานคนนี้
                          ระบบได้ดึงข้อมูลใหม่มาแสดงแล้ว <strong>กรุณากด "บันทึกข้อมูลค่าจ้าง" อีกครั้ง</strong> เพื่อให้ยอดเงินอัปเดตเป็นปัจจุบัน
                        </p>
                      </div>
                      <div className="mt-3">
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-800 h-8 text-xs font-bold"
                          onClick={() => {
                            setOverrideNormal(null);
                            setOverrideWood(null);
                            setOverrideFilm(null);
                            setOverrideSpecial(null);
                            setSpecialNote('');
                            toast.success('รีเซ็ตยอดเป็นค่าเริ่มต้นตามกะทำงานแล้ว');
                          }}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-2" />
                          รีเซ็ตและปรับยอดตามกะปัจจุบัน
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* INCOMES COLUMN */}
                <Card className="border-t-4 border-t-emerald-500 shadow-sm">
                  <CardHeader className="bg-emerald-50/50 pb-4">
                    <CardTitle className="text-emerald-800 flex justify-between items-center">
                      รายได้ (Income)
                      <span className="text-sm font-normal text-emerald-600">หน่วย: บาท</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-6">

                    {/* Auto Calculated normal pay */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-slate-700 font-semibold">
                          {isClerk ? 'ค่าจ้าง (เสมียน 8 ชม./วัน)' : 'ค่าจ้างปกติ (เรท 8 ชม.)'}
                        </Label>
                        <span className="text-xs text-slate-500">
                          คำนวณอัตโนมัติ: {normalDays + halfShiftDays} วัน
                          {!isClerk && halfShiftDays > 0 && <span className="text-amber-600 ml-1">(ทำงาน 8 ชม.: {halfShiftDays} วัน)</span>}
                        </span>
                      </div>

                      {isEditingNormal ? (
                        <div className="space-y-3 bg-amber-50 p-3 rounded-lg border border-amber-200">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              className="bg-white border-amber-300"
                              value={overrideNormal || ''}
                              onChange={(e) => setOverrideNormal(Number(e.target.value))}
                              placeholder={calc.amount_normal.toString()}
                            />
                            <Button size="sm" variant="outline" onClick={() => setIsEditingNormal(false)}>ยกเลิก</Button>
                          </div>
                          <div>
                            <Label className="text-xs text-amber-800">เหตุผลที่แก้ไข *</Label>
                            <Input
                              className="mt-1 bg-white h-8 text-sm"
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="ระบุเหตุผล..."
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex relative">
                          <Input
                            className="bg-emerald-50 border-emerald-200 text-emerald-900 font-medium pr-10"
                            readOnly
                            value={formatThaiCurrency(calc.effective_normal)}
                          />
                          {!isApproved && (
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                              <button
                                onClick={() => setIsEditingNormal(true)}
                                className="text-slate-400 hover:text-emerald-600 transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {overrideNormal !== null && !isEditingNormal && (
                        <p className="text-xs text-amber-600 flex items-center mt-1">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          แก้ไขจากยอดคำนวณเดิม {formatThaiCurrency(calc.amount_normal)} ฿
                        </p>
                      )}
                    </div>

                    {/* Shift pay - hidden for clerk */}
                    {!isClerk && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold">ค่ากะ (เรท 4 ชม.)</Label>
                          <span className="text-xs text-slate-500">คำนวณอัตโนมัติ: {normalDays} วัน</span>
                        </div>
                        <Input className="bg-slate-50" readOnly value={formatThaiCurrency(calc.amount_shift)} />
                      </div>
                    )}

                    {/* Clerk OT — read-only, pulled from shift entries (item 4) */}
                    {isClerk && (
                      <div className="space-y-4">
                        {/* 1.5x OT (Weekday) */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <Label className="text-slate-700 font-semibold">ค่าล่วงเวลา OT ปกติ (1.5เท่า)</Label>
                            <span className="text-xs text-slate-500">
                              อัตรา: {formatThaiCurrency(((selectedEmployee?.rate_per_12h || 0) / 30 / 8 * 1.5))} บาท/ชม.
                            </span>
                          </div>
                          <div className="flex gap-2 items-center">
                            <div className="w-28 h-8 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-center text-slate-700 font-semibold text-sm shrink-0">
                              {autoClerkOtHours} ชม.
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">(จากหน้ากะ)</span>
                            <Input className="bg-slate-50 flex-1 h-8" readOnly value={formatThaiCurrency(calc.amount_ot)} />
                          </div>
                        </div>

                        {/* 1.0x OT (Weekend) */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <div className="flex justify-between items-center">
                            <Label className="text-purple-700 font-semibold">ค่าล่วงเวลา OT วันหยุด (1เท่า)</Label>
                            <span className="text-xs text-slate-500">
                              อัตรา: {formatThaiCurrency(((selectedEmployee?.rate_per_12h || 0) / 30 / 8 * 1.0))} บาท/ชม.
                            </span>
                          </div>
                          <div className="flex gap-2 items-center">
                            <div className="w-28 h-8 bg-purple-50 border border-purple-200 rounded-md flex items-center justify-center text-purple-700 font-semibold text-sm shrink-0">
                              {autoClerkOt1xHours} ชม.
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">(จากหน้ากะเสาร์-อาทิตย์)</span>
                            <Input className="bg-purple-50 text-purple-900 border-purple-200 flex-1 h-8" readOnly value={formatThaiCurrency(calc.amount_ot_1x || 0)} />
                          </div>
                        </div>
                        
                        {(autoClerkOtHours === 0 && autoClerkOt1xHours === 0) && (
                          <p className="text-xs text-slate-400">ยังไม่มีการกรอก OT ในหน้ากะ</p>
                        )}
                      </div>
                    )}

                    {/* OT holiday for workers */}
                    {!isClerk && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold">OT วันหยุด</Label>
                          <span className="text-xs text-slate-500">คำนวณอัตโนมัติ: {holidayOtHours} ชม.</span>
                        </div>
                        <Input className="bg-slate-50" readOnly value={formatThaiCurrency(calc.amount_ot)} />
                      </div>
                    )}

                    <hr className="my-4" />

                    {/* Wood/Film — hidden for clerk, pencil override for worker (item 8) */}
                    {!isClerk ? (
                      <div className="grid grid-cols-1 gap-3">
                        {/* Wood excess — pencil+reason override (item 8) */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <Label>ค่าไม้ส่วนเกิน</Label>
                            <span className="text-xs text-slate-400">รวมจากกะ: {formatThaiCurrency(autoWood)}</span>
                          </div>
                          {isEditingWood ? (
                            <div className="space-y-2">
                              <Input
                                type="number"
                                value={overrideWood ?? autoWood}
                                onChange={e => setOverrideWood(Number(e.target.value) || 0)}
                                className="border-amber-300 bg-amber-50"
                                autoFocus
                                disabled={isApproved}
                              />
                              <Input
                                placeholder="เหตุผลที่แก้ไข..."
                                value={overrideReason}
                                onChange={e => setOverrideReason(e.target.value)}
                                className="text-sm"
                                disabled={isApproved}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="bg-[#1D9E75] hover:bg-[#157a5a]" onClick={() => setIsEditingWood(false)}>ยืนยัน</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setOverrideWood(null); setIsEditingWood(false) }}>รีเซ็ต</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <Input
                                className={`pr-10 ${overrideWood !== null ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-emerald-50 border-emerald-200'}`}
                                readOnly
                                value={formatThaiCurrency(effectiveWood)}
                              />
                              {!isApproved && (
                                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                  <button
                                    onClick={() => { setOverrideWood(overrideWood ?? autoWood); setIsEditingWood(true) }}
                                    className="text-slate-400 hover:text-[#1D9E75]"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Film — pencil+reason override */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <Label>ค่าฟิล์ม</Label>
                            <span className="text-xs text-slate-400">รวมจากกะ: {formatThaiCurrency(autoFilm)}</span>
                          </div>
                          {isEditingFilm ? (
                            <div className="space-y-2">
                              <Input
                                type="number"
                                value={overrideFilm ?? autoFilm}
                                onChange={e => setOverrideFilm(Number(e.target.value) || 0)}
                                className="border-amber-300 bg-amber-50"
                                autoFocus
                                disabled={isApproved}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="bg-[#1D9E75] hover:bg-[#157a5a]" onClick={() => setIsEditingFilm(false)}>ยืนยัน</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setOverrideFilm(null); setIsEditingFilm(false) }}>รีเซ็ต</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <Input
                                className={`pr-10 ${overrideFilm !== null ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-emerald-50 border-emerald-200'}`}
                                readOnly
                                value={formatThaiCurrency(effectiveFilm)}
                              />
                              {!isApproved && (
                                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                  <button
                                    onClick={() => { setOverrideFilm(overrideFilm ?? autoFilm); setIsEditingFilm(true) }}
                                    className="text-slate-400 hover:text-[#1D9E75]"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <Label>เงินพิเศษ</Label>
                            {autoSpecial > 0 && (
                              <span className="text-[10px] text-slate-400">จากสลับตำแหน่ง: {formatThaiCurrency(autoSpecial)}</span>
                            )}
                          </div>
                          
                          {isEditingSpecial ? (
                            <div className="space-y-2 p-3 border border-[#1D9E75]/30 bg-[#1D9E75]/5 rounded-lg animate-in fade-in">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-[#1D9E75] font-bold uppercase">จำนวนเงิน (บาท)</Label>
                                <Input
                                  type="number"
                                  value={overrideSpecial ?? autoSpecial}
                                  onChange={e => setOverrideSpecial(Number(e.target.value) || 0)}
                                  className="border-[#1D9E75]/30 bg-white"
                                  autoFocus
                                  disabled={isApproved}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-[#1D9E75] font-bold uppercase">หมายเหตุ (จำเป็น)</Label>
                                <Input
                                  placeholder="ระบุเหตุผล เช่น ค่าสลับตำแหน่ง, เบี้ยขยันพิเศษ..."
                                  value={specialNote || autoSpecialNote}
                                  onChange={e => setSpecialNote(e.target.value)}
                                  className="border-[#1D9E75]/30 bg-white"
                                  disabled={isApproved}
                                />
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" className="bg-[#1D9E75] hover:bg-[#157a5a]" onClick={() => setIsEditingSpecial(false)}>ตกลง</Button>
                                <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => { 
                                  setOverrideSpecial(null); 
                                  setSpecialNote(''); 
                                  setIsEditingSpecial(false) 
                                }}>รีเซ็ต</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="relative group">
                                <Input
                                  className={`pr-10 ${overrideSpecial !== null ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'}`}
                                  readOnly
                                  value={formatThaiCurrency(effectiveSpecial)}
                                />
                                {!isApproved && (
                                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 group-hover:opacity-100 opacity-100 md:opacity-0 transition-opacity">
                                    <button
                                      onClick={() => { 
                                        setOverrideSpecial(overrideSpecial ?? autoSpecial); 
                                        setSpecialNote(specialNote || autoSpecialNote);
                                        setIsEditingSpecial(true) 
                                      }}
                                      className="text-slate-400 hover:text-[#1D9E75]"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              {(specialNote || autoSpecialNote) && (
                                <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-1">
                                  📝 {specialNote || autoSpecialNote}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label>เบี้ยขยัน</Label>
                          <Input type="number" name="amount_diligence" className="w-full" value={manualEntries.amount_diligence || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>ค่าตำแหน่ง</Label>
                          <Input type="number" name="amount_position" className="w-full" value={manualEntries.amount_position || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                      </div>
                    ) : (
                      /* Clerk: only special/diligence/position bonuses */
                      <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <Label>เงินพิเศษ</Label>
                            {autoSpecial > 0 && (
                              <span className="text-[10px] text-slate-400">จากสลับตำแหน่ง: {formatThaiCurrency(autoSpecial)}</span>
                            )}
                          </div>
                          
                          {isEditingSpecial ? (
                            <div className="space-y-2 p-3 border border-[#1D9E75]/30 bg-[#1D9E75]/5 rounded-lg animate-in fade-in">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-[#1D9E75] font-bold uppercase">จำนวนเงิน (บาท)</Label>
                                <Input
                                  type="number"
                                  value={overrideSpecial ?? autoSpecial}
                                  onChange={e => setOverrideSpecial(Number(e.target.value) || 0)}
                                  className="border-[#1D9E75]/30 bg-white"
                                  autoFocus
                                  disabled={isApproved}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-[#1D9E75] font-bold uppercase">หมายเหตุ (จำเป็น)</Label>
                                <Input
                                  placeholder="ระบุเหตุผล เช่น ค่าสลับตำแหน่ง, เบี้ยขยันพิเศษ..."
                                  value={specialNote || autoSpecialNote}
                                  onChange={e => setSpecialNote(e.target.value)}
                                  className="border-[#1D9E75]/30 bg-white"
                                  disabled={isApproved}
                                />
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" className="bg-[#1D9E75] hover:bg-[#157a5a]" onClick={() => setIsEditingSpecial(false)}>ตกลง</Button>
                                <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => { 
                                  setOverrideSpecial(null); 
                                  setSpecialNote(''); 
                                  setIsEditingSpecial(false) 
                                }}>รีเซ็ต</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="relative group">
                                <Input
                                  className={`pr-10 ${overrideSpecial !== null ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'}`}
                                  readOnly
                                  value={formatThaiCurrency(effectiveSpecial)}
                                />
                                {!isApproved && (
                                  <button
                                    onClick={() => { 
                                      setOverrideSpecial(overrideSpecial ?? autoSpecial); 
                                      setSpecialNote(specialNote || autoSpecialNote);
                                      setIsEditingSpecial(true) 
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#1D9E75] p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              {(specialNote || autoSpecialNote) && (
                                <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-1">
                                  📝 {specialNote || autoSpecialNote}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label>เบี้ยขยัน</Label>
                          <Input type="number" name="amount_diligence" className="w-full" value={manualEntries.amount_diligence || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>ค่าตำแหน่ง</Label>
                          <Input type="number" name="amount_position" className="w-full" value={manualEntries.amount_position || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* DEDUCTIONS COLUMN */}
                <div className="space-y-6">
                  <Card className="border-t-4 border-t-rose-500 shadow-sm">
                    <CardHeader className="bg-rose-50/50 pb-4">
                      <CardTitle className="text-rose-800 flex justify-between items-center">
                        รายการหัก (Deductions)
                        <span className="text-sm font-normal text-rose-600">หน่วย: บาท</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-6">

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold flex items-center">
                            <Lock className="w-3 h-3 mr-1.5 text-slate-400" />
                            ประกันสังคม ({(socialSecurityRate * 100).toFixed(0)}%)
                          </Label>
                        </div>
                        <Input className="bg-slate-100 text-slate-500 border-slate-200" readOnly value={formatThaiCurrency(calc.deduct_social_security)} />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold flex items-center">
                            <Lock className="w-3 h-3 mr-1.5 text-slate-400" />
                            เบิกล่วงหน้า
                          </Label>
                        </div>
                        <Input className="bg-slate-100 text-slate-500 border-slate-200" readOnly value={formatThaiCurrency(totalAdvance)} />
                      </div>

                      <hr className="my-4" />

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>ค่าอุปกรณ์ความปลอดภัย</Label>
                          <Input type="number" name="deduct_safety_equipment" className="w-full" value={manualEntries.deduct_safety_equipment || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>ค่าเสื้อพนักงาน</Label>
                          <Input type="number" name="deduct_uniform" className="w-full" value={manualEntries.deduct_uniform || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                        </div>
                      </div>

                    </CardContent>
                  </Card>

                  {/* SUMMARY TOTALS */}
                  <Card className="bg-[#1D9E75]/5 border-[#1D9E75]/20 shadow-sm">
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-emerald-800">
                          <span className="font-medium">รวมรายได้</span>
                          <span className="text-lg font-bold">{formatThaiCurrency(calc.total_income)}</span>
                        </div>
                        <div className="flex justify-between items-center text-rose-700">
                          <span className="font-medium">รวมรายการหัก</span>
                          <span className="text-lg font-bold">{formatThaiCurrency(calc.total_deductions)}</span>
                        </div>
                        <div className="pt-3 border-t border-[#1D9E75]/20 flex flex-col sm:flex-row sm:justify-between sm:items-center text-[#1D9E75] gap-1">
                          <span className="font-bold text-lg">รวมสุทธิ (Net Pay)</span>
                          <span className="text-2xl sm:text-3xl font-black whitespace-nowrap">{formatThaiCurrency(calc.net_pay)} ฿</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                </div>
              </div>

              {/* Save Button at bottom */}
              <div className="pt-4 pb-8">
                <Button
                  onClick={() => saveMutation.mutate()}
                  className="w-full md:w-auto md:min-w-[240px] md:float-right h-14 md:h-12 text-base md:text-lg font-bold bg-[#1D9E75] hover:bg-[#157a5a] shadow-md rounded-xl transition-all active:scale-[0.98]"
                  disabled={saveMutation.isPending || !selectedEmployeeId || isApproved}
                >
                  <Save className="w-5 h-5 mr-2 md:w-6 md:h-6" />
                  {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลค่าจ้าง'}
                </Button>
                <div className="clear-both"></div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  )
}
