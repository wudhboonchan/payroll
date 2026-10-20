export interface LedgerShift {
  employee_id: string; work_date: string; shift_index: number; rate_snapshot: number
  non_billable?: boolean; is_pending?: boolean; is_holiday_ot?: boolean; ot_pay?: number
}
/** Compare wage cost on the same basis, before period overrides and deductions. */
export function wageCostSplit(shifts: LedgerShift[]) {
  let billable = 0, nonBillable = 0
  const nonBillableDays = new Set<string>()
  for (const s of shifts) {
    if (s.non_billable && s.is_pending) continue
    const cost = Number(s.rate_snapshot || 0) * (s.is_holiday_ot ? 2 : 1) + Number(s.ot_pay || 0)
    if (s.non_billable) { nonBillable += cost; nonBillableDays.add(s.work_date) }
    else billable += cost
  }
  return { billable, nonBillable, total: billable + nonBillable, nonBillableDays: nonBillableDays.size }
}
