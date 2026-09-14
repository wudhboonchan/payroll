export interface SafetyInstallment {
  id: string
  periodId: string
  amount: number
  notes: string
  step: number
  totalSteps: number
  isCurrent: boolean
  createdAt?: string
}

export interface SafetyIncident {
  id: string // Case ID or legacy key
  employeeId: string
  rowIds: string[]
  incidentDate: string // ISO format YYYY-MM-DD
  thDateStr: string // DD/MM/YYYY
  reason: string
  safetyAmount: number
  includeHr: boolean
  shiftRate: number
  hrAmount: number
  totalAmount: number
  installments: SafetyInstallment[]
  createdAt: string
}

/**
 * Calculates installment breakdown of 500-baht per semi-monthly period with exact remainder in the final period.
 */
export function calculateFineInstallments(totalFineAmount: number): number[] {
  if (totalFineAmount <= 0) return []
  const list: number[] = []
  let rem = Math.round(totalFineAmount * 100) / 100
  while (rem > 0) {
    if (rem >= 500) {
      list.push(500)
      rem = Math.round((rem - 500) * 100) / 100
    } else {
      list.push(rem)
      rem = 0
    }
  }
  return list
}

/**
 * Parses Buddhist Era DD/MM/YYYY to ISO YYYY-MM-DD
 */
export function parseThaiDateToIso(thDateStr: string): string {
  const match = thDateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ''
  const dy = match[1].padStart(2, '0')
  const mo = match[2].padStart(2, '0')
  let yr = parseInt(match[3], 10)
  if (yr > 2400) yr -= 543
  return `${yr}-${mo}-${dy}`
}

/**
 * Formats ISO YYYY-MM-DD to Thai Buddhist Era DD/MM/YYYY
 */
export function formatIsoToThaiDate(isoDate: string): string {
  if (!isoDate) return ''
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate
  const [yr, mo, dy] = parts
  const thYear = Number(yr) + 543
  return `${dy.padStart(2, '0')}/${mo.padStart(2, '0')}/${thYear}`
}

/**
 * Formats note string for a safety fine installment row
 */
export function formatSafetyFineNote(params: {
  caseId: string
  thDateStr: string
  step: number
  totalSteps: number
  reason: string
  totalAmount: number
  safetyAmount: number
  includeHr: boolean
  hrAmount: number
  shiftRate: number
  installmentAmount: number
}): string {
  const {
    caseId,
    thDateStr,
    step,
    totalSteps,
    reason,
    totalAmount,
    safetyAmount,
    includeHr,
    hrAmount,
    shiftRate,
    installmentAmount,
  } = params

  const hrText = includeHr
    ? ` + HR ฿${hrAmount.toLocaleString()} [฿${shiftRate}×3]`
    : ''
  const reasonClean = reason.trim()

  return `[หักค่าปรับ จป.] [CASE:${caseId}] หักค่าปรับผิดระเบียบ (วันที่ ${thDateStr} [${step}/${totalSteps}]) | สาเหตุ: ${reasonClean} | ยอดปรับเต็ม ฿${totalAmount.toLocaleString()} (จป. ฿${safetyAmount.toLocaleString()}${hrText}) (งวดที่ ${step}/${totalSteps} = ฿${installmentAmount.toLocaleString()})`
}

/**
 * Groups raw advance_payments rows into distinct SafetyIncidents.
 * Compatible with both newly tagged [CASE:...] rows and legacy rows.
 */
export function groupSafetyAdvancesToIncidents(
  advances: any[],
  currentPeriodId?: string
): SafetyIncident[] {
  const groups: Record<string, any[]> = {}

  for (const row of advances) {
    const notes = row.notes || ''
    // Check if it's a safety fine
    if (
      !notes.includes('[หักค่าปรับ จป.]') &&
      !notes.includes('หักค่าปรับผิดระเบียบ') &&
      !notes.includes('ค่าปรับผิดระเบียบ')
    ) {
      continue
    }

    // 1. Check explicit [CASE:id] token
    const caseMatch = notes.match(/\[CASE:([a-zA-Z0-9_-]+)\]/)
    let groupKey = ''

    if (caseMatch) {
      groupKey = `case_${caseMatch[1]}`
    } else {
      // 2. Legacy grouping by employeeId + date + reason
      const dateMatch = notes.match(/\(วันที่\s+(\d{1,2}\/\d{1,2}\/\d{4})/)
      const reasonMatch = notes.match(/สาเหตุ:\s*(.*?)(?:\s*\|\s*ยอดปรับเต็ม|$)/)

      const extractedDate = dateMatch ? dateMatch[1] : ''
      const extractedReason = reasonMatch ? reasonMatch[1].trim() : ''

      if (extractedDate || extractedReason) {
        groupKey = `legacy_${row.employee_id}_${extractedDate}_${extractedReason}`
      } else {
        // Fallback to row ID
        groupKey = `single_${row.id}`
      }
    }

    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(row)
  }

  const incidents: SafetyIncident[] = []

  for (const [key, rows] of Object.entries(groups)) {
    if (rows.length === 0) continue

    // Parse data from rows
    const firstRow = rows[0]
    const notes = firstRow.notes || ''

    // Case ID
    const caseMatch = notes.match(/\[CASE:([a-zA-Z0-9_-]+)\]/)
    const incidentId = caseMatch ? caseMatch[1] : key.replace(/^(case_|legacy_|single_)/, '')

    // Date
    const dateMatch = notes.match(/\(วันที่\s+(\d{1,2}\/\d{1,2}\/\d{4})/)
    const thDateStr = dateMatch ? dateMatch[1] : ''
    const incidentDate = thDateStr ? parseThaiDateToIso(thDateStr) : ''

    // Reason
    const reasonMatch = notes.match(/สาเหตุ:\s*(.*?)(?:\s*\|\s*ยอดปรับเต็ม|$)/)
    const reason = reasonMatch ? reasonMatch[1].trim() : (notes.replace(/\[หักค่าปรับ จป\.\]/g, '').trim() || 'ความผิดระเบียบวินัย')

    // Safety amount
    const safetyMatch = notes.match(/จป\.\s*฿([0-9,]+)/)
    const safetyAmount = safetyMatch ? Number(safetyMatch[1].replace(/,/g, '')) : 1000

    // HR fine
    const hrMatch = notes.match(/HR\s*฿([0-9,]+)(?:\s*\[฿([0-9,]+)×3\])?/)
    const includeHr = !!hrMatch
    const hrAmount = hrMatch ? Number(hrMatch[1].replace(/,/g, '')) : 0
    const shiftRate = hrMatch && hrMatch[2]
      ? Number(hrMatch[2].replace(/,/g, ''))
      : (hrAmount > 0 ? Math.round(hrAmount / 3) : 357)

    // Total amount
    const totalMatch = notes.match(/ยอดปรับเต็ม\s*฿([0-9,]+)/)
    const parsedTotal = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0
    const rowSum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const totalAmount = parsedTotal > 0 ? parsedTotal : rowSum

    // Parse installments
    const installments: SafetyInstallment[] = rows.map((r) => {
      const stepMatch = (r.notes || '').match(/\[(\d+)\/(\d+)\]/)
      const step = stepMatch ? parseInt(stepMatch[1], 10) : 1
      const totalSteps = stepMatch ? parseInt(stepMatch[2], 10) : rows.length
      return {
        id: r.id,
        periodId: r.period_id,
        amount: Number(r.amount) || 0,
        notes: r.notes || '',
        step,
        totalSteps,
        isCurrent: r.period_id === currentPeriodId,
        createdAt: r.created_at,
      }
    }).sort((a, b) => a.step - b.step)

    incidents.push({
      id: incidentId,
      employeeId: firstRow.employee_id,
      rowIds: rows.map((r) => r.id),
      incidentDate,
      thDateStr,
      reason,
      safetyAmount,
      includeHr,
      shiftRate,
      hrAmount,
      totalAmount,
      installments,
      createdAt: firstRow.created_at || new Date().toISOString(),
    })
  }

  // Sort latest incident first
  return incidents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}
