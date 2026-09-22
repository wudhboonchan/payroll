import { supabase } from './supabase'
import { calculateTpiPayroll, type TpiShiftRow } from '../features/tpi/payrollCalc'
import { calculatePayroll } from './payrollCalc'

export interface PeriodApprovalStatus {
  canApprove: boolean
  totalActiveEmployees: number
  workersWithShiftsCount: number
  savedCount: number
  outdatedCount: number
  unsavedCount: number
  outdatedEmployees: { id: string; employee_code: string; name: string }[]
  unsavedEmployees: { id: string; employee_code: string; name: string }[]
  errorMessage?: string
}

function isWeekendDate(s: string) {
  const d = new Date(s)
  return d.getDay() === 0 || d.getDay() === 6
}

function getPeriodDays(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
}

export async function checkPeriodApprovalStatus(
  factoryId: string,
  period: { id: string; period_start: string; period_end: string; social_security_rate?: number },
  isTpi: boolean
): Promise<PeriodApprovalStatus> {
  const eps = 0.5

  // 1. Fetch active employees
  const { data: employees = [], error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, last_name, position, wage_type, rate_per_12h, exempt_social_security, nationality, national_id, social_security_number, data_complete, is_safety_officer, has_position_allowance')
    .eq('factory_id', factoryId)
    .eq('status', 'active')
  if (empErr) throw empErr

  // 2. Fetch advances for this period
  const { data: advances = [], error: advErr } = await supabase
    .from('advance_payments')
    .select('id, employee_id, amount, note, created_at')
    .eq('period_id', period.id)
  if (advErr) throw advErr

  // 3. Fetch payroll entries for this period
  const { data: allEntries = [], error: entryErr } = await supabase
    .from('payroll_entries')
    .select('employee_id, amount_normal, override_normal, amount_shift, override_shift, amount_ot, override_ot, amount_wood_excess, amount_film, amount_special, override_special, amount_diligence, amount_position, deduct_social_security, deduct_advance, deduct_safety_equipment, deduct_uniform, special_note')
    .eq('period_id', period.id)
    .limit(10000)
  if (entryErr) throw entryErr

  const entryMap = new Map<string, any>()
  for (const e of allEntries) {
    entryMap.set(e.employee_id, e)
  }

  const outdatedEmployees: { id: string; employee_code: string; name: string }[] = []
  const unsavedEmployees: { id: string; employee_code: string; name: string }[] = []
  let savedCount = 0
  let workersWithShiftsCount = 0

  if (isTpi) {
    // Fetch all TPI shift entries with pagination
    let allShifts: TpiShiftRow[] = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('tpi_shift_entries' as any)
        .select('id, work_date, employee_id, shift_index, job_id, job_code_snapshot, rate_tier, rate_snapshot, is_half_shift, actual_hours, ot_hours, ot_pay, is_holiday_ot')
        .eq('factory_id', factoryId)
        .gte('work_date', period.period_start)
        .lte('work_date', period.period_end)
        .range(from, from + PAGE - 1)
      if (error || !data) break
      allShifts = allShifts.concat(data as any)
      if (data.length < PAGE) break
      from += PAGE
    }

    // Query tpi_shift_days for holidays
    const { data: shiftDays = [] } = await supabase
      .from('tpi_shift_days')
      .select('work_date, is_holiday')
      .eq('factory_id', factoryId)
      .gte('work_date', period.period_start)
      .lte('work_date', period.period_end)

    const holidayDates = new Set<string>()
    ;(shiftDays || []).forEach((d: any) => {
      if (d.is_holiday) holidayDates.add(d.work_date)
    })
    allShifts.forEach(s => {
      if (s.is_holiday_ot) holidayDates.add(s.work_date)
    })

    if (holidayDates.size > 0) {
      allShifts = allShifts.map(s => holidayDates.has(s.work_date) ? { ...s, is_holiday_ot: true } : s)
    }

    // Group shifts by employee
    const empShiftMap = new Map<string, TpiShiftRow[]>()
    for (const s of allShifts) {
      if (!empShiftMap.has(s.employee_id)) {
        empShiftMap.set(s.employee_id, [])
      }
      empShiftMap.get(s.employee_id)!.push(s)
    }

    // Group advances by employee
    const empAdvMap = new Map<string, any[]>()
    for (const a of advances) {
      if (!empAdvMap.has(a.employee_id)) {
        empAdvMap.set(a.employee_id, [])
      }
      empAdvMap.get(a.employee_id)!.push(a)
    }

    for (const emp of employees) {
      const shifts = empShiftMap.get(emp.id) || []
      const hasShifts = shifts.length > 0
      if (!hasShifts) continue

      workersWithShiftsCount++
      const empName = `${emp.first_name} ${emp.last_name}`.trim()
      const entry = entryMap.get(emp.id)

      if (!entry) {
        unsavedEmployees.push({ id: emp.id, employee_code: emp.employee_code, name: empName })
        continue
      }

      // Check outdated
      const empAdvances = empAdvMap.get(emp.id) || []
      const result = calculateTpiPayroll({
        employee: emp,
        shifts,
        advances: empAdvances,
        period: {
          id: period.id,
          period_start: period.period_start,
          period_end: period.period_end,
          social_security_rate: period.social_security_rate,
        },
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
        outdatedEmployees.push({ id: emp.id, employee_code: emp.employee_code, name: empName })
      } else {
        savedCount++
      }
    }

    // Also check any orphan entries in payroll_entries for employees without active shifts
    for (const entry of allEntries) {
      if (!empShiftMap.has(entry.employee_id) || empShiftMap.get(entry.employee_id)!.length === 0) {
        const emp = employees.find(e => e.id === entry.employee_id)
        if (emp && !outdatedEmployees.some(o => o.id === emp.id)) {
          // If they have an entry but 0 shifts, and entry has positive normal/shift, it's outdated
          if (Number(entry.amount_normal || 0) > 0 || Number(entry.amount_shift || 0) > 0) {
            outdatedEmployees.push({ id: emp.id, employee_code: emp.employee_code, name: `${emp.first_name} ${emp.last_name}`.trim() })
          }
        }
      }
    }
  } else {
    // DRT factory
    let allShifts: any[] = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('employee_id, shift_type, is_holiday_ot, is_holiday_ot_exempt, is_half_shift, wood_excess, film_amount, ot_hours, actual_hours, work_date, is_cross_position, cross_position_title, cross_position_extra_pay')
        .eq('period_id', period.id)
        .range(from, from + PAGE - 1)
      if (error || !data) break
      allShifts = allShifts.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }

    const empShiftMap = new Map<string, any[]>()
    for (const s of allShifts) {
      if (!empShiftMap.has(s.employee_id)) {
        empShiftMap.set(s.employee_id, [])
      }
      empShiftMap.get(s.employee_id)!.push(s)
    }

    const empAdvMap = new Map<string, any[]>()
    for (const a of advances) {
      if (!empAdvMap.has(a.employee_id)) {
        empAdvMap.set(a.employee_id, [])
      }
      empAdvMap.get(a.employee_id)!.push(a)
    }

    for (const emp of employees) {
      const shifts = empShiftMap.get(emp.id) || []
      const hasShifts = shifts.length > 0
      if (!hasShifts) continue

      workersWithShiftsCount++
      const empName = `${emp.first_name} ${emp.last_name}`.trim()
      const entry = entryMap.get(emp.id)

      if (!entry) {
        unsavedEmployees.push({ id: emp.id, employee_code: emp.employee_code, name: empName })
        continue
      }

      const empAdvances = empAdvMap.get(emp.id) || []
      const isEmpClerk = emp.position === 'clerk'
      const empIsThai = !emp.nationality || emp.nationality === 'ไทย'
      const empHasSsNumber = !empIsThai ? !!(emp.national_id?.trim() || emp.social_security_number?.trim()) : true
      const empProfileComplete = !!emp.data_complete
      const empSsEligible = !emp.exempt_social_security && (empIsThai || (empHasSsNumber && empProfileComplete))
      const empSsRate = empSsEligible ? (period.social_security_rate ?? 0.05) : 0
      const normShifts = shifts.filter(s => !s.is_holiday_ot || s.is_holiday_ot_exempt)
      const holShifts = shifts.filter(s => s.is_holiday_ot && !s.is_holiday_ot_exempt)
      const normDays = normShifts.filter(s => !s.is_half_shift && !s.actual_hours).length
      const halfDays = normShifts.filter(s => s.is_half_shift && !s.actual_hours).length
      const partialHrs = normShifts.reduce((s, sh) => s + Number(sh.actual_hours || 0), 0)
      const holFull = holShifts.filter(s => !s.is_half_shift).length
      const holHalf = holShifts.filter(s => s.is_half_shift).length
      const clerkNorm = normShifts.filter(s => !isWeekendDate(s.work_date)).length
      const clerkOt = shifts.filter(s => !isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
      const clerkOt1x = shifts.filter(s => isWeekendDate(s.work_date)).reduce((s, sh) => s + Number(sh.ot_hours || 0), 0)
      const autoW = shifts.reduce((s, sh) => s + Number(sh.wood_excess || 0), 0)
      const autoF = shifts.reduce((s, sh) => s + Number(sh.film_amount || 0), 0)
      const autoSp = shifts.filter(s => s.is_cross_position).reduce((s, sh) => s + Number(sh.cross_position_extra_pay || 0), 0)
      const advTotal = empAdvances.reduce((s, a) => s + Number(a.amount || 0), 0)

      const c = calculatePayroll({
        position: emp.position as 'worker' | 'clerk',
        wage_type: emp.wage_type as 'daily' | 'monthly',
        rate_per_12h: Number(emp.rate_per_12h) || 0,
        normal_days: isEmpClerk ? clerkNorm : normDays,
        period_days: isEmpClerk ? getPeriodDays(period.period_start, period.period_end) : undefined,
        half_shift_days: isEmpClerk ? 0 : halfDays,
        holiday_ot_full_days: holFull,
        holiday_ot_half_days: holHalf,
        partial_hours_total: isEmpClerk ? 0 : partialHrs,
        clerk_ot_hours: clerkOt,
        clerk_ot_1x_hours: clerkOt1x,
        override_normal: entry.override_normal != null ? Number(entry.override_normal) : null,
        override_special: null,
        amount_wood_excess: isEmpClerk ? 0 : autoW,
        amount_film: isEmpClerk ? 0 : autoF,
        amount_special: autoSp,
        amount_diligence: 0,
        amount_position: 0,
        social_security_rate: empSsRate,
        deduct_advance: advTotal,
        deduct_safety_equipment: 0,
        deduct_uniform: 0,
      })

      const checks: [number, number][] = [
        [c.amount_normal, Number(entry.amount_normal)],
        [c.amount_shift, Number(entry.amount_shift)],
        [c.amount_ot + c.amount_ot_1x, Number(entry.amount_ot)],
        [autoW, Number(entry.amount_wood_excess)],
        [autoF, Number(entry.amount_film)],
        [advTotal, Number(entry.deduct_advance)],
        [c.deduct_social_security, Number(entry.deduct_social_security)],
      ]

      const specDiff = Math.min(
        Math.abs((autoSp + Number(entry.override_special || 0)) - Number(entry.amount_special)),
        Math.abs(Number(entry.override_special ?? autoSp) - Number(entry.amount_special))
      )

      if (checks.some(([a, b]) => Math.abs(a - b) > eps) || specDiff > eps) {
        outdatedEmployees.push({ id: emp.id, employee_code: emp.employee_code, name: empName })
      } else {
        savedCount++
      }
    }
  }

  const outdatedCount = outdatedEmployees.length
  const unsavedCount = unsavedEmployees.length
  const canApprove = workersWithShiftsCount > 0 && outdatedCount === 0 && unsavedCount === 0

  let errorMessage: string | undefined
  if (!canApprove) {
    if (workersWithShiftsCount === 0) {
      errorMessage = 'ไม่พบข้อมูลการทำงานของพนักงานในงวดนี้ จึงยังไม่สามารถอนุมัติได้'
    } else {
      const details: string[] = []
      if (outdatedCount > 0) details.push(`มียอดเปลี่ยนแปลง (Outdated) ${outdatedCount} คน`)
      if (unsavedCount > 0) details.push(`ยังไม่ได้บันทึกค่าจ้าง ${unsavedCount} คน`)
      errorMessage = `ไม่สามารถอนุมัติงวดได้: ${details.join(' และ ')} กรุณากลับไปที่หน้าบันทึกค่าแรงเพื่อตรวจสอบและบันทึกให้เป็นสถานะ "บันทึกแล้ว" ครบทุกคนก่อน`
    }
  }

  return {
    canApprove,
    totalActiveEmployees: employees.length,
    workersWithShiftsCount,
    savedCount,
    outdatedCount,
    unsavedCount,
    outdatedEmployees,
    unsavedEmployees,
    errorMessage,
  }
}
