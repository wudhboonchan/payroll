import type { Job } from './model'

export interface BillingEmployee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix?: string | null
  gender?: 'male' | 'female'
  status?: string | null
}

export interface BillingShiftEntry {
  id?: string
  work_date: string
  employee_id: string
  shift_index: number
  job_id: string
  job_code_snapshot: string
  rate_tier: 'normal' | 'skilled'
  rate_snapshot: number
  is_half_shift?: boolean
  actual_hours?: number
  ot_hours?: number
  ot_pay?: number
  is_holiday_ot?: boolean
}

export interface JobBillingGroup {
  jobCode: string
  jobDescription: string
  department: string

  // Rates applied
  normalRate: number
  skilledRate: number
  billingNormalRate: number
  billingSkilledRate: number

  // Shift & Headcount Breakdown
  normalMaleShifts: number
  normalFemaleShifts: number
  totalNormalShifts: number

  skilledMaleShifts: number
  skilledFemaleShifts: number
  totalSkilledShifts: number

  totalShifts: number

  // Unique workers (Headcount)
  uniqueMaleCount: number
  uniqueFemaleCount: number
  uniqueTotalCount: number

  // Cost to Workers (VRK Cost)
  totalNormalWage: number
  totalSkilledWage: number

  ot15Hours: number
  ot15Pay: number

  ot20Hours: number
  ot20Pay: number

  totalWagePaid: number

  // Factory Billing (Revenue)
  billingNormalAmount: number
  billingSkilledAmount: number

  ot15BillingAmount: number
  ot20BillingAmount: number
  totalOtBillingAmount: number

  totalBillingAmount: number

  // Gross Margin
  grossProfit: number
  marginPercent: number
}

export interface FactoryBillingSummary {
  periodId: string
  periodLabel: string
  factoryName: string
  jobGroups: JobBillingGroup[]

  // Totals
  totalShifts: number
  totalWorkers: number
  totalNormalShifts: number
  totalSkilledShifts: number

  totalWagePaid: number
  totalBillingAmount: number
  totalGrossProfit: number
  overallMarginPercent: number
}

/**
 * Determines employee gender based on prefix or first_name
 */
export function detectGender(emp: { prefix?: string | null; first_name?: string }): 'male' | 'female' {
  const p = (emp.prefix || '').trim().toLowerCase()
  const fn = (emp.first_name || '').trim().toLowerCase()

  if (
    p.startsWith('นาย') ||
    p === 'mr.' ||
    p === 'mr' ||
    fn.startsWith('นาย ') ||
    fn.startsWith('mr. ') ||
    fn.startsWith('mr ')
  ) {
    return 'male'
  }

  if (
    p.startsWith('นาง') ||
    p.startsWith('น.ส.') ||
    p.startsWith('นส.') ||
    p === 'ms.' ||
    p === 'ms' ||
    p === 'mrs.' ||
    p === 'mrs' ||
    p === 'miss' ||
    fn.startsWith('นาง ') ||
    fn.startsWith('นางสาว') ||
    fn.startsWith('น.ส.') ||
    fn.startsWith('ms. ') ||
    fn.startsWith('mrs. ')
  ) {
    return 'female'
  }

  // Default to male if unspecified
  return 'male'
}

/**
 * Calculates Factory Billing Statement grouped by Job Code
 */
export function calculateFactoryBilling(
  shifts: BillingShiftEntry[],
  employees: BillingEmployee[],
  jobMasterList: Job[],
  periodLabel: string,
  factoryName = 'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)'
): FactoryBillingSummary {
  const empMap = new Map<string, BillingEmployee>()
  employees.forEach(e => empMap.set(e.id, e))

  // Normalized job master map by lower case code
  const jobMap = new Map<string, Job>()
  jobMasterList.forEach(j => {
    jobMap.set(j.code.trim().toLowerCase(), j)
    if (j.id) jobMap.set(j.id, j)
  })

  // Group shifts by jobCode
  const groupMap = new Map<string, BillingShiftEntry[]>()
  for (const s of shifts) {
    const rawCode = (s.job_code_snapshot || '').trim()
    const codeKey = rawCode || (jobMap.get(s.job_id)?.code || 'UNASSIGNED').trim()
    const list = groupMap.get(codeKey) || []
    list.push(s)
    groupMap.set(codeKey, list)
  }

  const jobGroups: JobBillingGroup[] = []

  // Sort job codes alphabetically
  const sortedJobCodes = Array.from(groupMap.keys()).sort((a, b) => a.localeCompare(b, 'th'))

  for (const jobCode of sortedJobCodes) {
    const groupShifts = groupMap.get(jobCode) || []
    const matchedMaster = jobMap.get(jobCode.toLowerCase()) || jobMasterList.find(j => j.code.toLowerCase() === jobCode.toLowerCase())

    const jobDescription = matchedMaster?.description || '-'
    const department = matchedMaster?.department || '-'

    const normalRate = matchedMaster?.normal_rate ?? 357
    const skilledRate = matchedMaster?.skilled_rate ?? 377
    const billingNormalRate = matchedMaster?.billing_normal_rate ?? (matchedMaster?.billing_rate ?? 457)
    const billingSkilledRate = matchedMaster?.billing_skilled_rate ?? 492

    let normalMaleShifts = 0
    let normalFemaleShifts = 0
    let skilledMaleShifts = 0
    let skilledFemaleShifts = 0

    let totalNormalWage = 0
    let totalSkilledWage = 0

    let ot15Hours = 0
    let ot15Pay = 0

    let ot20Hours = 0
    let ot20Pay = 0

    const maleWorkerSet = new Set<string>()
    const femaleWorkerSet = new Set<string>()

    for (const s of groupShifts) {
      const emp = empMap.get(s.employee_id)
      const gender = emp ? detectGender(emp) : 'male'

      if (gender === 'male') {
        maleWorkerSet.add(s.employee_id)
      } else {
        femaleWorkerSet.add(s.employee_id)
      }

      const isSkilled = s.rate_tier === 'skilled'
      const isHalf = !!s.is_half_shift
      const shiftUnits = isHalf ? 0.5 : 1.0

      const baseDailyRate = isSkilled ? skilledRate : normalRate

      if (s.is_holiday_ot) {
        // กะทำงานวันหยุด (ได้ 2 เท่า): คิดเป็น OT 2.0x เต็มจำนวน 2 เท่า (เช่น 16 ชม. = 1,428 บาท)
        const holHours = isHalf ? 4 : 8
        const singleWage = Number(s.rate_snapshot) || (baseDailyRate * shiftUnits)
        const doubleWage = singleWage * 2
        ot20Hours += holHours
        ot20Pay += doubleWage
      } else {
        // กะทำงานวันปกติ (กะ 1, กะ 2): นับเป็นกะปกติ และคำนวณเบสค่าแรงปกติ
        if (isSkilled) {
          if (gender === 'male') skilledMaleShifts += shiftUnits
          else skilledFemaleShifts += shiftUnits
          totalSkilledWage += (Number(s.rate_snapshot) || (skilledRate * shiftUnits))
        } else {
          if (gender === 'male') normalMaleShifts += shiftUnits
          else normalFemaleShifts += shiftUnits
          totalNormalWage += (Number(s.rate_snapshot) || (normalRate * shiftUnits))
        }
      }

      // ค่าจ้าง OT 1.5 เท่า (นับเป็นชั่วโมง ส่วนที่เกินจากกะปกติ 8 ชม.)
      const otHrs = Number(s.ot_hours) || 0
      const otMoney = Number(s.ot_pay) || 0
      if (otHrs > 0 || otMoney > 0) {
        const baseHourlyRate = baseDailyRate / 8
        ot15Hours += otHrs
        ot15Pay += otMoney > 0 ? otMoney : Math.ceil(baseHourlyRate * 1.5 * otHrs)
      }
    }

    const totalNormalShifts = normalMaleShifts + normalFemaleShifts
    const totalSkilledShifts = skilledMaleShifts + skilledFemaleShifts
    // รวมแรงงาน = รวมปกติ + รวมฝีมือ (ตรงตามจำนวนกะปกติที่แจงไว้ข้างหน้า)
    const totalShifts = totalNormalShifts + totalSkilledShifts

    // Factory Billing Calculation
    const billingNormalAmount = totalNormalShifts * billingNormalRate
    const billingSkilledAmount = totalSkilledShifts * billingSkilledRate

    // OT 1.5x Billing (+28% markup on hourly base):
    const baseHourlyNormal = normalRate / 8
    const ot15AdminMarkup = ot15Hours * (baseHourlyNormal * 0.28)
    const ot15BillingAmount = Math.round((ot15Pay + ot15AdminMarkup) * 100) / 100

    // OT 2.0x Billing (วันหยุด 2 เท่า): ยอดที่จ่ายพนักงาน (1,428) + markup 28% ของค่าแรงฐาน (199.92 ≈ 200) = 1,627.92
    const ot20AdminMarkup = (ot20Hours / 8) * (normalRate * 0.28)
    const ot20BillingAmount = Math.round((ot20Pay + ot20AdminMarkup) * 100) / 100

    const totalOtBillingAmount = ot15BillingAmount + ot20BillingAmount
    const totalBillingAmount = billingNormalAmount + billingSkilledAmount + totalOtBillingAmount

    const totalWagePaid = totalNormalWage + totalSkilledWage + ot15Pay + ot20Pay
    const grossProfit = totalBillingAmount - totalWagePaid
    const marginPercent = totalBillingAmount > 0 ? (grossProfit / totalBillingAmount) * 100 : 0

    jobGroups.push({
      jobCode,
      jobDescription,
      department,

      normalRate,
      skilledRate,
      billingNormalRate,
      billingSkilledRate,

      normalMaleShifts,
      normalFemaleShifts,
      totalNormalShifts,

      skilledMaleShifts,
      skilledFemaleShifts,
      totalSkilledShifts,

      totalShifts,

      uniqueMaleCount: maleWorkerSet.size,
      uniqueFemaleCount: femaleWorkerSet.size,
      uniqueTotalCount: new Set([...maleWorkerSet, ...femaleWorkerSet]).size,

      totalNormalWage,
      totalSkilledWage,

      ot15Hours,
      ot15Pay,

      ot20Hours,
      ot20Pay,

      totalWagePaid,

      billingNormalAmount,
      billingSkilledAmount,

      ot15BillingAmount,
      ot20BillingAmount,
      totalOtBillingAmount,

      totalBillingAmount,

      grossProfit,
      marginPercent,
    })
  }

  // Summary Totals
  const totalNormalShifts = jobGroups.reduce((acc, g) => acc + g.totalNormalShifts, 0)
  const totalSkilledShifts = jobGroups.reduce((acc, g) => acc + g.totalSkilledShifts, 0)
  const totalShifts = totalNormalShifts + totalSkilledShifts
  const totalWagePaid = jobGroups.reduce((acc, g) => acc + g.totalWagePaid, 0)
  const totalBillingAmount = jobGroups.reduce((acc, g) => acc + g.totalBillingAmount, 0)
  const totalGrossProfit = totalBillingAmount - totalWagePaid
  const overallMarginPercent = totalBillingAmount > 0 ? (totalGrossProfit / totalBillingAmount) * 100 : 0

  const allWorkersSet = new Set(shifts.map(s => s.employee_id))

  return {
    periodId: '',
    periodLabel,
    factoryName,
    jobGroups,

    totalShifts,
    totalWorkers: allWorkersSet.size,
    totalNormalShifts,
    totalSkilledShifts,

    totalWagePaid,
    totalBillingAmount,
    totalGrossProfit,
    overallMarginPercent,
  }
}
