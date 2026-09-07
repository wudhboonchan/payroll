import { supabase } from '../../lib/supabase'

export type AttendanceType = 'absent' | 'leave' | 'late'
export type LeaveType = 'sick' | 'business' | 'vacation' | 'other'

export interface AttendanceLog {
  id: string
  factory_id: string
  employee_id: string
  work_date: string
  type: AttendanceType
  leave_type: LeaveType | null
  minutes_late: number | null
  reason: string | null
  created_at?: string
  updated_at?: string
  employee?: {
    id: string
    employee_code: string
    first_name: string
    last_name: string
    position?: string | null
    nationality?: string | null
  }
}

export function getAttendanceTypeLabel(type: AttendanceType, _leaveType?: LeaveType | null): string {
  if (type === 'absent') return 'ขาดงาน'
  if (type === 'late') return 'มาสาย'
  if (type === 'leave') return 'ลา'
  return type
}

export function formatAttendanceSummary(log: AttendanceLog): string {
  const typeStr = getAttendanceTypeLabel(log.type, log.leave_type)
  const detailParts: string[] = []
  if (log.type === 'late' && log.minutes_late) {
    detailParts.push(`${log.minutes_late} นาที`)
  }
  if (log.reason && log.reason.trim()) {
    detailParts.push(log.reason.trim())
  }
  return detailParts.length > 0 ? `${typeStr} (${detailParts.join(', ')})` : typeStr
}

/**
 * Load attendance logs for a specific factory and work date
 */
export async function loadDailyAttendance(factoryId: string, date: string): Promise<AttendanceLog[]> {
  const { data, error } = await (supabase as any)
    .from('tpi_attendance_logs')
    .select('*, employee:employees(id,employee_code,first_name,last_name,position,nationality)')
    .eq('factory_id', factoryId)
    .eq('work_date', date)
    .order('created_at', { ascending: true })

  if (error) {
    // If table doesn't exist yet, return empty array to prevent crash
    if (error.message?.includes('does not exist') || error.code === '42P01') {
      console.warn('tpi_attendance_logs table does not exist yet. Please run migration_tpi_phase7.sql')
      return []
    }
    throw error
  }
  return (data || []) as AttendanceLog[]
}

/**
 * Add or update an attendance log entry
 */
export async function saveAttendanceLog(payload: {
  factory_id: string
  employee_id: string
  work_date: string
  type: AttendanceType
  leave_type?: LeaveType | null
  minutes_late?: number | null
  reason?: string | null
}): Promise<AttendanceLog> {
  const { data, error } = await (supabase as any)
    .from('tpi_attendance_logs')
    .upsert({
      factory_id: payload.factory_id,
      employee_id: payload.employee_id,
      work_date: payload.work_date,
      type: payload.type,
      leave_type: payload.type === 'leave' ? (payload.leave_type || 'other') : null,
      minutes_late: payload.type === 'late' ? (payload.minutes_late || null) : null,
      reason: payload.reason?.trim() || null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'factory_id,employee_id,work_date,type'
    })
    .select('*, employee:employees(id,employee_code,first_name,last_name,position,nationality)')
    .single()

  if (error) throw error
  return data as AttendanceLog
}

/**
 * Delete an attendance log entry by ID
 */
export async function deleteAttendanceLog(id: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('tpi_attendance_logs')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * Load all attendance logs for a factory across a whole month or date range
 */
export async function loadMonthlyAttendanceLogs(
  factoryId: string,
  startDate: string,
  endDate: string
): Promise<AttendanceLog[]> {
  const { data, error } = await (supabase as any)
    .from('tpi_attendance_logs')
    .select('*, employee:employees(id,employee_code,first_name,last_name,position,nationality)')
    .eq('factory_id', factoryId)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date', { ascending: true })

  if (error) {
    if (error.message?.includes('does not exist') || error.code === '42P01') {
      console.warn('tpi_attendance_logs table does not exist yet. Please run migration_tpi_phase7.sql')
      return []
    }
    throw error
  }
  return (data || []) as AttendanceLog[]
}
