import { Pencil } from 'lucide-react'
import type { Entry, Job } from './model'
export function NonBillableRates({ entries, job, employeeNames, resolveRate, onChange }: { entries: Entry[]; job: Job; employeeNames: Map<string, string>; resolveRate: (entry: Entry) => number; onChange: (entry: Entry) => void }) {
  if (entries.length === 0) return null
  return <div className="tpi-non-billable-panel">{entries.map(e => <details key={`${e.employee_id}-${e.shift_index}`}>
    <summary><Pencil size={12} aria-hidden="true" />ค่าแรงกะ {e.shift_index + 1} · {employeeNames.get(e.employee_id) || e.employee_id}</summary>
    <label>ค่าแรงเต็มกะ (บาท)<input className="vk-input" type="number" min="0" step="0.01" value={e.non_billable_rate ?? e.full_rate_snapshot ?? resolveRate(e)} onChange={ev => onChange({ ...e, non_billable_rate: ev.target.value === '' ? null : Number(ev.target.value) })} /></label>
    <label>เหตุผล<input className="vk-input" value={e.non_billable_reason ?? job.non_billable_reason ?? ''} onChange={ev => onChange({ ...e, non_billable_reason: ev.target.value })} /></label>
  </details>)}</div>
}
