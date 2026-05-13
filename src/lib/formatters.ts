import { format, parseISO } from 'date-fns'
import { th } from 'date-fns/locale'

export function formatThaiCurrency(amount: number | null | undefined): string {
  if (amount == null) return '0.00'
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatThaiDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'd MMM yyyy', { locale: th })
}

export function toThaiYear(year: number): number {
  return year + 543
}

export function formatPeriodLabel(start: string, end: string): string {
  const startDate = parseISO(start)
  const endDate = parseISO(end)
  
  const thaiYear = toThaiYear(endDate.getFullYear())
  const sameMonth = format(startDate, 'MMMM') === format(endDate, 'MMMM')

  if (sameMonth) {
    return `${format(startDate, 'd')} - ${format(endDate, 'd MMMM', { locale: th })} ${thaiYear}`
  }
  return `${format(startDate, 'd MMMM', { locale: th })} - ${format(endDate, 'd MMMM', { locale: th })} ${thaiYear}`
}
