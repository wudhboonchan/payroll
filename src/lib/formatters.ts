import { format, parseISO } from 'date-fns'
import { th } from 'date-fns/locale'

export const normalizePrefix = (
  prefix: string | null | undefined,
  nationality?: string | null,
  firstName?: string | null,
  isTpi: boolean = true
): string => {
  if (!prefix) return ''
  const p = prefix.trim()
  if (!isTpi) return p // Non-TPI (e.g. Diamond factory): keep exact prefix as entered

  const isForeign =
    (nationality && nationality !== 'ไทย') ||
    (firstName && /^[a-zA-Z]/.test(firstName.trim()))

  if (isForeign) {
    if (p === 'นาย' || p.toLowerCase() === 'mr' || p.toLowerCase() === 'mr.') return 'Mr.'
    if (p === 'นาง' || p.toLowerCase() === 'mrs' || p.toLowerCase() === 'mrs.') return 'Mrs.'
    if (p === 'นางสาว' || p.toLowerCase() === 'ms' || p.toLowerCase() === 'ms.') return 'Ms.'
    return p
  } else {
    if (p.toLowerCase() === 'mr' || p.toLowerCase() === 'mr.') return 'นาย'
    if (p.toLowerCase() === 'mrs' || p.toLowerCase() === 'mrs.') return 'นาง'
    if (p.toLowerCase() === 'ms' || p.toLowerCase() === 'ms.') return 'นางสาว'
    return p
  }
}

export const PREFIX_PATTERNS = [
  { prefix: 'นางสาว', regex: /^(นางสาว|น\.ส\.|น\.ส)\s*/i },
  { prefix: 'นาย', regex: /^(นาย)\s*/i },
  { prefix: 'นาง', regex: /^(นาง)\s*/i },
  { prefix: 'ด.ช.', regex: /^(ด\.ช\.|เด็กชาย)\s*/i },
  { prefix: 'ด.ญ.', regex: /^(ด\.ญ\.|เด็กหญิง)\s*/i },
  { prefix: 'Mr.', regex: /^(mr\.|mr\b)\s*/i },
  { prefix: 'Mrs.', regex: /^(mrs\.|mrs\b)\s*/i },
  { prefix: 'Ms.', regex: /^(ms\.|ms\b|miss\b)\s*/i },
]

export interface CleanedEmployeeName {
  prefix: string
  first_name: string
  last_name: string
}

export const cleanEmployeeNameData = (
  emp: {
    prefix?: string | null
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    nationality?: string | null
  },
  isTpi: boolean = true
): CleanedEmployeeName => {
  let prefix = (emp.prefix || '').trim()
  let first = (emp.first_name || '').trim()
  let last = (emp.last_name || '').trim()
  const full = (emp.full_name || '').trim()
  const nat = emp.nationality || 'ไทย'
  const isForeign = (nat && nat !== 'ไทย') || /^[a-zA-Z]/.test(first || full)

  // 1. If first_name is empty but full_name is present, parse full_name
  if (!first && full) {
    let remainder = full
    for (const p of PREFIX_PATTERNS) {
      const match = remainder.match(p.regex)
      if (match) {
        if (!prefix) prefix = p.prefix
        remainder = remainder.slice(match[0].length).trim()
        break
      }
    }
    if (isForeign) {
      first = remainder
      last = ''
    } else {
      const spaceIdx = remainder.search(/\s+/)
      if (spaceIdx !== -1) {
        first = remainder.slice(0, spaceIdx).trim()
        last = remainder.slice(spaceIdx).trim()
      } else {
        first = remainder
        last = ''
      }
    }
  }

  // 2. Extract prefix from first_name if embedded (e.g. 'นายเจนศักดิ์' -> prefix: 'นาย', first: 'เจนศักดิ์')
  for (const p of PREFIX_PATTERNS) {
    const match = first.match(p.regex)
    if (match) {
      if (!prefix) prefix = p.prefix
      first = first.slice(match[0].length).trim()
      break
    }
  }

  prefix = normalizePrefix(prefix, nat, first, isTpi)

  // 3. Clean up last_name if it duplicates first_name or full name
  if (last) {
    const candidatesToStrip = [
      (prefix && first) ? `${prefix} ${first}` : '',
      (prefix && first) ? `${prefix}${first}` : '',
      emp.first_name ? emp.first_name.trim() : '',
      first,
    ].filter(Boolean)

    let cleanedLast = last
    for (const cand of candidatesToStrip) {
      const cLow = cand.toLowerCase()
      const lLow = cleanedLast.toLowerCase()
      if (lLow === cLow) {
        cleanedLast = ''
        break
      }
      if (lLow.startsWith(cLow + ' ')) {
        cleanedLast = cleanedLast.slice(cand.length).trim()
        break
      }
      // Also handle case where there was no space in last_name e.g. 'นายเจนศักดิ์บุญมีมา'
      if (lLow.startsWith(cLow) && prefix && cand.includes(first)) {
        const after = cleanedLast.slice(cand.length).trim()
        if (after.length > 0) {
          cleanedLast = after
          break
        }
      }
    }
    last = cleanedLast
  }

  return { prefix, first_name: first, last_name: last }
}

export const formatEmployeeFullName = (
  emp: {
    prefix?: string | null
    first_name: string
    last_name?: string | null
    nationality?: string | null
  },
  isTpi: boolean = true
): string => {
  if (!emp) return ''
  const cleaned = cleanEmployeeNameData(emp, isTpi)
  const normPrefix = normalizePrefix(cleaned.prefix, emp.nationality, cleaned.first_name, isTpi)
  const first = cleaned.first_name
  const last = cleaned.last_name

  let fullName = first
  if (normPrefix) {
    if (/[a-zA-Z]/.test(normPrefix) || normPrefix.endsWith('.') || /^[a-zA-Z]/.test(first)) {
      fullName = `${normPrefix} ${first}`
    } else {
      fullName = `${normPrefix}${first}`
    }
  }

  if (last) {
    fullName = `${fullName} ${last}`
  }

  return fullName.replace(/\s+/g, ' ').trim()
}

export const formatEmployeeName = (
  emp: {
    prefix?: string | null
    first_name: string
    last_name?: string | null
    nationality?: string | null
  },
  isTpi: boolean = true
) => {
  if (!emp) return ''
  const cleaned = cleanEmployeeNameData(emp, isTpi)
  const lastName = cleaned.last_name ? ` ${cleaned.last_name}` : ''
  const name = `${cleaned.first_name}${lastName}`
  const nat = emp.nationality
  if (!nat || nat === 'ไทย') return name
  return `${name} (${nat})`
}

export const formatThaiCurrency = (amount: number | null | undefined): string => {
  if (amount == null) return '0.00'
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export const formatThaiDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'd MMM yyyy', { locale: th })
}

export const toThaiYear = (year: number): number => {
  return year + 543
}

export const formatThaiBuddhistDate = (dateStr: string | null | undefined, fallback: string = 'ไม่มีกำหนด'): string => {
  if (!dateStr) return fallback
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10)
    const month = parts[1].padStart(2, '0')
    const day = parts[2].padStart(2, '0')
    if (!isNaN(year)) {
      const thaiYear = year + 543
      return `${day}/${month}/${thaiYear}`
    }
  }
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const thaiYear = d.getFullYear() + 543
      return `${day}/${month}/${thaiYear}`
    }
  } catch {
    // fallback
  }
  return dateStr
}

/**
 * Formats a date string into Thai Buddhist format วว-ดด-ปปปป (DD-MM-YYYY)
 * Example: '2026-09-07' -> '07-09-2569'
 */
export const formatThaiDateDDMMYYYY = (rawDate: string | null | undefined): string => {
  if (!rawDate) return ''
  const trimmed = rawDate.trim()
  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/)
  if (ymdMatch) {
    const y = Number(ymdMatch[1])
    const m = ymdMatch[2].padStart(2, '0')
    const d = ymdMatch[3].padStart(2, '0')
    const thaiYear = y < 2400 ? y + 543 : y
    return `${d}-${m}-${thaiYear}`
  }
  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0')
    const m = dmyMatch[2].padStart(2, '0')
    const y = Number(dmyMatch[3])
    const thaiYear = y < 2400 ? y + 543 : y
    return `${d}-${m}-${thaiYear}`
  }
  return trimmed
}

export const formatPeriodLabel = (start: string, end: string): string => {
  const startDate = parseISO(start)
  const endDate = parseISO(end)
  
  const thaiYear = toThaiYear(endDate.getFullYear())
  const sameMonth = format(startDate, 'MMMM') === format(endDate, 'MMMM')

  if (sameMonth) {
    return `${format(startDate, 'd')} - ${format(endDate, 'd MMMM', { locale: th })} ${thaiYear}`
  }
  return `${format(startDate, 'd MMMM', { locale: th })} - ${format(endDate, 'd MMMM', { locale: th })} ${thaiYear}`
}

/**
 * Natural numeric comparator for employee codes (e.g., "1267" comes before "12302")
 */
export const compareEmployeeCode = (a: string | null | undefined, b: string | null | undefined): number => {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Formats date string (YYYY-MM-DD) into standard Thai Buddhist format: D MMM YYYY (e.g. 18 ส.ค. 2569)
 */
export const formatThaiDateShort = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-'
  const trimmed = dateStr.trim()
  const match = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)
  if (match) {
    const y = parseInt(match[1], 10)
    const m = parseInt(match[2], 10)
    const d = parseInt(match[3], 10)
    const thaiYear = y < 2400 ? y + 543 : y
    const monthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ]
    const mIdx = m - 1
    if (mIdx >= 0 && mIdx < 12) {
      return `${d} ${monthNames[mIdx]} ${thaiYear}`
    }
  }
  return dateStr
}

/**
 * Formats a monthly cycle range from a period date (e.g. '2026-08-31' or '2026-08-25')
 * Returns format like: '1-31 ส.ค. 69'
 */
export const formatMonthlyCycleRange = (dateStr: string | null | undefined): string => {
  if (!dateStr) return ''
  const trimmed = dateStr.trim()
  const match = trimmed.match(/^(\d{4})[-\/](\d{1,2})/)
  if (!match) return ''
  const y = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const lastDay = new Date(y, m, 0).getDate()
  const thaiYear = y < 2400 ? y + 543 : y
  const thaiYear2 = String(thaiYear).slice(-2)
  const monthNames = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ]
  const mName = monthNames[m - 1] || ''
  return `1-${lastDay} ${mName} ${thaiYear2}`
}


