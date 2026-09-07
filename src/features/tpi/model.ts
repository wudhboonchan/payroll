export type RateTier = 'normal' | 'skilled'
export type Job = {
  id: string; factory_id: string; code: string; department: string; description: string
  job_type: 'regular' | 'temporary'; valid_from: string | null; expires_on: string | null
  quota: number; planned_morning: number | null; planned_afternoon: number | null; planned_night: number | null
  normal_rate: number; skilled_rate: number | null; active: boolean; notes: string; updated_at: string
}
export type WageProfile = {
  employee_id: string
  factory_id: string
  rate_tier: RateTier
  skilled_from: string | null
  job_id?: string | null
  job_code?: string | null
  updated_at: string
}
export type Employee = {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  nationality?: string | null
  status?: string | null
  position?: string | null
  job_title?: string | null
}
export type Entry = {
  employee_id: string
  shift_index: number
  job_id: string
  rate_tier?: RateTier
  rate_snapshot?: number
  job_code_snapshot?: string
  is_half_shift?: boolean
  actual_hours?: number
  ot_hours?: number
  ot_pay?: number
  is_holiday_ot?: boolean
}
export type ShiftDay = { revision: number; is_holiday?: boolean; entries: Entry[] }
export const SHIFTS = [
  { name: 'เช้า', time: '07:40–16:00', fullTime: '07:40 — 16:00' },
  { name: 'บ่าย', time: '15:40–00:00', fullTime: '15:40 — 00:00' },
  { name: 'ดึก', time: '23:40–08:00', fullTime: '23:40 — 08:00 (+1 วัน)' }
]
export const isTpiCompany = (name?: string | null) => {
  const str = String(name || '')
  return (/ทีพีไอ|\btpi\b/i.test(str)) && !(/ตราเพชร|\bdrt\b|diamond/i.test(str))
}
export function localDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export function isJobAvailable(job: Job, date: string) { return job.active && (!job.valid_from || date >= job.valid_from) && (!job.expires_on || date <= job.expires_on) }
export function wageTier(profile: WageProfile | undefined, date: string): RateTier { return profile?.rate_tier === 'skilled' && profile.skilled_from && profile.skilled_from <= date ? 'skilled' : 'normal' }
export function calculateEntryOt(
  otHours: number | undefined,
  baseRate: number,
  isClerk: boolean
): { ot_hours: number; ot_pay: number } {
  const hours = Number(otHours || 0)
  if (hours <= 0) return { ot_hours: 0, ot_pay: 0 }

  if (isClerk) {
    // Clerk OT: full 8h shift, paid 2x of daily rate
    return {
      ot_hours: 8,
      ot_pay: Math.round(baseRate * 2 * 100) / 100,
    }
  } else {
    // Roof climbing OT: paid per hour at (baseRate / 8) * 1.5 per hour — ceil to whole baht
    const hourlyRate = (baseRate / 8) * 1.5
    return {
      ot_hours: hours,
      ot_pay: Math.ceil(hourlyRate * hours),
    }
  }
}

export function entryRate(entry: Entry, jobs: Job[], profiles: WageProfile[], date: string, employees?: Employee[]): number | null {
  if (entry.rate_snapshot !== undefined) {
    const r = Number(entry.rate_snapshot)
    return entry.is_half_shift ? r / 2 : r
  }
  const job = jobs.find(j => j.id === entry.job_id)
  if (!job) return null
  const profile = profiles.find(p => p.employee_id === entry.employee_id)
  const emp = employees?.find(e => e.id === entry.employee_id)
  const isSkilledTier = wageTier(profile, date) === 'skilled'

  // Skilled rate applies ONLY if this is the employee's regular assigned job
  const isRegularJob = isSkilledTier && (
    (profile?.job_id && profile.job_id === entry.job_id) ||
    (profile?.job_code && job.code.trim().toLowerCase() === profile.job_code.trim().toLowerCase()) ||
    (emp?.job_title && (
      job.code.trim().toLowerCase() === emp.job_title.trim().toLowerCase() ||
      emp.job_title === entry.job_id
    ))
  )

  const baseRate = isRegularJob ? (job.skilled_rate ?? job.normal_rate) : job.normal_rate
  if (baseRate === null) return null
  return entry.is_half_shift ? baseRate / 2 : baseRate
}
export function validateEntries(entries: Entry[]) {
  const people = new Map<string, Set<number>>()
  for (const e of entries) {
    if (!e.employee_id || !e.job_id || !Number.isInteger(e.shift_index) || e.shift_index < 0 || e.shift_index > 2) return 'กรุณาระบุพนักงาน รหัสงาน และกะให้ครบ'
    const slots = people.get(e.employee_id) || new Set<number>()
    if (slots.has(e.shift_index)) return 'พนักงานหนึ่งคนทำได้เพียงงานเดียวต่อกะ'
    slots.add(e.shift_index); people.set(e.employee_id, slots)
    if (slots.size > 2) return 'พนักงานลงได้สูงสุด 2 กะต่อวัน รวมทุกรหัสงาน'
  }
  return null
}
export function usage(entries: Entry[], jobId: string) {
  const rows = entries.filter(e => e.job_id === jobId)
  return {
    total: rows.length,
    shifts: SHIFTS.map((_, i) => rows.filter(e => e.shift_index === i).length)
  }
}
export type QuotaStatus = 'paused' | 'completed' | 'incomplete' | 'exceeded' | 'zero'
export function getJobQuotaStatus(job: Job, assignedCount: number, customTarget?: number): QuotaStatus {
  if (!job.active) return 'paused'
  const target = customTarget !== undefined ? customTarget : job.quota
  if (target === 0 && assignedCount === 0) return 'zero'
  if (assignedCount === target) return 'completed'
  if (assignedCount < target) return 'incomplete'
  return 'exceeded'
}
