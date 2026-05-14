import { format, parseISO } from 'date-fns'
import { th } from 'date-fns/locale'

export const formatEmployeeName = (emp: {
  prefix?: string | null
  first_name: string
  last_name?: string | null
  nationality?: string | null
}) => {
  // Prefix is hidden in the UI as requested (kept only in DB for forms)
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
