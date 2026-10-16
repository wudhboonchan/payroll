export interface SsoExportEntry {
  employee_id?: string
  amount_normal?: number | null
  override_normal?: number | null
  deduct_social_security?: number | null
  employee: {
    id?: string
    employee_code?: string
    national_id?: string | null
    social_security_number?: string | null
    prefix?: string | null
    first_name: string
    last_name?: string | null
    nationality?: string | null
    status?: string | null
    exempt_social_security?: boolean | null
  }
}

export interface SsoExportRow {
  'เลขบัตรประชาชน': string
  'คำนำหน้า': string
  'ชื่อ': string
  'สกุล': string
  'ค่าจ้าง': number
  'เงินสมทบ': number
}

/**
 * Builds rows for Social Security Fund (สปส. 1-10) Excel export.
 * - Includes Thai employees (unless explicitly exempt).
 * - Includes foreign employees who have Social Security deducted.
 * - Excludes foreign employees without Social Security deductions.
 */
export function buildSsoExportRows(entries: SsoExportEntry[]): SsoExportRow[] {
  const map: Record<string, { emp: SsoExportEntry['employee']; idNumber: string; n: number; ss: number }> = {}

  entries.forEach(r => {
    if (!r.employee) return
    const isThai = !r.employee.nationality || r.employee.nationality === 'ไทย'
    const ssAmt = Number(r.deduct_social_security || 0)
    const hasSsDeduction = Math.abs(ssAmt) > 0

    // Include any employee with SSO deduction, or Thai employees not exempt from SSO
    if (!hasSsDeduction && (!isThai || r.employee.exempt_social_security)) {
      return
    }

    const idNumber = r.employee.national_id?.trim() || r.employee.social_security_number?.trim() || ''
    const k = r.employee_id || r.employee.id || r.employee.employee_code || idNumber || `${r.employee.first_name}_${r.employee.last_name || ''}`
    if (!map[k]) {
      map[k] = { emp: r.employee, idNumber, n: 0, ss: 0 }
    }
    const normalVal = r.override_normal != null ? Number(r.override_normal) : (r.amount_normal || 0)
    map[k].n += normalVal
    map[k].ss += ssAmt
  })

  return Object.values(map)
    .filter(x => Math.abs(x.ss) > 0 || (!x.emp.exempt_social_security && (!x.emp.nationality || x.emp.nationality === 'ไทย')))
    .map(x => ({
      'เลขบัตรประชาชน': x.idNumber || x.emp.national_id?.trim() || x.emp.social_security_number?.trim() || '',
      'คำนำหน้า': x.emp.prefix || '',
      'ชื่อ': x.emp.first_name || '',
      'สกุล': x.emp.last_name || '',
      'ค่าจ้าง': x.n,
      'เงินสมทบ': Math.abs(x.ss),
    }))
}
