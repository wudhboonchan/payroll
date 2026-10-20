import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTpiPayroll } from '../../src/features/tpi/payrollCalc.ts'
import { calculateFactoryBilling } from '../../src/features/tpi/tpiBillingCalc.ts'
import { calculateEmployeeTimesheetReport } from '../../src/features/tpi/tpiTimesheetCalc.ts'
import { buildTpiEmployeeSummaryExcelRows } from '../../src/features/tpi/tpiSummaryExport.ts'
import { wageCostSplit } from '../../src/features/tpi/nonBillableLedger.ts'
import { specialWorkError, entryRate, isTpiCompany } from '../../src/features/tpi/model.ts'

const employee = { id: 'e1', employee_code: 'T001', first_name: 'ทดสอบ', last_name: 'โฟร์แมน', nationality: 'ไทย', position: 'worker', wage_type: 'daily', exempt_social_security: false, national_id: '123', social_security_number: '123' }
const period = { id: 'p1', period_start: '2026-10-01', period_end: '2026-10-15', social_security_rate: 0.05 }
const shift = { id: 'entry1', employee_id: 'e1', work_date: '2026-10-01', shift_index: 0, job_id: 'nb1', job_code_snapshot: 'NB-FOREMAN', rate_tier: 'normal', rate_snapshot: 357, actual_hours: 8, is_half_shift: false, ot_hours: 0, ot_pay: 0, non_billable: true, non_billable_base_rate: 357, full_rate_snapshot: 357, position_snapshot: 'โฟร์แมน', cost_owner: 'หจก.', non_billable_reason: 'หจก.รับต้นทุนเอง' }
const calculate = shifts => calculateTpiPayroll({ employee, period, shifts, advances: [] })

test('ten morning shifts pay 3570, retain workdays and existing social security behavior', () => {
  const shifts = Array.from({ length: 10 }, (_, i) => ({ ...shift, work_date: `2026-10-${String(i+1).padStart(2,'0')}` }))
  const normal = calculate(shifts.map(s => ({ ...s, non_billable: false })))
  const special = calculate(shifts)
  assert.equal(special.workDaysCount, 10)
  assert.equal(special.baseNormalWage, 3570)
  assert.equal(special.deductSocialSecurity, normal.deductSocialSecurity)
  assert.equal(special.netPay, normal.netPay)
  assert.ok(special.deductSocialSecurity > 0)
})

test('both factory billing reports exclude special wages, people, hours and OT before aggregation', () => {
  const regular = { ...shift, id: 'entry2', employee_id: 'e2', non_billable: false, job_code_snapshot: '690001', job_id: 'regular' }
  const list = [{ ...shift, ot_hours: 2, ot_pay: 134, is_holiday_ot: true }, regular]
  const billing = calculateFactoryBilling(list, [employee], [], 'งวดทดสอบ')
  assert.equal(billing.totalWorkers, 1)
  assert.equal(billing.jobGroups.length, 1)
  assert.equal(billing.totalWagePaid, 357)
  assert.equal(billing.jobGroups[0].jobCode, '690001')
  const byPerson = calculateEmployeeTimesheetReport(list, [employee, { ...employee, id:'e2' }], period.period_start, '2026-10-07')
  assert.equal(byPerson.thaiWorkers.length, 1)
  assert.equal(byPerson.thaiWorkers[0].employeeId, 'e2')
})

test('same person can work billable and nonbillable jobs on different days', () => {
  const regular = { ...shift, non_billable: false, work_date: '2026-10-02', job_code_snapshot: '690001' }
  const result = wageCostSplit([shift, regular])
  assert.deepEqual(result, { billable: 357, nonBillable: 357, total: 714, nonBillableDays: 1 })
  assert.equal(calculateFactoryBilling([shift, regular], [employee], [], 'งวด').totalWagePaid, 357)
})

test('Excel splits wage cost, carries reason and stable record references', () => {
  const result = calculate([shift])
  const rows = buildTpiEmployeeSummaryExcelRows(employee, 'งวดทดสอบ', result, result.dailyAudit, [], false, new Map())
  const head = rows.find(row => row.includes('ค่าแรงไม่ตั้งเบิก') && row.includes('เลขรายการ'))
  assert.ok(head)
  const row = rows.find(row => row.includes('entry1'))
  assert.equal(row[head.indexOf('ค่าแรงไม่ตั้งเบิก')], 357)
  assert.equal(row[head.indexOf('ค่าแรงส่วนที่ตั้งเบิก')], 0)
  assert.equal(row[head.indexOf('เหตุผล')], 'หจก.รับต้นทุนเอง')
  assert.equal(row[head.indexOf('ตำแหน่ง')], 'โฟร์แมน')
  assert.equal(row[head.indexOf('เรทอ้างอิงก่อนแก้')], 357)
})

test('pending special shifts do not become wages before attendance confirmation', () => {
  assert.equal(calculate([{ ...shift, is_pending: true }]).workDaysCount, 0)
  assert.equal(wageCostSplit([{ ...shift, is_pending: true }]).total, 0)
  assert.equal(calculate([{ ...shift, is_pending: false }]).workDaysCount, 1)
})

test('morning-only is an explicit job option, does not restrict all foremen or normal jobs', () => {
  const job = { id: 'nb1', job_type: 'non_billable', morning_only: true }
  assert.equal(specialWorkError([shift], [job]), null)
  assert.ok(specialWorkError([{ ...shift, shift_index: 1 }], [job]))
  assert.ok(specialWorkError([shift, { ...shift, job_id: 'other', shift_index: 1 }], [job]))
  assert.ok(specialWorkError([{ ...shift, ot_hours: 1 }], [job]))
  assert.equal(specialWorkError([{ ...shift, shift_index: 1 }], [{ ...job, morning_only: false }]), null)
})

test('per-entry override preview uses hourly deduction exactly once', () => {
  assert.equal(entryRate({ ...shift, non_billable_rate: 380, actual_hours: 7 }, [], [], '2026-10-01'), 332)
  assert.ok(specialWorkError([{ ...shift, non_billable_rate: -1 }], []))
})

test('Diamond names stay excluded even when TPI occurs elsewhere in the name', () => {
  for (const name of ['ตราเพชร', 'Diamond', 'DRT', 'TPI / ตราเพชร', 'TPI Diamond']) assert.equal(isTpiCompany(name), false)
})
