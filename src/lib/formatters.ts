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

export const formatEmployeeFullName = (
  emp: {
    prefix?: string | null
    first_name: string
    last_name?: string | null
    nationality?: string | null
  },
  isTpi: boolean = true
): string => {
  const normPrefix = normalizePrefix(emp.prefix, emp.nationality, emp.first_name, isTpi)
  const first = (emp.first_name || '').trim()
  const last = (emp.last_name || '').trim()

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

  return fullName.trim()
}

export const formatEmployeeName = (emp: {
  prefix?: string | null
  first_name: string
  last_name?: string | null
  nationality?: string | null
}) => {
  const lastName = emp.last_name?.trim() ? ` ${emp.last_name.trim()}` : ''
  const name = `${emp.first_name}${lastName}`
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
