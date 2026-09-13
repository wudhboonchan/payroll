import { SHIFTS } from './model.ts'

export interface TpiShiftRow {
  id: string
  work_date: string
  employee_id: string
  shift_index: number
  job_id: string
  job_code_snapshot: string
  rate_tier: 'normal' | 'skilled'
  rate_snapshot: number
  is_half_shift: boolean
  actual_hours: number
  ot_hours: number
  ot_pay: number
  is_holiday_ot?: boolean
}

export interface TpiPayrollInput {
  employee: {
    id: string
    employee_code: string
    first_name: string
    last_name: string
    position?: string | null
    wage_type?: string | null
    rate_per_12h?: number | null
    nationality?: string | null
    national_id?: string | null
    exempt_social_security?: boolean | null
    is_safety_officer?: boolean | null
    has_position_allowance?: boolean | null
    social_security_number?: string | null
    data_complete?: boolean | null
  }
  shifts: TpiShiftRow[]
  advances: { amount: number; note?: string | null; created_at?: string }[]
  period: {
    id: string
    period_start: string
    period_end: string
    social_security_rate?: number
  }
  overrides?: {
    override_normal?: number | null
    override_shift?: number | null
    override_ot?: number | null
    override_special?: number | null
  }
  extras?: {
    amount_diligence?: number
    amount_position?: number
    amount_special?: number
    special_note?: string
    deduct_safety_equipment?: number
    deduct_uniform?: number
  }
}

export interface DailyShiftAudit {
  date: string
  isHoliday: boolean
  shifts: {
    shiftIndex: number
    shiftName: string
    jobCode: string
    tier: 'normal' | 'skilled'
    isHalf: boolean
    isHoliday: boolean
    hours: number
    wage: number
    isFirstShiftOfDay: boolean
    holidayWageMultiplier: number
    totalShiftWage: number
    otHours: number
    otPay: number
  }[]
  dayTotalWage: number
  dayTotalOt: number
}

export interface TpiPayrollCalculationResult {
  isClerk: boolean

  // Shift counts
  totalShiftsCount: number
  normalShiftsCount: number
  holidayShiftsCount: number
  fullShiftsCount: number
  halfShiftsCount: number
  normalTierCount: number
  skilledTierCount: number
  workDaysCount: number
  holidayDaysCount: number

  // Shift wages: First Shift (Normal) vs Second Shift (Shift Pay)
  baseNormalWage: number
  baseShiftWage: number
  totalBaseShiftWage: number
  overrideNormal: number | null
  effectiveNormal: number
  overrideShift: number | null
  effectiveShift: number

  // Holiday OT (2x rate of all shifts on public holidays)
  amountHolidayOt: number

  // Regular OT details
  totalOtHours: number
  regularOtPay: number
  totalOtPay: number // amountHolidayOt + regularOtPay
  overrideOt: number | null
  effectiveOt: number

  // Additional allowances
  isEndOfMonth: boolean
  amountDiligence: number
  amountPosition: number
  amountSpecial: number
  amountSafetyOfficer: number
  specialNote: string
  totalIncome: number

  // Deductions
  isSsEligible: boolean
  socialSecurityRate: number
  deductSocialSecurity: number
  deductAdvance: number
  deductSafetyEquipment: number
  deductUniform: number
  totalDeductions: number

  // Net Pay
  netPay: number

  // Daily audit list for transparent view
  dailyAudit: DailyShiftAudit[]
}

/**
 * Checks if a period ends at the end of a month (day >= 25)
 * TPI pays Diligence (300 THB), Safety Officer (500 THB), and Position (1,000 THB) only at end of month!
 */
export function isEndOfMonthPeriod(periodEnd: string): boolean {
  if (!periodEnd) return false
  const parts = periodEnd.split('-')
  const day = parts.length === 3 ? parseInt(parts[2], 10) : 0
  return day >= 25
}

/**
 * Calculates TPI payroll for a single employee based on TPI's shift system:
 * 1. Shift Separation:
 *    - First shift of each day: "ค่าจ้างปกติ" (amount_normal) -> ฐานคำนวณ ปกส 5%
 *    - Second shift of each day (ควบกะ): "ค่ากะ" (amount_shift) -> ไม่นำไปคิด ปกส
 * 2. Public Holiday days: paid 2× base wage of every shift worked on that day
 * 3. Regular Overtime: 1.5× hourly for workers, 2× 8h full-shift for clerks
 * 4. Social Security (ปกส 5%):
 *    - Thai employees: 100% deducted unless exempt_social_security is checked
 *    - Foreign employees: deducted ONLY when social_security_number is present AND data_complete is true (and not exempt)
 *    - Base is effectiveNormal (กะแรกเท่านั้น)
 * 5. Allowances (End of month only):
 *    - เบี้ยขยัน: 300 THB/month in end of month period
 *    - ค่า จป. (Safety Officer): 500 THB/month in end of month period if is_safety_officer
 *    - ค่าตำแหน่ง: 1,000 THB/month in end of month period if has_position_allowance
 */
export function calculateTpiPayroll(input: TpiPayrollInput): TpiPayrollCalculationResult {
  const { employee, shifts, advances, period, overrides, extras } = input
  const isClerk = employee.position === 'clerk'

  // Sort shifts chronologically by date and shift_index
  const sortedShifts = [...shifts].sort((a, b) => {
    if (a.work_date !== b.work_date) return a.work_date.localeCompare(b.work_date)
    return a.shift_index - b.shift_index
  })

  // Group shifts by day for the audit log
  const dailyMap = new Map<string, TpiShiftRow[]>()
  for (const s of sortedShifts) {
    const list = dailyMap.get(s.work_date) || []
    list.push(s)
    dailyMap.set(s.work_date, list)
  }

  const dailyAudit: DailyShiftAudit[] = []
  let totalShiftsCount = 0
  let normalShiftsCount = 0
  let holidayShiftsCount = 0
  let fullShiftsCount = 0
  let halfShiftsCount = 0
  let normalTierCount = 0
  let skilledTierCount = 0

  let baseNormalWage = 0 // First shift of each day ("ค่าจ้างปกติ") -> Base for Social Security
  let baseShiftWage = 0  // Second shift of each day ("ค่ากะ") -> Not subject to Social Security
  let totalBaseShiftWage = 0 // Sum of all shift base wages
  let amountHolidayOt = 0
  let totalOtHours = 0
  let regularOtPay = 0
  let holidayDaysCount = 0

  dailyMap.forEach((dayShifts, date) => {
    let dayTotalWage = 0
    let dayTotalOt = 0
    const dayIsHoliday = dayShifts.some(s => !!s.is_holiday_ot)

    if (dayIsHoliday) {
      holidayDaysCount += 1
    }

    // Sort shifts in this day: shift 0 (เช้า) -> shift 1 (บ่าย) -> shift 2 (ดึก)
    const sortedDayShifts = [...dayShifts].sort((a, b) => a.shift_index - b.shift_index)

    const shiftItems = sortedDayShifts.map((s, idx) => {
      const isFirstShiftOfDay = idx === 0
      const isHalf = !!s.is_half_shift
      const isHoliday = !!s.is_holiday_ot
      const baseWage = Number(s.rate_snapshot) || 0
      const otHrs = Number(s.ot_hours) || 0
      const otMoney = Number(s.ot_pay) || 0

      totalShiftsCount += 1
      if (isHalf) halfShiftsCount += 1
      else fullShiftsCount += 1

      if (s.rate_tier === 'skilled') skilledTierCount += 1
      else normalTierCount += 1

      totalOtHours += otHrs
      regularOtPay += otMoney

      // For clerks, Shift 2 with OT is paid 2x entirely as OT, and must NOT be double-counted as shift wage (ค่ากะ)
      const isClerkOtShift = isClerk && !isFirstShiftOfDay && (otMoney > 0 || otHrs > 0)

      let totalShiftWage = baseWage
      if (isHoliday) {
        // Public holiday: Paid 2x base rate of every shift worked on that day
        holidayShiftsCount += 1
        const holidayPay = baseWage * 2
        amountHolidayOt += holidayPay
        totalShiftWage = holidayPay

        // The base 1x rate is accounted into normal vs shift wage
        if (isFirstShiftOfDay) {
          baseNormalWage += baseWage
        } else if (!isClerkOtShift) {
          baseShiftWage += baseWage
        }
      } else {
        normalShiftsCount += 1
        if (isFirstShiftOfDay) {
          baseNormalWage += baseWage
        } else if (!isClerkOtShift) {
          baseShiftWage += baseWage
        }
      }

      if (!isClerkOtShift) {
        totalBaseShiftWage += baseWage
      }
      dayTotalWage += (isClerkOtShift ? 0 : totalShiftWage)
      dayTotalOt += otMoney

      const shiftName = SHIFTS[s.shift_index]?.name || `กะ ${s.shift_index + 1}`

      return {
        shiftIndex: s.shift_index,
        shiftName,
        jobCode: s.job_code_snapshot || '-',
        tier: s.rate_tier,
        isHalf,
        isHoliday,
        hours: Number(s.actual_hours) || (isHalf ? 4 : 8),
        wage: isClerkOtShift ? 0 : baseWage,
        isFirstShiftOfDay,
        holidayWageMultiplier: isHoliday ? 2 : 1,
        totalShiftWage: isClerkOtShift ? 0 : totalShiftWage,
        otHours: otHrs,
        otPay: otMoney,
      }
    })

    dailyAudit.push({
      date,
      isHoliday: dayIsHoliday,
      shifts: shiftItems,
      dayTotalWage,
      dayTotalOt,
    })
  })

  const workDaysCount = dailyMap.size

  // Normal pay & Shift pay with overrides
  const overrideNormal = overrides?.override_normal ?? null
  const effectiveNormal = overrideNormal !== null ? overrideNormal : baseNormalWage

  const overrideShift = overrides?.override_shift ?? null
  const effectiveShift = overrideShift !== null ? overrideShift : baseShiftWage

  // Total OT pay: Holiday OT (2x) + Regular OT
  const totalOtPay = amountHolidayOt + regularOtPay
  const overrideOt = overrides?.override_ot ?? null
  const effectiveOt = overrideOt !== null ? overrideOt : totalOtPay

  // End of Month Checks
  const isEndMonth = isEndOfMonthPeriod(period.period_end)

  // Position allowance: permanently removed per user requirement
  const autoPosition = 0
  const amountPosition = 0

  // Safety Officer allowance (ค่า จป.): 500 THB/month paid only in end-of-month period if employee is is_safety_officer
  const amountSafetyOfficer = isEndMonth && !!employee.is_safety_officer ? 500 : 0

  // Special allowances: includes Safety Officer allowance when applicable
  const extraSpecial = extras?.amount_special !== undefined ? Number(extras.amount_special) : 0
  const amountSpecial = extraSpecial > 0 ? extraSpecial : amountSafetyOfficer

  let specialNote = extras?.special_note || ''
  if (amountSafetyOfficer > 0 && !specialNote.includes('ค่า จป.')) {
    specialNote = specialNote ? `${specialNote}, ค่า จป. 500 บาท` : 'ค่า จป. 500 บาท'
  }

  // Diligence allowance: 300 THB/month paid only in end-of-month period
  const amountDiligence = extras?.amount_diligence !== undefined
    ? Number(extras.amount_diligence)
    : (isEndMonth ? 300 : 0)

  const totalIncome = effectiveNormal + effectiveShift + effectiveOt + amountDiligence + amountPosition + amountSpecial

  // ── Social Security (ปกส 5%) ──
  // Rule 1: Thai employees are deducted by default unless exempt_social_security is explicitly checked
  // Rule 2: Foreign employees are deducted ONLY if they have a social security number (stored in national_id or legacy social_security_number) AND data_complete is true (and not exempt)
  // Rule 3: Calculated strictly on First Shift normal wage (effectiveNormal), excluding Second Shift (effectiveShift)
  const isThai = !employee.nationality || employee.nationality === 'ไทย'
  const isExempt = !!employee.exempt_social_security
  const hasSsNumber = !isThai
    ? !!(employee.national_id?.trim() || employee.social_security_number?.trim())
    : true
  const isProfileComplete = !!employee.data_complete

  const isSsEligible = !isExempt && (isThai || (hasSsNumber && isProfileComplete))
  const defaultSsRate = period.social_security_rate != null ? Number(period.social_security_rate) : 0.05
  const activeSsRate = isSsEligible ? defaultSsRate : 0
  const deductSocialSecurity = Math.round(effectiveNormal * activeSsRate)

  // Advances (including face-scan deduction notes)
  const deductAdvance = advances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

  // Extra Deductions
  const deductSafetyEquipment = Number(extras?.deduct_safety_equipment) || 0
  const deductUniform = Number(extras?.deduct_uniform) || 0

  const totalDeductions = deductSocialSecurity + deductAdvance + deductSafetyEquipment + deductUniform

  const netPay = totalIncome - totalDeductions

  return {
    isClerk,
    totalShiftsCount,
    normalShiftsCount,
    holidayShiftsCount,
    fullShiftsCount,
    halfShiftsCount,
    normalTierCount,
    skilledTierCount,
    workDaysCount,
    holidayDaysCount,
    baseNormalWage,
    baseShiftWage,
    totalBaseShiftWage,
    overrideNormal,
    effectiveNormal,
    overrideShift,
    effectiveShift,
    amountHolidayOt,
    totalOtHours,
    regularOtPay,
    totalOtPay,
    overrideOt,
    effectiveOt,
    isEndOfMonth: isEndMonth,
    amountDiligence,
    amountPosition,
    amountSpecial,
    amountSafetyOfficer,
    specialNote,
    totalIncome,
    isSsEligible,
    socialSecurityRate: activeSsRate,
    deductSocialSecurity,
    deductAdvance,
    deductSafetyEquipment,
    deductUniform,
    totalDeductions,
    netPay,
    dailyAudit,
  }
}
