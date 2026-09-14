import { thaiBahtText } from './thaiBahtText'
import type { BillingShiftEntry, BillingEmployee } from './tpiBillingCalc'

export interface TimesheetDayCol {
  dateStr: string
  dayName: string // 'ส', 'อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ'
  dayNum: number  // 1, 2, 3...
}

export interface EmployeeTimesheetRow {
  employeeId: string
  employeeCode: string
  fullName: string
  nationality: string
  isThai: boolean
  dailyRate: number

  // 7 days hours
  dailyHours: number[] // length 7

  // Hours breakdown
  normalHours: number
  ot15Hours: number
  ot20Hours: number
  ot30Hours: number
  totalHours: number

  // Wages breakdown (VRK Pay)
  normalWage: number
  ot15Wage: number
  ot20Wage: number
  ot30Wage: number
  totalWage: number

  // Service fee (ค่าบริการ 28%)
  baseWageForFee: number
  serviceFee: number

  // Total billing (รวมเงินตั้งเบิก)
  totalBillingAmount: number
}

export interface TimesheetSectionSummary {
  rowCount: number
  totalDailyHours: number[] // length 7
  normalHours: number
  ot15Hours: number
  ot20Hours: number
  ot30Hours: number
  totalHours: number

  normalWage: number
  ot15Wage: number
  ot20Wage: number
  ot30Wage: number
  totalWage: number

  baseWageForFee: number
  serviceFee: number
  totalBillingAmount: number
}

export interface TimesheetBillingReport {
  dateRange: {
    start: string
    end: string
    days: TimesheetDayCol[]
  }
  days: TimesheetDayCol[]
  thaiWorkers: EmployeeTimesheetRow[]
  foreignWorkers: EmployeeTimesheetRow[]
  thaiSummary: TimesheetSectionSummary
  foreignSummary: TimesheetSectionSummary
  grandTotal: {
    totalDailyHours: number[]
    normalHours: number
    ot15Hours: number
    ot20Hours: number
    ot30Hours: number
    totalHours: number
    normalWage: number
    ot15Wage: number
    ot20Wage: number
    ot30Wage: number
    totalWage: number
    baseWageForFee: number
    serviceFee: number
    totalBillingAmount: number
    bahtText: string
  }
}

const THAI_DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

export function generateTimesheetDays(startDateStr: string, endDateStr: string): TimesheetDayCol[] {
  if (!startDateStr || !endDateStr) return []
  const current = new Date(startDateStr + 'T00:00:00')
  const end = new Date(endDateStr + 'T00:00:00')
  if (isNaN(current.getTime()) || isNaN(end.getTime()) || current > end) {
    return []
  }

  const days: TimesheetDayCol[] = []
  while (current <= end) {
    const y = current.getFullYear()
    const m = String(current.getMonth() + 1).padStart(2, '0')
    const d = String(current.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${d}`

    days.push({
      dateStr,
      dayName: THAI_DAY_NAMES[current.getDay()],
      dayNum: current.getDate(),
    })

    current.setDate(current.getDate() + 1)
  }
  return days
}

export function isThaiNationality(nat?: string | null): boolean {
  if (!nat) return true
  const trimmed = nat.trim().toLowerCase()
  if (trimmed === '' || trimmed === 'ไทย' || trimmed === 'thai') return true
  return false
}

export function calculateEmployeeTimesheetReport(
  shifts: BillingShiftEntry[],
  employees: (BillingEmployee & { nationality?: string | null; rate_per_12h?: number | null })[],
  startDateStr: string,
  endDateStr: string
): TimesheetBillingReport {
  const days = generateTimesheetDays(startDateStr, endDateStr)
  const dateIndexMap = new Map<string, number>()
  days.forEach((d, idx) => dateIndexMap.set(d.dateStr, idx))

  const empMap = new Map<string, BillingEmployee & { nationality?: string | null; rate_per_12h?: number | null }>()
  employees.forEach(e => empMap.set(e.id, e))

  // Group shifts by employee
  const empShiftsMap = new Map<string, BillingShiftEntry[]>()
  for (const s of shifts) {
    if (!dateIndexMap.has(s.work_date)) continue
    const list = empShiftsMap.get(s.employee_id) || []
    list.push(s)
    empShiftsMap.set(s.employee_id, list)
  }

  const thaiWorkers: EmployeeTimesheetRow[] = []
  const foreignWorkers: EmployeeTimesheetRow[] = []

  // Only include employees who worked in this date range
  Array.from(empShiftsMap.keys()).forEach((empId) => {
    const emp = empMap.get(empId)
    const empShifts = empShiftsMap.get(empId) || []
    if (!emp) return

    const isThai = isThaiNationality(emp.nationality)
    const prefix = (emp.prefix || '').trim()
    const fullName = prefix ? `${prefix} ${emp.first_name} ${emp.last_name}` : `${emp.first_name} ${emp.last_name}`

    // Find base rate from snapshot or fallback
    let dailyRate = 357
    for (const s of empShifts) {
      if (s.rate_snapshot && Number(s.rate_snapshot) > 0) {
        dailyRate = Number(s.rate_snapshot)
        break
      }
    }
    const hourlyRate = dailyRate / 8

    const dailyHours = new Array(days.length).fill(0)

    let normalHours = 0
    let ot15Hours = 0
    let ot20Hours = 0
    let ot30Hours = 0

    let normalWage = 0
    let ot15Wage = 0
    let ot20Wage = 0
    let ot30Wage = 0

    for (const s of empShifts) {
      const dayIdx = dateIndexMap.get(s.work_date)
      const isHalf = !!s.is_half_shift
      const shiftBaseHrs = isHalf ? 4 : 8
      const otHrs = Number(s.ot_hours) || 0

      // Add to daily total hours for timesheet cell
      if (dayIdx !== undefined) {
        dailyHours[dayIdx] += (shiftBaseHrs + otHrs)
      }

      if (s.is_holiday_ot) {
        // Holiday shift: 2.0x base
        ot20Hours += shiftBaseHrs
        ot20Wage += (Number(s.rate_snapshot) || dailyRate) * (isHalf ? 0.5 : 1.0) * 2.0

        if (otHrs > 0) {
          // Extra OT on holiday: 3.0x
          ot30Hours += otHrs
          ot30Wage += Number(s.ot_pay) || (otHrs * hourlyRate * 3.0)
        }
      } else {
        // Normal day shift
        normalHours += shiftBaseHrs
        normalWage += (Number(s.rate_snapshot) || dailyRate) * (isHalf ? 0.5 : 1.0)

        if (otHrs > 0) {
          ot15Hours += otHrs
          ot15Wage += Number(s.ot_pay) || (otHrs * hourlyRate * 1.5)
        }
      }
    }

    const totalHours = normalHours + ot15Hours + ot20Hours + ot30Hours
    const totalWage = Math.round((normalWage + ot15Wage + ot20Wage + ot30Wage) * 100) / 100

    // Service fee: 28% of base wage equivalent
    // shiftsCount = totalHours / 8
    const shiftUnits = totalHours / 8
    const baseWageForFee = Math.round(shiftUnits * dailyRate * 100) / 100
    const serviceFee = Math.round(baseWageForFee * 0.28 * 100) / 100

    const totalBillingAmount = Math.round((totalWage + serviceFee) * 100) / 100

    const row: EmployeeTimesheetRow = {
      employeeId: empId,
      employeeCode: emp.employee_code,
      fullName,
      nationality: emp.nationality || 'ไทย',
      isThai,
      dailyRate,
      dailyHours,
      normalHours,
      ot15Hours,
      ot20Hours,
      ot30Hours,
      totalHours,
      normalWage,
      ot15Wage,
      ot20Wage,
      ot30Wage,
      totalWage,
      baseWageForFee,
      serviceFee,
      totalBillingAmount,
    }

    if (isThai) {
      thaiWorkers.push(row)
    } else {
      foreignWorkers.push(row)
    }
  })

  // Sort employees by employee code
  thaiWorkers.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }))
  foreignWorkers.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }))

  function buildSummary(rows: EmployeeTimesheetRow[]): TimesheetSectionSummary {
    const totalDailyHours = new Array(days.length).fill(0)
    rows.forEach(r => {
      r.dailyHours.forEach((h, idx) => {
        totalDailyHours[idx] += h
      })
    })

    const normalHours = rows.reduce((acc, r) => acc + r.normalHours, 0)
    const ot15Hours = rows.reduce((acc, r) => acc + r.ot15Hours, 0)
    const ot20Hours = rows.reduce((acc, r) => acc + r.ot20Hours, 0)
    const ot30Hours = rows.reduce((acc, r) => acc + r.ot30Hours, 0)
    const totalHours = rows.reduce((acc, r) => acc + r.totalHours, 0)

    const normalWage = Math.round(rows.reduce((acc, r) => acc + r.normalWage, 0) * 100) / 100
    const ot15Wage = Math.round(rows.reduce((acc, r) => acc + r.ot15Wage, 0) * 100) / 100
    const ot20Wage = Math.round(rows.reduce((acc, r) => acc + r.ot20Wage, 0) * 100) / 100
    const ot30Wage = Math.round(rows.reduce((acc, r) => acc + r.ot30Wage, 0) * 100) / 100
    const totalWage = Math.round(rows.reduce((acc, r) => acc + r.totalWage, 0) * 100) / 100

    const baseWageForFee = Math.round(rows.reduce((acc, r) => acc + r.baseWageForFee, 0) * 100) / 100
    const serviceFee = Math.round(rows.reduce((acc, r) => acc + r.serviceFee, 0) * 100) / 100
    const totalBillingAmount = Math.round(rows.reduce((acc, r) => acc + r.totalBillingAmount, 0) * 100) / 100

    return {
      rowCount: rows.length,
      totalDailyHours,
      normalHours,
      ot15Hours,
      ot20Hours,
      ot30Hours,
      totalHours,
      normalWage,
      ot15Wage,
      ot20Wage,
      ot30Wage,
      totalWage,
      baseWageForFee,
      serviceFee,
      totalBillingAmount,
    }
  }

  const thaiSummary = buildSummary(thaiWorkers)
  const foreignSummary = buildSummary(foreignWorkers)

  const grandTotalBilling = Math.round((thaiSummary.totalBillingAmount + foreignSummary.totalBillingAmount) * 100) / 100
  const grandTotalDailyHours = days.map((_, idx) => (thaiSummary.totalDailyHours[idx] || 0) + (foreignSummary.totalDailyHours[idx] || 0))
  const grandTotal = {
    totalDailyHours: grandTotalDailyHours,
    normalHours: thaiSummary.normalHours + foreignSummary.normalHours,
    ot15Hours: thaiSummary.ot15Hours + foreignSummary.ot15Hours,
    ot20Hours: thaiSummary.ot20Hours + foreignSummary.ot20Hours,
    ot30Hours: thaiSummary.ot30Hours + foreignSummary.ot30Hours,
    totalHours: thaiSummary.totalHours + foreignSummary.totalHours,
    normalWage: Math.round((thaiSummary.normalWage + foreignSummary.normalWage) * 100) / 100,
    ot15Wage: Math.round((thaiSummary.ot15Wage + foreignSummary.ot15Wage) * 100) / 100,
    ot20Wage: Math.round((thaiSummary.ot20Wage + foreignSummary.ot20Wage) * 100) / 100,
    ot30Wage: Math.round((thaiSummary.ot30Wage + foreignSummary.ot30Wage) * 100) / 100,
    totalWage: Math.round((thaiSummary.totalWage + foreignSummary.totalWage) * 100) / 100,
    baseWageForFee: Math.round((thaiSummary.baseWageForFee + foreignSummary.baseWageForFee) * 100) / 100,
    serviceFee: Math.round((thaiSummary.serviceFee + foreignSummary.serviceFee) * 100) / 100,
    totalBillingAmount: grandTotalBilling,
    bahtText: thaiBahtText(grandTotalBilling),
  }

  return {
    dateRange: {
      start: startDateStr,
      end: endDateStr,
      days,
    },
    days,
    thaiWorkers,
    foreignWorkers,
    thaiSummary,
    foreignSummary,
    grandTotal,
  }
}
