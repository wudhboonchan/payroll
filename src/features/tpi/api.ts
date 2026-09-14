import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Json } from '../../types/database'
import type { Job, WageProfile, Entry, ShiftDay } from './model'
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] }
type TpiDatabase = { public: {
  Tables: { tpi_job_codes: Table<Job>; tpi_employee_wage_profiles: Table<WageProfile> }
  Views: Record<string, never>
  Functions: {
    tpi_load_shift_day: { Args: { p_factory: string; p_date: string }; Returns: Json }
    tpi_save_shift_day: { Args: { p_factory: string; p_date: string; p_revision: number; p_entries: Json }; Returns: number }
  }
  Enums: Record<string, never>; CompositeTypes: Record<string, never>
} }
// Reuse the authenticated client. The added schema is isolated until generated types are refreshed.
export const tpiDb = supabase as unknown as SupabaseClient<TpiDatabase>
export async function loadJobs(factory: string) {
  const {data,error} = await tpiDb.from('tpi_job_codes').select('*').eq('factory_id',factory).order('code')
  if(error) throw error
  return data
}
export async function loadProfiles(factory: string) {
  const {data,error} = await tpiDb.from('tpi_employee_wage_profiles').select('*').eq('factory_id',factory)
  if(error) throw error
  return data
}
export async function loadDay(factory:string,date:string):Promise<ShiftDay> {
  const {data,error}=await tpiDb.rpc('tpi_load_shift_day',{p_factory:factory,p_date:date})
  if(error) throw error
  return data as unknown as ShiftDay
}
export async function saveDay(factory:string,date:string,day:ShiftDay) {
  const entriesPayload = day.entries.map((e:Entry)=>({
    employee_id:e.employee_id,
    shift_index:e.shift_index,
    job_id:e.job_id,
    is_half_shift:!!e.is_half_shift,
    actual_hours:e.is_half_shift ? 4 : (e.actual_hours || 8),
    ot_hours:Number(e.ot_hours || 0),
    ot_pay:Number(e.ot_pay || 0),
    is_holiday_ot:!!day.is_holiday || !!e.is_holiday_ot,
    is_ot_before_shift: !!e.is_ot_before_shift,
    ot_job_id: e.ot_job_id || null,
    ot_job_code_snapshot: e.ot_job_code_snapshot || null,
    is_pending: !!e.is_pending
  }))

  const { data, error } = await tpiDb.rpc('tpi_save_shift_day', {
    p_factory: factory,
    p_date: date,
    p_revision: day.revision,
    p_entries: entriesPayload,
    p_is_holiday: !!day.is_holiday,
  } as any)

  if (error) {
    console.error('saveDay RPC error:', error)
    throw error
  }
  return data
}

export async function preassignShifts(
  factory: string,
  targetDates: string[],
  entries: Entry[]
) {
  const entriesPayload = entries.map((e: Entry) => ({
    employee_id: e.employee_id,
    shift_index: e.shift_index,
    job_id: e.job_id,
    is_half_shift: !!e.is_half_shift,
    actual_hours: e.is_half_shift ? 4 : (e.actual_hours || 8),
    ot_hours: Number(e.ot_hours || 0),
    ot_pay: Number(e.ot_pay || 0),
    is_holiday_ot: !!e.is_holiday_ot,
    is_ot_before_shift: !!e.is_ot_before_shift,
    ot_job_id: e.ot_job_id || null,
    ot_job_code_snapshot: e.ot_job_code_snapshot || null,
    is_pending: true,
  }))

  try {
    const { data, error } = await tpiDb.rpc('tpi_preassign_shifts', {
      p_factory: factory,
      p_target_dates: targetDates,
      p_entries: entriesPayload,
    } as any)
    if (error) throw error
    return data
  } catch (err: any) {
    console.warn('tpi_preassign_shifts RPC fallback:', err)
    for (const d of targetDates) {
      await tpiDb.from('tpi_shift_days').upsert({
        factory_id: factory,
        work_date: d,
        revision: 0,
      }, { onConflict: 'factory_id,work_date' })

      const rows = entriesPayload.map((item) => ({
        factory_id: factory,
        work_date: d,
        employee_id: item.employee_id,
        shift_index: item.shift_index,
        job_id: item.job_id,
        is_half_shift: item.is_half_shift,
        actual_hours: item.actual_hours,
        ot_hours: item.ot_hours,
        ot_pay: item.ot_pay,
        is_holiday_ot: item.is_holiday_ot,
        is_ot_before_shift: item.is_ot_before_shift,
        ot_job_id: item.ot_job_id,
        ot_job_code_snapshot: item.ot_job_code_snapshot,
        is_pending: true,
      }))

      if (rows.length > 0) {
        await tpiDb.from('tpi_shift_entries').upsert(rows, {
          onConflict: 'factory_id,work_date,employee_id,shift_index',
        })
      }
    }
  }
}

export const errorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
  const msg = 'message' in error ? String((error as any).message) : ''
  if (msg.includes('does not exist')) {
    return 'โครงสร้างฐานข้อมูล Supabase ยังขาดคอลัมน์ที่จำเป็น กรุณาคัดลอกคำสั่ง SQL ล่าสุดไปรันใน Supabase SQL Editor'
  }
  if (msg.includes('invalid input syntax for type uuid')) {
    return 'รหัสงานหรือรหัสพนักงานไม่ถูกต้อง กรุณารีเฟรชหน้าจอแล้วลองใหม่อีกครั้ง'
  }
  if (msg.includes('Could not choose the best candidate function')) {
    return 'ฟังก์ชันในฐานข้อมูล Supabase มีเวอร์ชันเดิมค้างอยู่ กรุณารันคำสั่ง SQL Migration ล่าสุดใน Supabase SQL Editor'
  }
  if (msg.includes('FOR SHARE cannot be applied')) {
    return 'ฟังก์ชันในฐานข้อมูลติดเงื่อนไขการล็อกตาราง กรุณาคัดลอกคำสั่งใน migration_fix_for_share_outer_join.sql ไปรันใน Supabase SQL Editor'
  }
  if (msg.includes('ข้อมูลวันนี้ถูกแก้ไขแล้ว')) {
    return 'ข้อมูลวันนี้ถูกแก้ไขหรือยังไม่ตรงกับฐานข้อมูล กรุณารีเฟรชก่อนบันทึก'
  }
  if (msg.includes('พนักงานลงได้สูงสุด 2 กะ')) {
    return 'พนักงานสามารถลงได้สูงสุด 2 กะต่อวัน และห้ามจัดกะซ้ำ'
  }
  if (msg.includes('Not authorized')) {
    return 'ไม่มีสิทธิ์ในการแก้ไขข้อมูลของโรงงานนี้'
  }
  return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
}
