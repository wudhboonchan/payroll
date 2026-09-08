import { DeductionProductPicker } from '../components/payroll/DeductionProductPicker'
import React, { useState, useMemo, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import {
  Save, CheckCircle2, AlertCircle, Search, X,
  Clock, ChevronDown, ChevronUp,
  Sparkles, RefreshCw, AlertTriangle, Pencil, RotateCcw
} from 'lucide-react'
import { calculateTpiPayroll, isEndOfMonthPeriod } from '../features/tpi/payrollCalc'
import type { AttendanceLog } from '../features/tpi/attendanceApi'
import { loadMonthlyAttendanceLogs, getAttendanceTypeLabel, formatAttendanceSummary } from '../features/tpi/attendanceApi'
import { formatEmployeeFullName, formatThaiDateDDMMYYYY } from '../lib/formatters'
import '../styles/tokens.css'

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix: string | null
  nationality: string | null
  national_id?: string | null
  position: string | null
  job_title: string | null
  wage_type: string | null
  rate_per_12h: number | null
  exempt_social_security: boolean | null
  is_safety_officer?: boolean | null
  has_position_allowance?: boolean | null
  social_security_number?: string | null
  data_complete?: boolean | null
}

interface PayrollRow {
  employee_id: string
  amount_normal: number
  amount_shift: number
  amount_ot: number
  amount_special: number
  override_special: number | null
  special_note: string | null
  amount_diligence: number
  amount_position: number
  deduct_social_security: number
  deduct_safety_equipment: number
  deduct_uniform: number
  deduct_advance: number
  override_normal: number | null
  override_shift: number | null
  override_reason: string | null
}

interface AdvanceRow {
  employee_id: string
  amount: number
  note: string | null
  created_at: string
}

interface Period {
  id: string
  label: string
  period_start: string
  period_end: string
  status: string
  social_security_rate?: number
}

export const getStoredHolidaysForFactory = (factoryId?: string): Set<string> => {
  const set = new Set<string>()
  if (!factoryId) return set
  try {
    const prefix = `tpi_holiday_${factoryId}_`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix) && localStorage.getItem(key) === 'true') {
        set.add(key.substring(prefix.length))
      }
    }
  } catch {}
  return set
}

// ── Generator for Simulated Sample Shifts for Logic Inspection ──
function generateSimulatedShifts(emp: Employee, periodStart: string, periodEnd: string): TpiShiftRow[] {
  const isClerk = emp.position === 'clerk'
  const shifts: TpiShiftRow[] = []
  const start = new Date(periodStart + 'T00:00:00')
  const end = new Date(periodEnd + 'T00:00:00')
  const current = new Date(start)
  let dayCount = 0

  while (current <= end && dayCount < 11) {
    const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
    const dayOfWeek = current.getDay()

    // Skip Sundays
    if (dayOfWeek !== 0) {
      dayCount++
      if (isClerk) {
        // Clerk: 8h shift, overtime is full 8h shift at 2x, dayCount 3 is public holiday (2x)
        const isHoliday = dayCount === 3
        const hasOt = dayCount === 5 || dayCount === 8
        shifts.push({
          id: `sim-${emp.id}-${dateStr}-0`,
          work_date: dateStr,
          employee_id: emp.id,
          shift_index: 0,
          job_id: 'job-clerk',
          job_code_snapshot: isHoliday ? 'C101 (เสมียน - วันหยุดนักขัตฤกษ์)' : 'C101 (เสมียน)',
          rate_tier: 'normal',
          rate_snapshot: 357,
          is_half_shift: false,
          actual_hours: 8,
          ot_hours: hasOt ? 8 : 0,
          ot_pay: hasOt ? 714 : 0,
          is_holiday_ot: isHoliday,
        })
      } else {
        // Regular worker:
        // Day 3: วันหยุดนักขัตฤกษ์ (ได้ 2 เท่า = 714 บ.)
        // Day 5: ครึ่งกะ (4 ชม. = 178.50 บ.)
        // Day 7 & 9: ช่างฝีมือ (400 บ.)
        // Day 2: OT 2 ชม.
        // Day 6: OT 3 ชม.
        const isHoliday = dayCount === 3
        const isHalf = dayCount === 5
        const isSkilled = dayCount === 7 || dayCount === 9
        const otHrs = dayCount === 2 ? 2 : dayCount === 6 ? 3 : 0
        const base = isSkilled ? 400 : 357
        const wage = isHalf ? base / 2 : base
        const hourlyRate = (base / 8) * 1.5
        const otMoney = otHrs > 0 ? Math.ceil(hourlyRate * otHrs) : 0

        shifts.push({
          id: `sim-${emp.id}-${dateStr}-0`,
          work_date: dateStr,
          employee_id: emp.id,
          shift_index: 0,
          job_id: isSkilled ? 'job-skilled' : 'job-normal',
          job_code_snapshot: isHoliday ? '694014 (วันหยุดนักขัตฤกษ์)' : (isSkilled ? 'P134 (ช่างฝีมือ)' : '694014 (ผลิตครอบ)'),
          rate_tier: isSkilled ? 'skilled' : 'normal',
          rate_snapshot: wage,
          is_half_shift: isHalf,
          actual_hours: isHalf ? 4 : 8,
          ot_hours: otHrs,
          ot_pay: otMoney,
          is_holiday_ot: isHoliday,
        })
      }
    }
    current.setDate(current.getDate() + 1)
  }
  return shifts
}

export default function TpiPayrollEntry() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()

  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'saved' | 'outdated' | 'unsaved' | null>(null)
  const [showDailyBreakdown, setShowDailyBreakdown] = useState<boolean>(true)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const [isSimulated, setIsSimulated] = useState<boolean>(false)
  // Inactive/expired job warning modal state
  const [inactiveJobWarning, setInactiveJobWarning] = useState<{
    empName: string
    empCode: string
    jobCode: string
    jobDesc: string
    reason: 'inactive' | 'expired'
    expiredOn?: string
  } | null>(null)
  const dismissedWarningEmpIds = React.useRef<Set<string>>(new Set())

  // ── 1. Payroll Periods ──
  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('factory_id', user?.factory_id ?? '')
        .order('period_start', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!user?.factory_id,
  })

  const currentPeriod = useMemo(() => {
    if (selectedPeriodId) {
      return periods.find(p => p.id === selectedPeriodId) || periods[0] || null
    }
    return periods[0] || null
  }, [periods, selectedPeriodId])

  // ── 2. Active Employees in TPI ──
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['tpi-employees-payroll', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id,employee_code,first_name,last_name,prefix,nationality,national_id,position,job_title,wage_type,rate_per_12h,exempt_social_security,is_safety_officer,has_position_allowance,social_security_number,data_complete')
        .eq('factory_id', user?.factory_id ?? '')
        .eq('status', 'active')
        .order('employee_code')
      if (error) throw error
      return (data || []).sort((a, b) =>
        (a.employee_code || '').localeCompare(b.employee_code || '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      )
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  // Auto select first employee if none selected
  useEffect(() => {
    if (!selectedEmpId && employees.length > 0) {
      setSelectedEmpId(employees[0].id)
    }
  }, [employees, selectedEmpId])

  // ── 2b. TPI Job Codes (for checking active/expired status) ──
  const { data: dbTpiJobCodes = [] } = useQuery<any[]>({
    queryKey: ['tpi-job-codes-payroll', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('id,code,description,active,expires_on,valid_from,normal_rate,skilled_rate')
        .eq('factory_id', user!.factory_id)
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id,
    staleTime: 60_000,
  })

  // ── 2c. TPI Employee Wage Profiles (for checking skilled tier + bound job) ──
  const { data: dbWageProfiles = [] } = useQuery<any[]>({
    queryKey: ['tpi-wage-profiles-payroll', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('employee_id,rate_tier,job_id,job_code,skilled_from')
        .eq('factory_id', user!.factory_id)
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id,
    staleTime: 60_000,
  })


  const { data: dbShifts = [], isLoading: shiftsLoading } = useQuery<TpiShiftRow[]>({
    queryKey: ['all-tpi-period-shifts', currentPeriod?.id, user?.factory_id],
    queryFn: async () => {
      if (!currentPeriod?.period_start || !currentPeriod?.period_end) return []
      const PAGE = 1000
      let all: any[] = []
      let from = 0
      while (true) {
        try {
          const { data, error } = await supabase
            .from('tpi_shift_entries' as any)
            .select('id,work_date,employee_id,shift_index,job_id,job_code_snapshot,rate_tier,rate_snapshot,is_half_shift,actual_hours,ot_hours,ot_pay,is_holiday_ot')
            .eq('factory_id', user?.factory_id ?? '')
            .gte('work_date', currentPeriod.period_start)
            .lte('work_date', currentPeriod.period_end)
            .range(from, from + PAGE - 1)

          if (error) {
            console.warn('Querying with all columns failed, falling back to base columns:', error)
            const fallback = await supabase
              .from('tpi_shift_entries' as any)
              .select('id,work_date,employee_id,shift_index,job_id,job_code_snapshot,rate_tier,rate_snapshot')
              .eq('factory_id', user?.factory_id ?? '')
              .gte('work_date', currentPeriod.period_start)
              .lte('work_date', currentPeriod.period_end)
              .range(from, from + PAGE - 1)
            if (fallback.error) throw fallback.error
            all = all.concat(fallback.data ?? [])
            if (!fallback.data || fallback.data.length < PAGE) break
          } else {
            all = all.concat(data ?? [])
            if (!data || data.length < PAGE) break
          }
        } catch (e) {
          console.error('Failed to load TPI shifts:', e)
          break
        }
        from += PAGE
      }
      return all as TpiShiftRow[]
    },
    enabled: !!currentPeriod?.id && !!user?.factory_id,
    staleTime: 0,
  })

  // Auto-enable simulation if database has 0 shifts for this period so the user can inspect logic immediately
  useEffect(() => {
    if (!shiftsLoading && dbShifts.length === 0) {
      setIsSimulated(true)
    }
  }, [dbShifts.length, shiftsLoading])

  // Active shifts: either database shifts or simulated shifts
  const allTpiShifts = useMemo(() => {
    if (!isSimulated) {
      const storedHolidays = getStoredHolidaysForFactory(user?.factory_id)
      if (storedHolidays.size === 0) return dbShifts
      return dbShifts.map((s) => {
        if (storedHolidays.has(s.work_date)) {
          return { ...s, is_holiday_ot: true }
        }
        return s
      })
    }
    // Generate simulated shifts for all employees
    if (!currentPeriod) return []
    let sim: TpiShiftRow[] = []
    for (const emp of employees) {
      sim = sim.concat(generateSimulatedShifts(emp, currentPeriod.period_start, currentPeriod.period_end))
    }
    return sim
  }, [isSimulated, dbShifts, employees, currentPeriod, user?.factory_id])

  // ── 4. Existing Payroll Entries in Current Period ──
  const { data: allEntries = [] } = useQuery<PayrollRow[]>({
    queryKey: ['all-payroll-entries', currentPeriod?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_entries' as any)
        .select('employee_id,amount_normal,amount_shift,amount_ot,amount_special,override_special,special_note,amount_diligence,amount_position,deduct_social_security,deduct_safety_equipment,deduct_uniform,deduct_advance,override_normal,override_shift,override_reason')
        .eq('period_id', currentPeriod.id)
        .limit(10000)
      if (error) throw error
      return (data || []) as any
    },
    enabled: !!currentPeriod?.id,
    staleTime: 0,
  })

  // ── 5. Advance Payments in Current Period ──
  const { data: allAdvances = [] } = useQuery<AdvanceRow[]>({
    queryKey: ['advances', 'all', currentPeriod?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advance_payments')
        .select('employee_id,amount,notes,created_at')
        .eq('period_id', currentPeriod.id)
        .limit(10000)
      if (error) throw error
      return (data || []).map((r: any) => ({
        ...r,
        note: r.notes || r.note || null,
      })) as AdvanceRow[]
    },
    enabled: !!currentPeriod?.id,
    staleTime: 30_000,
  })

  // ── Monthly Attendance Scan for Diligence Allowance (1st of month to end of period) ──
  const monthlyScanRange = useMemo(() => {
    if (!currentPeriod?.period_end) return null
    const parts = currentPeriod.period_end.split('-')
    if (parts.length < 2) return null
    return {
      startDate: `${parts[0]}-${parts[1]}-01`,
      endDate: currentPeriod.period_end,
    }
  }, [currentPeriod?.period_end])

  const { data: monthlyAttendance = [] } = useQuery({
    queryKey: ['tpi-monthly-attendance', user?.factory_id, monthlyScanRange?.startDate, monthlyScanRange?.endDate],
    queryFn: async () => {
      if (!user?.factory_id || !monthlyScanRange) return []
      return await loadMonthlyAttendanceLogs(
        user.factory_id,
        monthlyScanRange.startDate,
        monthlyScanRange.endDate
      )
    },
    enabled: !!user?.factory_id && !!monthlyScanRange,
    staleTime: 30_000,
  })

  const attendanceByEmp = useMemo(() => {
    const map = new Map<string, AttendanceLog[]>()
    for (const log of (monthlyAttendance || [])) {
      const list = map.get(log.employee_id) || []
      list.push(log)
      map.set(log.employee_id, list)
    }
    return map
  }, [monthlyAttendance])

  // ── Selected Employee Context ──
  const selectedEmp = employees.find(e => e.id === selectedEmpId) ?? null
  const existingEntry = allEntries.find(e => e.employee_id === selectedEmpId) ?? null
  const empShifts = allTpiShifts.filter(s => s.employee_id === selectedEmpId)

  // In simulation mode, add sample advance & face scan deduction if empty
  const empAdvances = useMemo(() => {
    const real = allAdvances.filter(a => a.employee_id === selectedEmpId)
    if (real.length > 0) return real
    if (isSimulated && selectedEmp) {
      return [
        { employee_id: selectedEmp.id, amount: 500, note: 'เบิกเงินสดฉุกเฉิน' },
        { employee_id: selectedEmp.id, amount: 178.50, note: '[สแกนหน้าไม่สำเร็จ] 04 ก.ย. 2569 รหัสงาน B1' },
        { employee_id: selectedEmp.id, amount: 714, note: '[ลงโทษ ขาดงานไม่มีคนแทน] วันที่: 03 ก.ย. 2569 | กะแรก: B1 (หัก 2 เท่า)' }
      ]
    }
    return []
  }, [allAdvances, selectedEmpId, isSimulated, selectedEmp])

  // Categorize advances for clear reporting: เบิกล่วงหน้า, หักสแกนหน้าไม่ผ่าน, หักลงโทษขาดงานไม่มีคนแทน
  const {
    advRegular,
    advScan,
    advDisc,
    advSafetyFine,
    advRegularTotal,
    advScanTotal,
    advDiscTotal,
    advSafetyFineTotal,
  } = useMemo(() => {
    const reg: typeof empAdvances = []
    const scan: typeof empAdvances = []
    const disc: typeof empAdvances = []
    const safety: typeof empAdvances = []

    for (const adv of empAdvances) {
      const note = adv.note || ''
      if (note.includes('[หักค่าปรับ จป.]') || note.includes('หักค่าปรับผิดระเบียบ') || note.includes('ค่าปรับผิดระเบียบ')) {
        safety.push(adv)
      } else if (note.includes('[สแกนหน้าไม่สำเร็จ]') || note.includes('สแกนหน้าไม่สำเร็จ')) {
        scan.push(adv)
      } else if (
        note.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') ||
        note.includes('ลงโทษ ขาดงาน') ||
        note.includes('[ลงโทษ ขาด/ลา/มาสาย]') ||
        note.includes('ลงโทษ ขาด/ลา/มาสาย')
      ) {
        disc.push(adv)
      } else {
        reg.push(adv)
      }
    }

    const sum = (list: typeof empAdvances) => list.reduce((s, a) => s + Number(a.amount || 0), 0)

    return {
      advRegular: reg,
      advScan: scan,
      advDisc: disc,
      advSafetyFine: safety,
      advRegularTotal: sum(reg),
      advScanTotal: sum(scan),
      advDiscTotal: sum(disc),
      advSafetyFineTotal: sum(safety),
    }
  }, [empAdvances])

  // ── Detect inactive/expired bound job on employee selection ──
  useEffect(() => {
    if (!selectedEmpId || !selectedEmp) return
    // Already dismissed for this employee this session
    if (dismissedWarningEmpIds.current.has(selectedEmpId)) return

    const profile = dbWageProfiles.find(p => p.employee_id === selectedEmpId)
    if (!profile || profile.rate_tier !== 'skilled') return

    // Find the bound job — prefer profile.job_id/job_code, fallback to job_title
    const boundCode = (profile.job_code || selectedEmp.job_title || '').trim().toLowerCase()
    const boundId = profile.job_id || ''
    const boundJob = dbTpiJobCodes.find(j =>
      (boundId && j.id === boundId) ||
      (boundCode && j.code.trim().toLowerCase() === boundCode)
    )
    if (!boundJob) return // Can't verify — skip warning

    const today = new Date().toISOString().split('T')[0]
    const isInactive = !boundJob.active
    const isExpired = !!(boundJob.expires_on && boundJob.expires_on < today)

    if (isInactive || isExpired) {
      setInactiveJobWarning({
        empName: `${selectedEmp.prefix || ''} ${selectedEmp.first_name} ${selectedEmp.last_name}`.trim(),
        empCode: selectedEmp.employee_code,
        jobCode: boundJob.code,
        jobDesc: boundJob.description || '',
        reason: isInactive ? 'inactive' : 'expired',
        expiredOn: boundJob.expires_on || undefined,
      })
    }
  }, [selectedEmpId, selectedEmp, dbWageProfiles, dbTpiJobCodes])


  const [overrideNormal, setOverrideNormal] = useState<number | null>(null)
  const [overrideShift, setOverrideShift] = useState<number | null>(null)
  const [overridePosition, setOverridePosition] = useState<number | null>(null)
  const [overrideSafety, setOverrideSafety] = useState<number | null>(null)
  const [overrideDiligence, setOverrideDiligence] = useState<number | null>(null)
  const [editingPosition, setEditingPosition] = useState(false)
  const [editingSafety, setEditingSafety] = useState(false)
  const [editingDiligence, setEditingDiligence] = useState(false)
  const [specialNote, setSpecialNote] = useState('')
  const [extraEntries, setExtraEntries] = useState({
    amount_diligence: 0,
    amount_position: 0,
    amount_safety: 0,
    amount_other_special: 0,
    deduct_safety_equipment: 0,
    deduct_uniform: 0,
  })

  // Defaults based on database flags & period
  const isEndMonth = isEndOfMonthPeriod(currentPeriod?.period_end || '')
  const defaultPosition = (isEndMonth && selectedEmp?.has_position_allowance) ? 1000 : 0
  const defaultSafety = (isEndMonth && selectedEmp?.is_safety_officer) ? 500 : 0
  const empAttendanceLogs = attendanceByEmp.get(selectedEmp?.id || '') || []
  const defaultDiligence = (isEndMonth && empAttendanceLogs.length === 0) ? 300 : 0

  useEffect(() => {
    const isEndMonthLocal = isEndOfMonthPeriod(currentPeriod?.period_end || '')
    const defaultPosLocal = (isEndMonthLocal && selectedEmp?.has_position_allowance) ? 1000 : 0
    const defaultSafeLocal = (isEndMonthLocal && selectedEmp?.is_safety_officer) ? 500 : 0
    const empLogsLocal = attendanceByEmp.get(selectedEmp?.id || '') || []
    const defaultDilLocal = (isEndMonthLocal && empLogsLocal.length === 0) ? 300 : 0

    if (existingEntry) {
      setOverrideNormal(existingEntry.override_normal != null ? Number(existingEntry.override_normal) : null)
      setOverrideShift(existingEntry.override_shift != null ? Number(existingEntry.override_shift) : null)
      setSpecialNote(existingEntry.special_note || '')

      const noteOrReason = ((existingEntry.override_reason || '') + ' ' + (existingEntry.special_note || '')).trim()

      // 1. Position allowance autofill & override detection
      let posAmt = defaultPosLocal
      let hasPosOverride = false
      if (existingEntry.override_reason?.includes('ค่าตำแหน่ง')) {
        const m = existingEntry.override_reason.match(/ค่าตำแหน่ง:\s*฿?([\d,]+)/)
        if (m) {
          posAmt = Number(m[1].replace(/,/g, ''))
          hasPosOverride = true
        } else if (existingEntry.amount_position != null) {
          posAmt = Number(existingEntry.amount_position)
          hasPosOverride = true
        }
      } else if (
        existingEntry.amount_position != null &&
        Number(existingEntry.amount_position) > 0 &&
        Number(existingEntry.amount_position) !== defaultPosLocal
      ) {
        posAmt = Number(existingEntry.amount_position)
        hasPosOverride = true
      }
      setOverridePosition(hasPosOverride ? posAmt : null)
      setEditingPosition(false)

      // 2. Safety allowance autofill & override detection
      const totalSpec = Number(existingEntry.override_special ?? existingEntry.amount_special ?? 0)
      let safeAmt = defaultSafeLocal
      let otherAmt = 0
      let hasSafetyOverride = false

      if (existingEntry.override_reason?.includes('ค่า จป.')) {
        const m = existingEntry.override_reason.match(/ค่า จป\.:\s*฿?([\d,]+)/)
        if (m) {
          safeAmt = Number(m[1].replace(/,/g, ''))
          hasSafetyOverride = true
        } else {
          safeAmt = Math.min(500, totalSpec)
          hasSafetyOverride = true
        }
        otherAmt = Math.max(0, totalSpec - safeAmt)
      } else if (noteOrReason.includes('ค่า จป.') && totalSpec > 0 && totalSpec !== defaultSafeLocal) {
        safeAmt = Math.min(500, totalSpec)
        otherAmt = Math.max(0, totalSpec - safeAmt)
        hasSafetyOverride = true
      } else {
        if (totalSpec >= defaultSafeLocal && defaultSafeLocal > 0) {
          safeAmt = defaultSafeLocal
          otherAmt = totalSpec - defaultSafeLocal
        } else {
          safeAmt = defaultSafeLocal
          otherAmt = totalSpec
        }
      }
      setOverrideSafety(hasSafetyOverride ? safeAmt : null)
      setEditingSafety(false)

      // 3. Diligence allowance autofill & override detection
      let dilAmt = defaultDilLocal
      let hasDilOverride = false
      if (existingEntry.override_reason?.includes('เบี้ยขยัน')) {
        const m = existingEntry.override_reason.match(/เบี้ยขยัน:\s*฿?([\d,]+)/)
        if (m) {
          dilAmt = Number(m[1].replace(/,/g, ''))
          hasDilOverride = true
        } else if (existingEntry.amount_diligence != null) {
          dilAmt = Number(existingEntry.amount_diligence)
          hasDilOverride = true
        }
      } else if (
        existingEntry.amount_diligence != null &&
        Number(existingEntry.amount_diligence) !== defaultDilLocal
      ) {
        dilAmt = Number(existingEntry.amount_diligence)
        hasDilOverride = true
      }
      setOverrideDiligence(hasDilOverride ? dilAmt : null)
      setEditingDiligence(false)

      setExtraEntries({
        amount_diligence: dilAmt,
        amount_position: posAmt,
        amount_safety: safeAmt,
        amount_other_special: otherAmt,
        deduct_safety_equipment: Number(existingEntry.deduct_safety_equipment || 0),
        deduct_uniform: Number(existingEntry.deduct_uniform || 0),
      })
    } else {
      setOverrideNormal(null)
      setOverrideShift(null)
      setOverridePosition(null)
      setOverrideSafety(null)
      setOverrideDiligence(null)
      setEditingPosition(false)
      setEditingSafety(false)
      setEditingDiligence(false)
      setSpecialNote(defaultSafeLocal > 0 ? 'ค่า จป. 500 บาท' : '')
      setExtraEntries({
        amount_diligence: defaultDilLocal,
        amount_position: defaultPosLocal,
        amount_safety: defaultSafeLocal,
        amount_other_special: 0,
        deduct_safety_equipment: 0,
        deduct_uniform: 0,
      })
    }
  }, [existingEntry, selectedEmpId, isSimulated, selectedEmp?.position, selectedEmp?.has_position_allowance, selectedEmp?.is_safety_officer, currentPeriod?.period_end, attendanceByEmp])

  // ── Main Calculation for Selected Employee ──
  const calc = useMemo(() => {
    if (!selectedEmp || !currentPeriod) return null
    return calculateTpiPayroll({
      employee: selectedEmp,
      shifts: empShifts,
      advances: empAdvances,
      period: currentPeriod,
      overrides: {
        override_normal: overrideNormal,
        override_shift: overrideShift,
      },
      extras: {
        amount_diligence: extraEntries.amount_diligence,
        amount_position: extraEntries.amount_position,
        amount_special: (extraEntries.amount_safety || 0) + (extraEntries.amount_other_special || 0),
        special_note: specialNote,
        deduct_safety_equipment: extraEntries.deduct_safety_equipment,
        deduct_uniform: extraEntries.deduct_uniform,
      },
    })
  }, [selectedEmp, empShifts, empAdvances, currentPeriod, overrideNormal, overrideShift, extraEntries, specialNote])

  // ── Outdated Detection across all employees ──
  const outdatedSet = useMemo(() => {
    const set = new Set<string>()
    if (!currentPeriod || isSimulated) return set
    const eps = 0.5

    for (const entry of allEntries) {
      const emp = employees.find(e => e.id === entry.employee_id)
      if (!emp) continue
      const shifts = allTpiShifts.filter(s => s.employee_id === emp.id)
      const advances = allAdvances.filter(a => a.employee_id === emp.id)

      const result = calculateTpiPayroll({
        employee: emp,
        shifts,
        advances,
        period: currentPeriod,
        overrides: {
          override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
          override_shift: entry.override_shift != null ? Number(entry.override_shift) : null,
        },
        extras: {
          amount_diligence: Number(entry.amount_diligence || 0),
          amount_position: Number(entry.amount_position || 0),
          amount_special: Number(entry.amount_special || 0),
          special_note: entry.special_note || '',
          deduct_safety_equipment: Number(entry.deduct_safety_equipment || 0),
          deduct_uniform: Number(entry.deduct_uniform || 0),
        },
      })

      const checks: [number, number][] = [
        [result.effectiveNormal, Number(entry.amount_normal)],
        [result.effectiveShift, Number(entry.amount_shift)],
        [result.totalOtPay, Number(entry.amount_ot)],
        [result.deductAdvance, Number(entry.deduct_advance)],
        [result.deductSocialSecurity, Number(entry.deduct_social_security)],
        [result.amountPosition, Number(entry.amount_position || 0)],
        [result.amountSpecial, Number(entry.amount_special || 0)],
      ]

      if (checks.some(([a, b]) => Math.abs(a - b) > eps)) {
        set.add(emp.id)
      }
    }
    return set
  }, [allEntries, allTpiShifts, allAdvances, employees, currentPeriod, isSimulated])

  const isOutdated = outdatedSet.has(selectedEmpId ?? '')

  function empStatus(empId: string): 'saved' | 'unsaved' | 'outdated' | 'none' {
    if (isSimulated) return 'saved'
    const hasShifts = allTpiShifts.some(s => s.employee_id === empId)
    if (!hasShifts) return 'none'
    const hasEntry = allEntries.some(e => e.employee_id === empId)
    if (!hasEntry) return 'unsaved'
    return outdatedSet.has(empId) ? 'outdated' : 'saved'
  }

  // ── Save Mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmpId || !currentPeriod?.id || !calc) return
      if (isSimulated) {
        toast.info('อยู่ในโหมดจำลองข้อมูล: ทดลองบันทึกสำเร็จ (ไม่ทับฐานข้อมูลจริง)')
        return
      }

      const specAmt = (extraEntries.amount_safety || 0) + (extraEntries.amount_other_special || 0)
      let note = (specialNote || '').trim()
      if (extraEntries.amount_safety > 0 && !note.includes('ค่า จป.')) {
        note = note ? `ค่า จป. ${extraEntries.amount_safety} บาท, ${note}` : `ค่า จป. ${extraEntries.amount_safety} บาท`
      }

      const overrideReasons: string[] = []
      if (overrideNormal !== null) overrideReasons.push(`ค่าจ้างปกติกะแรก: ฿${overrideNormal}`)
      if (overrideShift !== null) overrideReasons.push(`ค่ากะ: ฿${overrideShift}`)
      if (overridePosition !== null) overrideReasons.push(`ค่าตำแหน่ง: ฿${overridePosition}`)
      if (overrideSafety !== null) overrideReasons.push(`ค่า จป.: ฿${overrideSafety}`)
      if (overrideDiligence !== null) overrideReasons.push(`เบี้ยขยัน: ฿${overrideDiligence}`)
      const reasonStr = overrideReasons.join(', ')

      const payload = {
        period_id: currentPeriod.id,
        employee_id: selectedEmpId,
        amount_normal: Math.round(calc.effectiveNormal * 100) / 100,
        amount_shift: Math.round(calc.effectiveShift * 100) / 100,
        amount_ot: Math.round(calc.effectiveOt * 100) / 100,
        amount_wood_excess: 0,
        amount_film: 0,
        amount_special: Math.round(calc.amountSpecial * 100) / 100,
        override_special: specAmt || null,
        special_note: note,
        amount_diligence: extraEntries.amount_diligence,
        amount_position: extraEntries.amount_position,
        deduct_social_security: Math.round(calc.deductSocialSecurity * 100) / 100,
        deduct_safety_equipment: extraEntries.deduct_safety_equipment,
        deduct_uniform: extraEntries.deduct_uniform,
        deduct_advance: Math.round(calc.deductAdvance * 100) / 100,
        override_normal: overrideNormal,
        override_shift: overrideShift,
        override_reason: reasonStr,
      }

      const { error } = await supabase
        .from('payroll_entries' as any)
        .upsert([payload], { onConflict: 'period_id,employee_id' })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-payroll-entries', currentPeriod?.id] })
      queryClient.invalidateQueries({ queryKey: ['superuser-overrides'] })
      queryClient.invalidateQueries({ queryKey: ['v2-stats'] })
      queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] })
      toast.success('บันทึกข้อมูลค่าจ้างสำเร็จ')
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const monoNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
      <TopBar title="กรอกค่าจ้าง" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      {/* ── Inactive / Expired Job Warning Modal ── */}
      {inactiveJobWarning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, maxWidth: 480, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: '2px solid #fca5a5',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626' }}>
                  แจ้งเตือน: รหัสงานฝีมือ{inactiveJobWarning.reason === 'inactive' ? 'ปิดใช้งานแล้ว' : 'หมดอายุแล้ว'}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  กรุณาตรวจสอบก่อนบันทึกค่าจ้าง
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{ background: '#fef2f2', borderRadius: 8, padding: '12px 16px', marginBottom: 16, border: '1px solid #fecaca' }}>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
                <div><strong>พนักงาน:</strong> {inactiveJobWarning.empName} ({inactiveJobWarning.empCode})</div>
                <div><strong>รหัสงานที่ผูกไว้:</strong> {inactiveJobWarning.jobCode}{inactiveJobWarning.jobDesc ? ` — ${inactiveJobWarning.jobDesc}` : ''}</div>
                <div>
                  <strong>สถานะ:</strong>{' '}
                  <span style={{ color: '#dc2626', fontWeight: 700 }}>
                    {inactiveJobWarning.reason === 'inactive'
                      ? 'ปิดใช้งาน (Inactive)'
                      : `หมดอายุ เมื่อ ${inactiveJobWarning.expiredOn}`}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.6 }}>
              พนักงานคนนี้ถูกตั้งค่าเป็น <strong>ค่าแรงฝีมือ</strong> แต่รหัสงานที่ผูกไว้ไม่สามารถใช้งานได้แล้ว
              ระบบอาจคำนวณค่าจ้างผิดพลาด — แนะนำให้แก้ไขในหน้าฐานข้อมูลพนักงานก่อน
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  dismissedWarningEmpIds.current.add(selectedEmpId || '')
                  setInactiveJobWarning(null)
                }}
                style={{ fontSize: 13, padding: '8px 18px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600 }}
              >
                รับทราบ / ปิด
              </button>
              <button
                onClick={() => {
                  dismissedWarningEmpIds.current.add(selectedEmpId || '')
                  setInactiveJobWarning(null)
                  window.location.href = '/employees'
                }}
                style={{ fontSize: 13, padding: '8px 18px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
              >
                ไปที่หน้าฐานข้อมูลพนักงาน →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Period Selector & Simulation Banner ── */}
      <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#9a3412' }}>
            <span>งวดจ่ายเงินเดือน:</span>
            <select
              value={currentPeriod?.id || ''}
              onChange={e => setSelectedPeriodId(e.target.value)}
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #fdba74', background: '#ffffff', color: '#7c2d12', fontWeight: 600 }}
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label || `${p.period_start} ถึง ${p.period_end}`}
                </option>
              ))}
            </select>
          </div>

          {isSimulated && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ea580c', color: '#ffffff', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              <Sparkles style={{ width: 12, height: 12 }} />
              โหมดจำลองข้อมูลกะ (Simulation Mode)
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setIsSimulated(prev => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              border: `1px solid ${isSimulated ? '#ea580c' : 'var(--vk-rule-soft)'}`,
              background: isSimulated ? '#fff' : 'rgba(0,0,0,0.04)',
              color: isSimulated ? '#c2410c' : 'var(--vk-ink-2)',
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} />
            {isSimulated ? 'สลับกลับใช้ข้อมูลกะจริงในฐานข้อมูล' : '⚡ เปิดโหมดจำลองกะเพื่อดูตรรกะ'}
          </button>
        </div>
      </div>

      <div className="vk-split">
        {/* Left panel — Employee List */}
        <div
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
          className={`vk-sidebar-scrollable vk-sidebar-scrollable-payroll ${selectedEmpId ? 'hidden md:block' : ''}`}
        >
          {/* Header */}
          <div style={{ flexShrink: 0, padding: '16px 12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="vk-eyebrow">รายชื่อพนักงาน ({employees.length})</div>
            </div>

            {/* Filter Chips */}
            <div style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                { key: 'saved', color: 'var(--vk-jade)', label: 'บันทึกแล้ว' },
                { key: 'outdated', color: 'var(--vk-persimmon)', label: 'มีการเปลี่ยนแปลง' },
                { key: 'unsaved', color: '#d4cfc9', label: 'ยังไม่บันทึก' },
              ] as const).map(s => {
                const active = statusFilter === s.key
                return (
                  <button
                    key={s.key}
                    onClick={() => setStatusFilter(active ? null : s.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      border: `1px solid ${active ? s.color : 'var(--vk-rule-soft)'}`,
                      borderRadius: 999,
                      cursor: 'pointer',
                      background: active ? `${s.color}22` : 'transparent',
                      color: active ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                      fontFamily: 'var(--vk-sans)',
                      fontWeight: active ? 700 : 400,
                      fontSize: 10,
                      transition: 'all 120ms',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                    {s.label}
                  </button>
                )
              })}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: 'var(--vk-ink-3)', pointerEvents: 'none' }} />
              <input
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรือรหัส..."
                style={{
                  width: '100%',
                  height: 32,
                  paddingLeft: 26,
                  paddingRight: empSearch ? 26 : 8,
                  fontSize: 12,
                  fontFamily: 'var(--vk-sans)',
                  border: '1px solid var(--vk-rule)',
                  background: 'var(--vk-bone)',
                  color: 'var(--vk-ink)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {empSearch && (
                <button
                  onClick={() => setEmpSearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--vk-ink-3)', display: 'flex' }}
                >
                  <X style={{ width: 11, height: 11 }} />
                </button>
              )}
            </div>
            <hr className="vk-rule-soft" style={{ margin: 0 }} />
          </div>

          {/* List */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 16px', marginRight: 1, scrollbarGutter: 'stable' } as React.CSSProperties}>
            {employees.filter(emp => {
              const q = empSearch.toLowerCase()
              const matchSearch = !q || (emp.employee_code || '').toLowerCase().includes(q) || (emp.first_name || '').toLowerCase().includes(q) || (emp.last_name || '').toLowerCase().includes(q)
              const matchStatus = !statusFilter || empStatus(emp.id) === statusFilter
              return matchSearch && matchStatus
            }).map(emp => {
              const status = empStatus(emp.id)
              const active = emp.id === selectedEmpId
              const empShiftCount = allTpiShifts.filter(s => s.employee_id === emp.id).length
              const empHasOt = allTpiShifts.some(s => s.employee_id === emp.id && (s.ot_hours ?? 0) > 0)
              const empAttendanceLogs = attendanceByEmp.get(emp.id) || []
              const empEntry = allEntries.find(e => e.employee_id === emp.id)
              const empHasOvr = empEntry && (
                empEntry.override_normal != null ||
                empEntry.override_shift != null ||
                (empEntry.override_reason && String(empEntry.override_reason).trim().length > 0)
              )

              return (
                <div
                  key={emp.id}
                  onClick={() => setSelectedEmpId(emp.id)}
                  className="vk-employee-card"
                  data-selected={active}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: status === 'saved' ? 'var(--vk-jade)' : status === 'outdated' ? 'var(--vk-persimmon)' : '#d4cfc9',
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {/* Line 1: Employee Name + Position Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {formatEmployeeFullName(emp, true)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {empHasOvr && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d', flexShrink: 0 }}>
                              Override
                            </span>
                          )}
                          {emp.position === 'clerk' && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>
                              เสมียน
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Line 2: Employee Code on LEFT, Shift/OT/Attendance Badges fixed on RIGHT */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)', flexShrink: 0 }}>
                          {emp.employee_code}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {empAttendanceLogs.length > 0 && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: '#fee2e2',
                                color: '#b91c1c',
                                border: '1px solid #fca5a5'
                              }}
                              title={`ประวัติ ขาด/ลา/สาย ในเดือนนี้ (${empAttendanceLogs.length} ครั้ง):\n${empAttendanceLogs.map(l => `• ${l.work_date}: ${getAttendanceTypeLabel(l.type, l.leave_type)} ${l.reason ? `(${l.reason})` : ''}`).join('\n')}`}
                            >
                              ⚠️ {empAttendanceLogs.length}
                            </span>
                          )}
                          {empShiftCount > 0 ? (
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--vk-ink-2)', background: 'var(--vk-paper)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--vk-rule-soft)' }}>
                              {empShiftCount} กะ
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--vk-ink-4)' }}>ไม่มีกะ</span>
                          )}
                          {empHasOt && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#ffedd5', color: '#c2410c', border: '1px solid #fed7aa' }}>
                              OT
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right panel — Calculation & Breakdown */}
        <div style={{ overflowY: 'auto', padding: '16px' }} className="md:px-8 md:py-6">
          {selectedEmp && (
            <button
              className="vk-btn md:hidden"
              style={{ marginBottom: 12, fontSize: 12, padding: '5px 12px' }}
              onClick={() => setSelectedEmpId(null)}
            >
              ← กลับ
            </button>
          )}

          {!selectedEmp ? (
            <div style={{ paddingTop: 60, textAlign: 'center' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 10 }}>เลือกพนักงานจากรายการทางซ้าย</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 32, justifyContent: 'center' }}>
                {([
                  { color: 'var(--vk-jade)', label: 'บันทึกแล้ว' },
                  { color: 'var(--vk-persimmon)', label: 'มีการเปลี่ยนแปลง' },
                  { color: '#d4cfc9', label: 'ยังไม่บันทึก' },
                ] as { color: string; label: string }[]).map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
                    <span className="vk-small" style={{ color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ marginBottom: 20 }}>
                {(() => {
                  const parts: string[] = []
                  const norm = overrideNormal !== null ? overrideNormal : (existingEntry?.override_normal != null ? Number(existingEntry.override_normal) : null)
                  if (norm !== null) parts.push(`ค่าจ้างปกติ: ฿${norm.toLocaleString()}`)

                  const shift = overrideShift !== null ? overrideShift : (existingEntry?.override_shift != null ? Number(existingEntry.override_shift) : null)
                  if (shift !== null) parts.push(`ค่ากะ: ฿${shift.toLocaleString()}`)

                  const posVal = overridePosition !== null ? overridePosition : (
                    existingEntry?.override_reason?.includes('ค่าตำแหน่ง') && existingEntry.amount_position != null
                      ? Number(existingEntry.amount_position)
                      : null
                  )
                  if (posVal !== null) parts.push(`ค่าตำแหน่ง: ฿${posVal.toLocaleString()}`)

                  const safeVal = overrideSafety !== null ? overrideSafety : (
                    existingEntry?.override_reason?.includes('ค่า จป.')
                      ? (extraEntries.amount_safety || 0)
                      : null
                  )
                  if (safeVal !== null) parts.push(`ค่า จป.: ฿${safeVal.toLocaleString()}`)

                  const dilVal = overrideDiligence !== null ? overrideDiligence : (
                    existingEntry?.override_reason?.includes('เบี้ยขยัน') && existingEntry.amount_diligence != null
                      ? Number(existingEntry.amount_diligence)
                      : null
                  )
                  if (dilVal !== null) parts.push(`เบี้ยขยัน: ฿${dilVal.toLocaleString()}`)

                  const hasOvr = norm !== null || shift !== null || posVal !== null || safeVal !== null || dilVal !== null
                  const summaryText = parts.join(' · ')

                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 2 }}>
                          PAYROLL ENTRY · {currentPeriod?.label} {isSimulated ? '(จำลองเพื่อตรวจสอบตรรกะ)' : ''}
                        </div>
                        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
                          {formatEmployeeFullName(selectedEmp, true)}
                          {selectedEmp.nationality && (
                            <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--vk-ink-3)', marginLeft: 6 }}>
                              ({selectedEmp.nationality})
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                          {selectedEmp.employee_code}
                          {' · '}
                          {selectedEmp.position === 'clerk' ? 'พนักงานกลุ่มเสมียน' : 'พนักงานทั่วไป'}
                          {selectedEmp.job_title ? ` – ${selectedEmp.job_title}` : ''}
                        </div>
                      </div>

                      {/* ── TOP RIGHT CORNER (มุมขวาบนที่ว่างอยู่) ── */}
                      {hasOvr && (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 4,
                          flexShrink: 0,
                        }}>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 14px',
                            background: '#fffbeb',
                            border: '1px solid #f59e0b',
                            borderRadius: 6,
                            color: '#b45309',
                            fontSize: 12,
                            fontWeight: 700,
                            boxShadow: '0 1px 3px rgba(245, 158, 11, 0.12)',
                          }}>
                            <AlertTriangle style={{ width: 15, height: 15, color: '#d97706', flexShrink: 0 }} />
                            <span>มีการปรับแก้ตัวเลขค่าจ้างด้วยตนเอง (Override)</span>
                          </div>
                          {summaryText && (
                            <span style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                              ({summaryText})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
                  {existingEntry && !isOutdated && !isSimulated && (
                    <span className="vk-pill" data-tone="approved">
                      <CheckCircle2 style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />
                      บันทึกแล้ว
                    </span>
                  )}
                  {existingEntry && isOutdated && !isSimulated && (
                    <span className="vk-pill" style={{ background: 'rgba(177,71,41,0.10)', color: 'var(--vk-persimmon)', border: '1px solid var(--vk-persimmon)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, letterSpacing: '0.04em' }}>
                      <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />
                      OUTDATED · มีการแก้ไขกะหรือยอดเบิก กรุณาบันทึกใหม่
                    </span>
                  )}
                  <button
                    className="vk-btn vk-btn--primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || !calc}
                  >
                    <Save style={{ width: 14, height: 14 }} />
                    {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกค่าจ้าง'}
                  </button>
                </div>
              </div>

              {/* Simulation Notice Banner */}
              {isSimulated && (
                <div style={{ background: '#ffedd5', border: '1px solid #fdba74', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Sparkles style={{ width: 18, height: 18, color: '#ea580c', flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.4 }}>
                    <strong>กำลังแสดงผลด้วยโหมดจำลองข้อมูลกะ (Simulation):</strong> เนื่องจากในฐานข้อมูลของงวดนี้ยังไม่มีการกดบันทึกกะจริง ระบบจึงจำลองกะงาน (กะปกติ, กะฝีมือ, ครึ่งกะ, OT, และยอดเบิก) ให้พนักงานคนนี้โดยอัตโนมัติ เพื่อให้ท่านตรวจสอบตรรกะและสูตรการคำนวณเงินค่าแรงได้ทันที
                  </div>
                </div>
              )}

              {/* ── Sticky Warning Banner: Inactive/Expired Skilled Job ── */}
              {(() => {
                const profile = dbWageProfiles.find(p => p.employee_id === selectedEmpId)
                if (!profile || profile.rate_tier !== 'skilled') return null
                const boundCode = (profile.job_code || selectedEmp?.job_title || '').trim().toLowerCase()
                const boundId = profile.job_id || ''
                const boundJob = dbTpiJobCodes.find(j =>
                  (boundId && j.id === boundId) ||
                  (boundCode && j.code.trim().toLowerCase() === boundCode)
                )
                if (!boundJob) return null
                const today = new Date().toISOString().split('T')[0]
                const isInactive = !boundJob.active
                const isExpired = !!(boundJob.expires_on && boundJob.expires_on < today)
                if (!isInactive && !isExpired) return null
                return (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <AlertTriangle style={{ width: 16, height: 16, color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>
                      <strong>⚠ รหัสงานฝีมือ [{boundJob.code}] {isInactive ? 'ถูกปิดใช้งาน' : `หมดอายุแล้ว (${boundJob.expires_on})`}</strong>
                      {' — '}ระบบอาจคำนวณค่าจ้างผิดพลาด กรุณาแก้ไขในหน้าฐานข้อมูลพนักงานก่อนบันทึก
                    </div>
                  </div>
                )
              })()}

              {calc && (
                <>
                  {/* ── Logic & Calculation Audit Section ── */}
                  <div style={{ marginBottom: 16, border: '1px solid #fed7aa', borderRadius: 8, background: '#fffaf5', overflow: 'hidden' }}>
                    <div
                      onClick={() => setShowDailyBreakdown(prev => !prev)}
                      style={{
                        padding: '12px 16px',
                        background: '#ffedd5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Clock style={{ width: 16, height: 16, color: '#c2410c' }} />
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#9a3412' }}>
                          ตรรกะและที่มาการคำนวณเงินค่าแรง (Calculation Breakdown)
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c2410c', fontWeight: 600 }}>
                        <span>{showDailyBreakdown ? 'ซ่อนรายละเอียดกะ' : 'ดูรายละเอียดกะรายวัน'}</span>
                        {showDailyBreakdown ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
                      </div>
                    </div>

                    {/* Summary KPI Cards */}
                    <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, borderBottom: showDailyBreakdown ? '1px solid #fed7aa' : 'none' }}>
                      <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #fed7aa' }}>
                        <div style={{ fontSize: 11, color: '#7c2d12', fontWeight: 600 }}>จำนวนกะทำงาน</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)', marginTop: 2 }}>
                          {calc.totalShiftsCount} <span style={{ fontSize: 11, fontWeight: 500 }}>กะ</span>
                        </div>
                        <div style={{ fontSize: 10, color: '#9a3412', marginTop: 1 }}>
                          {calc.workDaysCount} วัน (ปกติ {calc.normalShiftsCount} / นักขัตฤกษ์ {calc.holidayShiftsCount})
                        </div>
                      </div>

                      <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #fed7aa' }}>
                        <div style={{ fontSize: 11, color: '#7c2d12', fontWeight: 600 }}>ค่าแรงกะปกติ</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)', marginTop: 2 }}>
                          ฿{monoNum(calc.baseShiftWage)}
                        </div>
                        <div style={{ fontSize: 10, color: '#9a3412', marginTop: 1 }}>
                          ช่างทั่วไป {calc.normalTierCount} / ช่างฝีมือ {calc.skilledTierCount}
                        </div>
                      </div>

                      {calc.amountHolidayOt > 0 && (
                        <div style={{ background: '#fffbeb', padding: '8px 12px', borderRadius: 6, border: '1px solid #fde68a' }}>
                          <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>OT นักขัตฤกษ์ (2x)</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#b45309', marginTop: 2 }}>
                            +฿{monoNum(calc.amountHolidayOt)}
                          </div>
                          <div style={{ fontSize: 10, color: '#92400e', marginTop: 1 }}>
                            {calc.holidayShiftsCount} กะ ({calc.holidayDaysCount} วัน)
                          </div>
                        </div>
                      )}

                      <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #fed7aa' }}>
                        <div style={{ fontSize: 11, color: '#7c2d12', fontWeight: 600 }}>ค่า OT รวม</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#c2410c', marginTop: 2 }}>
                          +฿{monoNum(calc.totalOtPay)}
                        </div>
                        <div style={{ fontSize: 10, color: '#9a3412', marginTop: 1 }}>
                          {calc.amountHolidayOt > 0 ? `รวมนักขัตฤกษ์ 2x + OT ล่วงเวลา` : (calc.isClerk ? 'เสมียน 2 เท่า' : `OT 1.5x รวม ${calc.totalOtHours} ชม.`)}
                        </div>
                      </div>

                      <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #fed7aa' }}>
                        <div style={{ fontSize: 11, color: '#7c2d12', fontWeight: 600 }}>เบิกล่วงหน้า/หักพิเศษ</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-crimson)', marginTop: 2 }}>
                          –฿{monoNum(calc.deductAdvance)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--vk-crimson)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {empAdvances.length === 0 ? '0 รายการ' : (
                            <span>
                              {advRegularTotal > 0 && `เบิก ฿${monoNum(advRegularTotal)}`}
                              {advScanTotal > 0 && `${advRegularTotal > 0 ? ' • ' : ''}สแกน ฿${monoNum(advScanTotal)}`}
                              {advDiscTotal > 0 && `${(advRegularTotal > 0 || advScanTotal > 0) ? ' • ' : ''}ลงโทษ ฿${monoNum(advDiscTotal)}`}
                              {advSafetyFineTotal > 0 && `${(advRegularTotal > 0 || advScanTotal > 0 || advDiscTotal > 0) ? ' • ' : ''}ปรับ จป. ฿${monoNum(advSafetyFineTotal)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Daily Shift Log Table */}
                    {showDailyBreakdown && (
                      <div style={{ padding: '12px 16px', maxHeight: 260, overflowY: 'auto' }}>
                        {calc.dailyAudit.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '20px', color: '#9a3412', fontSize: 12 }}>
                            ยังไม่มีรายการกะในงวดนี้
                          </div>
                        ) : (
                          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #fed7aa', textAlign: 'left', color: '#7c2d12' }}>
                                <th style={{ padding: '4px 6px' }}>วันที่</th>
                                <th style={{ padding: '4px 6px' }}>กะ</th>
                                <th style={{ padding: '4px 6px' }}>รหัสงาน</th>
                                <th style={{ padding: '4px 6px' }}>ประเภท</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right' }}>ชม. จริง</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right' }}>ค่าแรงกะ</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right' }}>OT</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right' }}>เงิน OT</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right' }}>รวมวันนั้น</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calc.dailyAudit.map(day => (
                                day.shifts.map((s, idx) => (
                                  <tr key={`${day.date}-${s.shiftIndex}`} style={{ borderBottom: '1px dashed #fde68a', background: s.isHoliday ? 'rgba(254, 243, 199, 0.4)' : idx % 2 === 0 ? 'transparent' : 'rgba(254, 243, 199, 0.15)' }}>
                                    <td style={{ padding: '4px 6px', fontFamily: 'var(--vk-mono)' }}>
                                      {idx === 0 ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                          <span>{day.date}</span>
                                          {day.isHoliday && (
                                            <span style={{ fontSize: 9, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>
                                              นักขัตฤกษ์
                                            </span>
                                          )}
                                        </div>
                                      ) : ''}
                                    </td>
                                    <td style={{ padding: '4px 6px', fontWeight: 600 }}>
                                      {s.shiftName}
                                    </td>
                                    <td style={{ padding: '4px 6px', fontFamily: 'var(--vk-mono)' }}>
                                      {s.jobCode}
                                    </td>
                                    <td style={{ padding: '4px 6px' }}>
                                      {s.isHoliday ? (
                                        <span style={{ color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                          นักขัตฤกษ์ (×2)
                                        </span>
                                      ) : s.isHalf ? (
                                        <span style={{ color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                          ครึ่งกะ
                                        </span>
                                      ) : s.tier === 'skilled' ? (
                                        <span style={{ color: '#0369a1', background: '#e0f2fe', padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                          ช่างฝีมือ
                                        </span>
                                      ) : (
                                        <span style={{ color: 'var(--vk-ink-3)', fontSize: 10 }}>ปกติ</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                                      {s.hours} ชม.
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)' }}>
                                      {s.isHoliday ? (
                                        <div>
                                          <span style={{ fontWeight: 700, color: '#b45309' }}>฿{monoNum(s.totalShiftWage)}</span>
                                          <div style={{ fontSize: 9, color: '#92400e' }}>(฿{monoNum(s.wage)} × 2)</div>
                                        </div>
                                      ) : (
                                        `฿${monoNum(s.wage)}`
                                      )}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: s.otHours > 0 ? '#c2410c' : 'var(--vk-ink-3)' }}>
                                      {s.otHours > 0 ? `${s.otHours} ชม.` : '-'}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', color: s.otPay > 0 ? '#c2410c' : 'var(--vk-ink-3)' }}>
                                      {s.otPay > 0 ? `+฿${monoNum(s.otPay)}` : '-'}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, color: 'var(--vk-ink)' }}>
                                      ฿{monoNum(s.totalShiftWage + s.otPay)}
                                    </td>
                                  </tr>
                                ))
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Income & Deduct Column (Diamond Style) ── */}
                  <div className="vk-income-grid" style={{ border: '1px solid var(--vk-rule)', marginBottom: 0, width: '100%' }}>
                    {/* Income Column */}
                    <div className="vk-income-col" style={{ padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div className="vk-eyebrow" style={{ color: 'var(--vk-jade)', marginBottom: 14 }}>INCOME · รายได้</div>

                      {/* Calculated rows */}
                      {[
                        {
                          label: 'ค่าจ้างปกติ (กะแรก)',
                          sub: `ยอดค่าแรงกะแรกของแต่ละวัน (นำไปคิด ปกส ${(Number(currentPeriod?.social_security_rate ?? 0.05) * 100).toFixed(2).replace(/\.00$/, '')}%)`,
                          detail: `${calc.workDaysCount} วันทำงาน (ฐาน ปกส)`,
                          value: calc.effectiveNormal,
                          isOverridden: overrideNormal !== null,
                        },
                        ...(calc.baseShiftWage > 0 || overrideShift !== null ? [{
                          label: 'ค่ากะ (กะที่ 2 ควบกะ)',
                          sub: `ยอดกะสองที่ทำควบในวันเดียวกัน (ไม่นำไปคิด ปกส)`,
                          detail: `ทำงานควบ ${calc.totalShiftsCount - calc.workDaysCount} กะ`,
                          value: calc.effectiveShift,
                          isOverridden: overrideShift !== null,
                        }] : []),
                        ...(calc.amountHolidayOt > 0 ? [{
                          label: 'OT วันหยุดนักขัตฤกษ์ (×2)',
                          sub: `${calc.holidayShiftsCount} กะ (${calc.holidayDaysCount} วันหยุดนักขัตฤกษ์)`,
                          detail: `จ่าย 2 เท่าของค่าแรงทุกกะที่ทำงานในวันหยุดนักขัตฤกษ์`,
                          value: calc.amountHolidayOt,
                          isOverridden: false,
                        }] : []),
                        {
                          label: calc.isClerk ? 'OT เสมียนเต็มกะ (×2 เท่า)' : 'OT ล่วงเวลา (1.5 เท่าต่อ ชม. ปัดเศษขึ้น)',
                          sub: calc.isClerk ? 'ทำเต็มกะ 8 ชม.' : `${calc.totalOtHours} ชั่วโมง`,
                          detail: calc.isClerk
                            ? 'จ่าย 2 เท่าของค่าแรงกะ'
                            : `(ค่าแรงกะ ÷ 8) × 1.5 × ชม. (ปัดเศษขึ้นเป็นจำนวนเต็มบาท)`,
                          value: calc.regularOtPay,
                          isOverridden: false,
                        },
                      ].map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                            {r.sub && <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 1, wordBreak: 'break-word', whiteSpace: 'normal' }}>{r.sub}</div>}
                            {r.detail && <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-persimmon)', marginTop: 1, wordBreak: 'break-word', whiteSpace: 'normal' }}>{r.detail}</div>}
                          </div>
                          <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: r.isOverridden ? 'var(--vk-marigold)' : 'var(--vk-ink)', fontWeight: 700, flexShrink: 0 }}>
                            {monoNum(r.value)}
                          </div>
                        </div>
                      ))}

                      {/* Overrides Input */}
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(0,0,0,0.03)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>แก้ไขค่าจ้างปกติกะแรก (Override):</span>
                          <input
                            type="number"
                            value={overrideNormal !== null ? overrideNormal : ''}
                            onChange={e => setOverrideNormal(e.target.value === '' ? null : Number(e.target.value))}
                            placeholder={`อัตโนมัติ (${calc.baseNormalWage})`}
                            style={{ width: 110, fontSize: 11, fontFamily: 'var(--vk-mono)', textAlign: 'right', border: '1px solid var(--vk-rule-soft)', padding: '2px 6px', background: '#fff' }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>แก้ไขค่ากะ 2 (Override):</span>
                          <input
                            type="number"
                            value={overrideShift !== null ? overrideShift : ''}
                            onChange={e => setOverrideShift(e.target.value === '' ? null : Number(e.target.value))}
                            placeholder={`อัตโนมัติ (${calc.baseShiftWage})`}
                            style={{ width: 110, fontSize: 11, fontFamily: 'var(--vk-mono)', textAlign: 'right', border: '1px solid var(--vk-rule-soft)', padding: '2px 6px', background: '#fff' }}
                          />
                        </div>
                      </div>

                      {/* Additional Income Fields */}
                      <div style={{ marginTop: 14, borderTop: '1px solid var(--vk-rule-soft)', paddingTop: 14, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 0 }}>รายการรายได้เพิ่มเติม</div>

                        {/* 1. เบี้ยขยัน (Diligence Allowance) */}
                        <div style={{ padding: '10px 12px', background: 'var(--vk-paper)', borderRadius: 6, border: '1px solid var(--vk-rule-soft)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--vk-ink)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>เบี้ยขยัน (฿)</span>
                                {overrideDiligence !== null && (
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                                    OVERRIDE
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                <span style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: !calc.isEndOfMonth
                                    ? '#f3f4f6'
                                    : (empAttendanceLogs.length > 0 ? '#fee2e2' : '#ecfdf5'),
                                  color: !calc.isEndOfMonth
                                    ? '#7a6f60'
                                    : (empAttendanceLogs.length > 0 ? '#b91c1c' : '#047857')
                                }}>
                                  {!calc.isEndOfMonth
                                    ? 'งวดต้นเดือน (จ่ายงวดสิ้นเดือน)'
                                    : (empAttendanceLogs.length > 0
                                        ? `ไม่ผ่านเกณฑ์ (พบประวัติ ${empAttendanceLogs.length} ครั้ง)`
                                        : 'ดึงจากฐานข้อมูล (300 บ.)')}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {!calc.isEndOfMonth ? (
                                <span style={{
                                  fontFamily: 'var(--vk-mono)',
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: 'var(--vk-ink-3)',
                                  minWidth: 60,
                                  textAlign: 'right',
                                }}>
                                  ฿0.00
                                </span>
                              ) : !editingDiligence ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{
                                    fontFamily: 'var(--vk-mono)',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: overrideDiligence !== null ? 'var(--vk-marigold)' : 'var(--vk-ink)',
                                    minWidth: 60,
                                    textAlign: 'right',
                                  }}>
                                    ฿{monoNum(extraEntries.amount_diligence || 0)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setEditingDiligence(true)}
                                    title="แก้ไขยอดเบี้ยขยัน (Override)"
                                    style={{
                                      background: 'var(--vk-paper)',
                                      border: '1px solid var(--vk-rule)',
                                      borderRadius: 4,
                                      padding: '3px 6px',
                                      cursor: 'pointer',
                                      color: 'var(--vk-ink-2)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      fontSize: 11,
                                    }}
                                  >
                                    <Pencil style={{ width: 12, height: 12, color: 'var(--vk-persimmon)' }} />
                                    <span>แก้ไข</span>
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExtraEntries(prev => ({ ...prev, amount_diligence: 0 }))
                                      setOverrideDiligence(0 !== defaultDiligence ? 0 : null)
                                    }}
                                    style={{
                                      fontSize: 10,
                                      padding: '3px 6px',
                                      borderRadius: 4,
                                      border: '1px solid #fca5a5',
                                      background: '#fef2f2',
                                      color: '#b91c1c',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      whiteSpace: 'nowrap'
                                    }}
                                    title="ปรับยอดเป็น 0 บาท"
                                  >
                                    0 บ.
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExtraEntries(prev => ({ ...prev, amount_diligence: 300 }))
                                      setOverrideDiligence(300 !== defaultDiligence ? 300 : null)
                                    }}
                                    style={{
                                      fontSize: 10,
                                      padding: '3px 6px',
                                      borderRadius: 4,
                                      border: '1px solid #6ee7b7',
                                      background: '#ecfdf5',
                                      color: '#047857',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      whiteSpace: 'nowrap'
                                    }}
                                    title="ปรับยอดเป็น 300 บาท"
                                  >
                                    300 บ.
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    autoFocus
                                    value={extraEntries.amount_diligence || ''}
                                    onChange={e => {
                                      const val = Number(e.target.value) || 0
                                      setExtraEntries(prev => ({ ...prev, amount_diligence: val }))
                                      setOverrideDiligence(val !== defaultDiligence ? val : null)
                                    }}
                                    style={{ width: 75, fontFamily: 'var(--vk-mono)', fontSize: 13, textAlign: 'right', border: '1px solid var(--vk-persimmon)', background: '#fff', padding: '4px 6px', outline: 'none' }}
                                    placeholder="0"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingDiligence(false)
                                      if (extraEntries.amount_diligence === defaultDiligence) {
                                        setOverrideDiligence(null)
                                      } else {
                                        setOverrideDiligence(extraEntries.amount_diligence)
                                      }
                                    }}
                                    title="เสร็จสิ้น"
                                    style={{
                                      background: 'var(--vk-jade)',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 4,
                                      padding: '4px 8px',
                                      cursor: 'pointer',
                                      fontSize: 11,
                                      fontWeight: 600,
                                    }}
                                  >
                                    ตกลง
                                  </button>
                                  {overrideDiligence !== null && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExtraEntries(prev => ({ ...prev, amount_diligence: defaultDiligence }))
                                        setOverrideDiligence(null)
                                        setEditingDiligence(false)
                                      }}
                                      title={`คืนค่าอัตโนมัติตามฐานข้อมูล (฿${defaultDiligence.toLocaleString()})`}
                                      style={{
                                        background: '#fef2f2',
                                        color: 'var(--vk-crimson)',
                                        border: '1px solid #fecaca',
                                        borderRadius: 4,
                                        padding: '4px 6px',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        fontSize: 11,
                                      }}
                                    >
                                      <RotateCcw style={{ width: 11, height: 11 }} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Attendance audit logs */}
                          {calc.isEndOfMonth && (() => {
                            const selectedLogs = attendanceByEmp.get(selectedEmp?.id || '') || []
                            if (selectedLogs.length > 0) {
                              return (
                                <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#9b2c2c', marginTop: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                                    <AlertTriangle style={{ width: 13, height: 13, color: '#e53e3e', flexShrink: 0 }} />
                                    <span>พบประวัติ ขาด/ลา/มาสาย ในเดือนนี้ ({selectedLogs.length} ครั้ง):</span>
                                  </div>
                                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 19 }}>
                                    {selectedLogs.map(log => (
                                      <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600 }}>• {log.work_date}:</span>
                                        <span style={{ fontWeight: 600, color: log.type === 'absent' ? '#c53030' : log.type === 'leave' ? '#dd6b20' : '#4a5568' }}>
                                          {getAttendanceTypeLabel(log.type, log.leave_type)}
                                        </span>
                                        {log.minutes_late ? <span>(สาย {log.minutes_late} นาที)</span> : null}
                                        {log.reason ? <span style={{ color: 'var(--vk-ink-3)' }}>– {log.reason}</span> : null}
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ marginTop: 5, paddingLeft: 19, fontSize: 10, color: 'var(--vk-ink-3)', fontStyle: 'italic' }}>
                                    * ขึ้นอยู่กับดุลยพินิจของแอดมิน (สามารถคลิกปุ่ม "ตัดเป็น 0 บ." หรือกรอกแก้ไขตัวเลขได้ทันที)
                                  </div>
                                </div>
                              )
                            }
                            return (
                              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#166534', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle2 style={{ width: 13, height: 13, color: '#16a34a', flexShrink: 0 }} />
                                <span>ไม่มีประวัติ ขาด/ลา/มาสาย ตลอดทั้งเดือนนี้ (ได้รับเบี้ยขยัน 300 บาท)</span>
                              </div>
                            )
                          })()}
                        </div>

                        {/* 2. หมวดเงินพิเศษ (Category: เงินพิเศษ) */}
                        <div style={{ background: '#ffffff', borderRadius: 6, border: '1px solid #fed7aa', padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderBottom: '1px solid #ffedd5', paddingBottom: 6 }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#9a3412', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span>หมวดเงินพิเศษ</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--vk-ink-3)' }}>
                                รวมรายการ: ค่าตำแหน่ง, ค่า จป., เงินพิเศษอื่นๆ
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontSize: 10, color: '#9a3412', fontWeight: 600, marginRight: 4 }}>รวม:</span>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: '#c2410c' }}>
                                ฿{monoNum((extraEntries.amount_position || 0) + (extraEntries.amount_safety || 0) + (extraEntries.amount_other_special || 0))}
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* Sub-category 1: ค่าตำแหน่ง */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 6, borderLeft: '2px solid #3b82f6', flexWrap: 'wrap' }}>
                              <div>
                                <div style={{ fontSize: 12, color: 'var(--vk-ink)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span>• ค่าตำแหน่ง (฿)</span>
                                  {overridePosition !== null && (
                                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                                      OVERRIDE
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: selectedEmp?.has_position_allowance ? '#eff6ff' : '#f3f4f6', color: selectedEmp?.has_position_allowance ? '#1d4ed8' : '#7a6f60' }}>
                                    {selectedEmp?.has_position_allowance
                                      ? (calc.isEndOfMonth ? 'ดึงจากฐานข้อมูล (1,000 บ.)' : 'จ่ายงวดสิ้นเดือน')
                                      : 'ไม่มีสิทธิ์ค่าตำแหน่ง'}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {!calc.isEndOfMonth ? (
                                  <span style={{
                                    fontFamily: 'var(--vk-mono)',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: 'var(--vk-ink-3)',
                                    minWidth: 60,
                                    textAlign: 'right',
                                  }}>
                                    ฿0.00
                                  </span>
                                ) : !editingPosition ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                      fontFamily: 'var(--vk-mono)',
                                      fontSize: 13,
                                      fontWeight: 700,
                                      color: overridePosition !== null ? 'var(--vk-marigold)' : 'var(--vk-ink)',
                                      minWidth: 60,
                                      textAlign: 'right',
                                    }}>
                                      ฿{monoNum(extraEntries.amount_position || 0)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setEditingPosition(true)}
                                      title="แก้ไขยอดค่าตำแหน่ง (Override)"
                                      style={{
                                        background: 'var(--vk-paper)',
                                        border: '1px solid var(--vk-rule)',
                                        borderRadius: 4,
                                        padding: '3px 6px',
                                        cursor: 'pointer',
                                        color: 'var(--vk-ink-2)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: 11,
                                      }}
                                    >
                                      <Pencil style={{ width: 12, height: 12, color: 'var(--vk-persimmon)' }} />
                                      <span>แก้ไข</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input
                                      type="number"
                                      min="0"
                                      autoFocus
                                      value={extraEntries.amount_position || ''}
                                      onChange={e => {
                                        const val = Number(e.target.value) || 0
                                        setExtraEntries(prev => ({ ...prev, amount_position: val }))
                                        setOverridePosition(val !== defaultPosition ? val : null)
                                      }}
                                      style={{ width: 85, fontFamily: 'var(--vk-mono)', fontSize: 13, textAlign: 'right', border: '1px solid var(--vk-persimmon)', background: '#fff', padding: '4px 6px', outline: 'none' }}
                                      placeholder="0"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingPosition(false)
                                        if (extraEntries.amount_position === defaultPosition) {
                                          setOverridePosition(null)
                                        } else {
                                          setOverridePosition(extraEntries.amount_position)
                                        }
                                      }}
                                      title="เสร็จสิ้น"
                                      style={{
                                        background: 'var(--vk-jade)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        fontWeight: 600,
                                      }}
                                    >
                                      ตกลง
                                    </button>
                                    {overridePosition !== null && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExtraEntries(prev => ({ ...prev, amount_position: defaultPosition }))
                                          setOverridePosition(null)
                                          setEditingPosition(false)
                                        }}
                                        title={`คืนค่าอัตโนมัติตามฐานข้อมูล (฿${defaultPosition.toLocaleString()})`}
                                        style={{
                                          background: '#fef2f2',
                                          color: 'var(--vk-crimson)',
                                          border: '1px solid #fecaca',
                                          borderRadius: 4,
                                          padding: '4px 6px',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          fontSize: 11,
                                        }}
                                      >
                                        <RotateCcw style={{ width: 11, height: 11 }} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Sub-category 2: ค่า จป. */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 6, borderLeft: '2px solid #10b981', flexWrap: 'wrap' }}>
                              <div>
                                <div style={{ fontSize: 12, color: 'var(--vk-ink)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span>• ค่า จป. (฿)</span>
                                  {overrideSafety !== null && (
                                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                                      OVERRIDE
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: selectedEmp?.is_safety_officer ? '#ecfdf5' : '#f3f4f6', color: selectedEmp?.is_safety_officer ? '#047857' : '#7a6f60' }}>
                                    {selectedEmp?.is_safety_officer
                                      ? (calc.isEndOfMonth ? 'ดึงจากฐานข้อมูล (500 บ.)' : 'จ่ายงวดสิ้นเดือน')
                                      : 'ไม่มีสิทธิ์ค่า จป.'}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {!calc.isEndOfMonth ? (
                                  <span style={{
                                    fontFamily: 'var(--vk-mono)',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: 'var(--vk-ink-3)',
                                    minWidth: 60,
                                    textAlign: 'right',
                                  }}>
                                    ฿0.00
                                  </span>
                                ) : !editingSafety ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                      fontFamily: 'var(--vk-mono)',
                                      fontSize: 13,
                                      fontWeight: 700,
                                      color: overrideSafety !== null ? 'var(--vk-marigold)' : 'var(--vk-ink)',
                                      minWidth: 60,
                                      textAlign: 'right',
                                    }}>
                                      ฿{monoNum(extraEntries.amount_safety || 0)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSafety(true)}
                                      title="แก้ไขยอดค่า จป. (Override)"
                                      style={{
                                        background: 'var(--vk-paper)',
                                        border: '1px solid var(--vk-rule)',
                                        borderRadius: 4,
                                        padding: '3px 6px',
                                        cursor: 'pointer',
                                        color: 'var(--vk-ink-2)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: 11,
                                      }}
                                    >
                                      <Pencil style={{ width: 12, height: 12, color: 'var(--vk-persimmon)' }} />
                                      <span>แก้ไข</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input
                                      type="number"
                                      min="0"
                                      autoFocus
                                      value={extraEntries.amount_safety || ''}
                                      onChange={e => {
                                        const val = Number(e.target.value) || 0
                                        setExtraEntries(prev => ({ ...prev, amount_safety: val }))
                                        setOverrideSafety(val !== defaultSafety ? val : null)
                                      }}
                                      style={{ width: 85, fontFamily: 'var(--vk-mono)', fontSize: 13, textAlign: 'right', border: '1px solid var(--vk-persimmon)', background: '#fff', padding: '4px 6px', outline: 'none' }}
                                      placeholder="0"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSafety(false)
                                        if (extraEntries.amount_safety === defaultSafety) {
                                          setOverrideSafety(null)
                                        } else {
                                          setOverrideSafety(extraEntries.amount_safety)
                                        }
                                      }}
                                      title="เสร็จสิ้น"
                                      style={{
                                        background: 'var(--vk-jade)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        fontWeight: 600,
                                      }}
                                    >
                                      ตกลง
                                    </button>
                                    {overrideSafety !== null && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExtraEntries(prev => ({ ...prev, amount_safety: defaultSafety }))
                                          setOverrideSafety(null)
                                          setEditingSafety(false)
                                        }}
                                        title={`คืนค่าอัตโนมัติตามฐานข้อมูล (฿${defaultSafety.toLocaleString()})`}
                                        style={{
                                          background: '#fef2f2',
                                          color: 'var(--vk-crimson)',
                                          border: '1px solid #fecaca',
                                          borderRadius: 4,
                                          padding: '4px 6px',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          fontSize: 11,
                                        }}
                                      >
                                        <RotateCcw style={{ width: 11, height: 11 }} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Sub-category 3: เงินพิเศษอื่นๆ */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 6, borderLeft: '2px solid #f59e0b' }}>
                              <div>
                                <div style={{ fontSize: 12, color: 'var(--vk-ink)', fontWeight: 600 }}>• เงินพิเศษอื่นๆ (฿)</div>
                                <span style={{ fontSize: 9, color: 'var(--vk-ink-3)' }}>ระบุเพิ่มเติมได้</span>
                              </div>
                              <input
                                type="number"
                                min="0"
                                value={extraEntries.amount_other_special || ''}
                                onChange={e => setExtraEntries(prev => ({ ...prev, amount_other_special: Number(e.target.value) || 0 }))}
                                style={{ width: 90, fontFamily: 'var(--vk-mono)', fontSize: 13, textAlign: 'right', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', padding: '4px 8px' }}
                                placeholder="0"
                              />
                            </div>

                            {/* Special Note */}
                            <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px dashed #fed7aa' }}>
                              <input
                                type="text"
                                value={specialNote}
                                onChange={e => setSpecialNote(e.target.value)}
                                placeholder="หมายเหตุเงินพิเศษ (เช่น ระบุรายละเอียดรางวัล หรือค่าตอบแทนพิเศษ)..."
                                style={{ width: '100%', fontSize: 11, padding: '4px 8px', border: '1px solid var(--vk-rule-soft)', background: '#ffffff', borderRadius: 4 }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', marginTop: 'auto', borderTop: '2px solid var(--vk-rule)' }}>
                        <div className="vk-eyebrow">รวมรายได้</div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 16, color: 'var(--vk-jade)' }}>
                          + {monoNum(calc.totalIncome)}
                        </div>
                      </div>
                    </div>

                    {/* Deduct Column */}
                    <div className="vk-deduct-col" style={{ padding: '20px 24px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column' }}>
                      <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 14 }}>DEDUCT · รายการหัก</div>

                      {[
                        {
                          label: selectedEmp?.exempt_social_security
                            ? 'ประกันสังคม (ยกเว้น)'
                            : calc.socialSecurityRate > 0
                            ? `ประกันสังคม ${(calc.socialSecurityRate * 100).toFixed(2).replace(/\.00$/, '')}%`
                            : 'ประกันสังคม (ยังไม่มีเลข ปกส)',
                          sub: calc.socialSecurityRate > 0
                            ? `คำนวณ ${(calc.socialSecurityRate * 100).toFixed(2).replace(/\.00$/, '')}% จากค่าจ้างปกติกะแรก ฿${monoNum(calc.effectiveNormal)} (ไม่คิดจากค่ากะ)`
                            : selectedEmp?.nationality !== 'ไทย'
                            ? 'รอ Admin กรอกเลข ปกส และยืนยันข้อมูลสมบูรณ์'
                            : 'ได้รับการยกเว้นตามเงื่อนไขพิเศษ',
                          value: calc.deductSocialSecurity,
                          showAlways: true,
                        },
                        {
                          label: 'เบิกล่วงหน้า',
                          sub: advRegular.length > 0 ? `${advRegular.length} รายการเบิกเงินล่วงหน้า` : null,
                          value: advRegularTotal,
                          showAlways: true,
                        },
                        {
                          label: 'หักสแกนหน้าไม่ผ่าน',
                          sub: advScan.length > 0 ? `${advScan.length} รายการสแกนหน้าไม่สำเร็จ` : null,
                          value: advScanTotal,
                          showAlways: false,
                        },
                        {
                          label: 'หักลงโทษขาดงานไม่มีคนแทน',
                          sub: advDisc.length > 0 ? `${advDisc.length} รายการลงโทษขาดงาน (2 เท่า)` : null,
                          value: advDiscTotal,
                          showAlways: false,
                        },
                        ...(advSafetyFine.length > 0 ? advSafetyFine.map((adv) => {
                          const infoMatch = (adv.note || '').match(/หักค่าปรับผิดระเบียบ\s*(\([^\)]+\))/)
                          let infoStr = infoMatch ? infoMatch[1] : ''
                          if (infoStr && /วันที่\s*\d{4}[-\/]/.test(infoStr)) {
                            infoStr = infoStr.replace(/วันที่\s*([\d\/\-]+)/, (_, d) => `วันที่ ${formatThaiDateDDMMYYYY(d)}`)
                          }
                          const label = infoStr
                            ? `หักค่าปรับผิดระเบียบ\n${infoStr}`
                            : ((adv.note || '').match(/(หักค่าปรับผิดระเบียบ\s*\([^\)]+\))/)?.[1] || 'หักค่าปรับผิดระเบียบ')
                          const reasonMatch = (adv.note || '').match(/สาเหตุ:\s*([^\|]+)/)
                          const sub = reasonMatch ? `สาเหตุ: ${reasonMatch[1].trim()} (ยอดหักงวดละ ฿${monoNum(Number(adv.amount))})` : `ยอดหัก ฿${monoNum(Number(adv.amount))}`
                          return {
                            label,
                            sub,
                            value: Number(adv.amount),
                            showAlways: false,
                          }
                        }) : []),
                        {
                          label: 'หักอุปกรณ์ความปลอดภัย',
                          sub: null,
                          value: extraEntries.deduct_safety_equipment,
                          showAlways: false,
                        },
                        {
                          label: 'หักเครื่องแบบพนักงาน',
                          sub: null,
                          value: extraEntries.deduct_uniform,
                          showAlways: false,
                        },
                      ].filter(r => r.value !== 0 || r.showAlways).map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'pre-line' }}>{r.label}</div>
                            {r.sub && <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 1, wordBreak: 'break-word', whiteSpace: 'normal' }}>{r.sub}</div>}
                          </div>
                          <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-crimson)', fontWeight: 700, flexShrink: 0 }}>
                            {monoNum(r.value)}
                          </div>
                        </div>
                      ))}

                      {/* Advance Breakdown Sub-items: Separated into 3 clear cards with multiline notes */}
                      {advRegular.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(162, 35, 27, 0.04)', borderRadius: 6, marginTop: 8, border: '1px dashed rgba(162, 35, 27, 0.25)' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vk-crimson)', marginBottom: 6 }}>
                            รายละเอียดเบิกล่วงหน้า ({advRegular.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advRegular.map((adv, idx) => (
                              <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #fee2e2' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--vk-crimson)' }}>
                                    รายการที่ {idx + 1}
                                  </span>
                                  <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: 'var(--vk-crimson)' }}>
                                    –฿{monoNum(Number(adv.amount))}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                  {adv.note || 'เบิกเงินสดทั่วไป'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {advScan.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(234, 88, 12, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #fed7aa' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>
                            รายละเอียดหักสแกนหน้าไม่ผ่าน ({advScan.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advScan.map((adv, idx) => {
                              const cleanNote = (adv.note || '').replace(/\[สแกนหน้าไม่สำเร็จ\]/g, '').trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #ffedd5' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c2410c' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: '#ea580c' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#ea580c', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'สแกนหน้าไม่สำเร็จ'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {advDisc.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(153, 27, 27, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #fca5a5' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>
                            รายละเอียดหักลงโทษขาดงานไม่มีคนแทน ({advDisc.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advDisc.map((adv, idx) => {
                              const cleanNote = (adv.note || '')
                                .replace(/\[ลงโทษ\s*(ขาดงานไม่มีคนแทน|ขาด\/ลา\/มาสาย|ขาดงาน)\]/g, '')
                                .replace(/วันที่:\s*([\d\/\-]+)/, (_, d) => `วันที่: ${formatThaiDateDDMMYYYY(d)}`)
                                .trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #fee2e2' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: 'var(--vk-crimson)' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#991b1b', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'หักลงโทษ 2 เท่า'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {advSafetyFine.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(124, 58, 237, 0.05)', borderRadius: 6, marginTop: 8, border: '1px dashed #c4b5fd' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 6 }}>
                            รายละเอียดหักค่าปรับผิดระเบียบวินัย จป. ({advSafetyFine.length} รายการ):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advSafetyFine.map((adv, idx) => {
                              const cleanNote = (adv.note || '').replace(/\[หักค่าปรับ จป\.\]/g, '').trim()
                              const parts = cleanNote.split('|').map(p => p.trim()).filter(Boolean)
                              return (
                                <div key={idx} style={{ padding: '7px 10px', background: '#ffffff', borderRadius: 4, border: '1px solid #ede9fe' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9' }}>
                                      รายการที่ {idx + 1}
                                    </span>
                                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 12, color: '#7c3aed' }}>
                                      –฿{monoNum(Number(adv.amount))}
                                    </span>
                                  </div>
                                  {parts.length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45 }}>
                                      {parts.map((p, pIdx) => (
                                        <div key={pIdx} style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                          <span style={{ color: '#7c3aed', flexShrink: 0 }}>•</span>
                                          <span style={{ flex: 1 }}>{p}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                      {cleanNote || 'หักค่าปรับผิดระเบียบวินัย จป.'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Deduct input fields */}
                      <div style={{ marginTop: 14, borderTop: '1px solid var(--vk-rule-soft)', paddingTop: 14, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="vk-eyebrow" style={{ marginBottom: 2 }}>รายการหักเพิ่มเติม</div>
                        <DeductionProductPicker
                          key={`${selectedEmpId}:${currentPeriod?.id}`}
                          onAdd={(field, amount) => setExtraEntries(prev => ({ ...prev, [field]: Math.max(0, prev[field] + amount) }))}
                        />

                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0', marginTop: 'auto', borderTop: '2px solid var(--vk-rule)' }}>
                        <div className="vk-eyebrow">รวมรายการหัก</div>
                        <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 16, color: 'var(--vk-crimson)' }}>
                          – {monoNum(calc.totalDeductions)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Net pay hero */}
                  <div style={{ borderTop: '2px solid var(--vk-ink)', borderBottom: '2px solid var(--vk-rule)', padding: '16px 20px', background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div className="vk-eyebrow">NET PAY · เงินได้สุทธิ</div>
                      <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 3 }}>
                        {calc.workDaysCount} วันทำงาน ({calc.totalShiftsCount} กะ)
                      </div>
                    </div>
                    <div className="vk-netpay-num" style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--vk-ink)' }}>
                      {Math.floor(calc.netPay).toLocaleString()}
                      <span style={{ fontWeight: 500, fontSize: 16, color: 'var(--vk-ink-3)' }}>
                        .{(calc.netPay % 1).toFixed(2).slice(2)}
                      </span>
                      <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, color: 'var(--vk-ink-3)', marginLeft: 6 }}>บาท</span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
