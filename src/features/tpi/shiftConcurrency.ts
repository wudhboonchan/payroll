import { validateEntries, type Entry, type ShiftDay } from './model.ts'

// Compare writable fields only. Database snapshots are recalculated by the RPC.
function signature(e?: Entry): string {
  if (!e) return 'missing'
  return JSON.stringify([
    e.job_id, !!e.is_half_shift, e.is_half_shift ? 4 : Number(e.actual_hours || 8),
    Number(e.ot_hours || 0), Number(e.ot_pay || 0), !!e.is_holiday_ot,
    !!e.is_ot_before_shift, e.ot_job_id || null, e.ot_job_code_snapshot || null,
    !!e.is_pending, e.non_billable_rate ?? null, e.non_billable_reason || null,
  ])
}

export function mergeShiftDay(base: ShiftDay, local: ShiftDay, remote: ShiftDay): ShiftDay {
  const conflict = () => new Error('ข้อมูลวันนี้ถูกแก้ไขแล้ว มีการแก้กะของพนักงานคนเดียวกัน กรุณาเก็บรายการที่แก้ไว้และเปิดข้อมูลล่าสุดก่อนบันทึก')
  // Treat all shifts of an employee as one unit, so concurrent moves cannot duplicate shifts.
  const employeeSignature = (day: ShiftDay, id: string) => JSON.stringify(day.entries
    .filter(e => e.employee_id === id).map(e => [e.shift_index, signature(e)])
    .sort((a, b) => Number(a[0]) - Number(b[0])))
  const ids = new Set([...base.entries, ...local.entries, ...remote.entries].map(e => e.employee_id))
  const entries: Entry[] = []
  for (const id of ids) {
    const before = employeeSignature(base, id)
    const ours = employeeSignature(local, id)
    const theirs = employeeSignature(remote, id)
    if (ours !== before && theirs !== before && ours !== theirs) throw conflict()
    entries.push(...(ours === before ? remote : local).entries.filter(e => e.employee_id === id))
  }
  const holiday = local.is_holiday === base.is_holiday ? remote.is_holiday : local.is_holiday
  // A concurrent holiday toggle affects every assignment. Do not mix holiday interpretations.
  if (!!remote.is_holiday !== !!base.is_holiday && local.entries.some(e =>
    signature(e) !== signature(base.entries.find(b => b.employee_id === e.employee_id && b.shift_index === e.shift_index)))) throw conflict()
  const error = validateEntries(entries)
  if (error) throw new Error(error)
  return { revision: remote.revision, is_holiday: holiday, entries }
}
