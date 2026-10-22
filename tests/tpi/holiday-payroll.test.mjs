import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTpiPayroll } from '../../src/features/tpi/payrollCalc.ts'
import { calculateFactoryBilling } from '../../src/features/tpi/tpiBillingCalc.ts'
import { wageCostSplit } from '../../src/features/tpi/nonBillableLedger.ts'

const employee = { id: 'worker', employee_code: 'TEST', first_name: 'Test', last_name: '', nationality: 'ไทย', position: 'worker' }
const period = { id: 'period', period_start: '2026-10-01', period_end: '2026-10-15', social_security_rate: 0.05 }
const shift = (day, index = 0, changes = {}) => ({ id: `${day}-${index}`, employee_id: employee.id,
  work_date: `2026-10-${String(day).padStart(2, '0')}`, shift_index: index, job_id: 'job', job_code_snapshot: 'JOB',
  rate_snapshot: 357, rate_tier: 'normal', actual_hours: 8, is_half_shift: false, ot_hours: 0, ot_pay: 0, ...changes })
const calculate = (shifts, changes = {}) => calculateTpiPayroll({ employee, period, shifts, advances: [], ...changes })

// Same shift dates/counts/rates as the reported case, without personal information.
const reportedShifts = [1,2,3,5,6,7,8,9,10,12,13,14,15].flatMap(day =>
  (day === 3 ? [0] : [0,1]).map(index => shift(day, index, { is_holiday_ot: day === 13 })))

test('25 shifts including two holidays pay 8211 ordinary wages plus 1428 holiday OT', () => {
  const result = calculate(reportedShifts)
  assert.equal(result.normalShiftsCount, 23)
  assert.equal(result.holidayShiftsCount, 2)
  assert.equal(result.totalShiftsCount, 25)
  assert.equal(result.workDaysCount, 13)
  assert.equal(result.effectiveNormal, 4284)
  assert.equal(result.effectiveShift, 3927)
  assert.equal(result.totalBaseShiftWage, 8211)
  assert.equal(result.amountHolidayOt, 1428)
  assert.equal(result.totalIncome, 9639)
  assert.equal(result.deductSocialSecurity, 214)
  assert.equal(result.dailyAudit.reduce((sum, day) => sum + day.dayTotalWage + day.dayTotalOt, 0), result.totalIncome)
  assert.equal(calculateFactoryBilling(reportedShifts, [employee], [], 'test').totalWagePaid, result.totalIncome)
  assert.equal(wageCostSplit(reportedShifts).total, result.totalIncome)
})

test('holiday-only day contributes no ordinary wages or social security base, retains regular OT', () => {
  const result = calculate([shift(13, 0, { is_holiday_ot: true, ot_pay: 134, ot_hours: 2 })])
  assert.equal(result.effectiveNormal, 0)
  assert.equal(result.effectiveShift, 0)
  assert.equal(result.deductSocialSecurity, 0)
  assert.equal(result.amountHolidayOt, 714)
  assert.equal(result.regularOtPay, 134)
  assert.equal(result.totalIncome, 848)
  assert.equal(result.workDaysCount, 1)
})

test('holiday half shift uses prorated snapshot once at 2x, skilled and nonbillable rates supported', () => {
  for (const changes of [{ rate_snapshot: 178.5, is_half_shift: true, actual_hours: 4 },
    { rate_snapshot: 377, rate_tier: 'skilled' }, { non_billable: true, rate_snapshot: 500 }]) {
    const result = calculate([shift(13, 0, { is_holiday_ot: true, ...changes })])
    assert.equal(result.totalBaseShiftWage, 0)
    assert.equal(result.totalIncome, changes.rate_snapshot * 2)
  }
})

test('ordinary shifts and explicit overrides retain their behavior', () => {
  const ordinary = calculate([shift(1), shift(1, 1)])
  assert.equal(ordinary.effectiveNormal, 357)
  assert.equal(ordinary.effectiveShift, 357)
  assert.equal(ordinary.amountHolidayOt, 0)
  assert.equal(ordinary.totalIncome, 714)
  const overridden = calculate([shift(13, 0, { is_holiday_ot: true })], {
    overrides: { override_normal: 100, override_shift: 200, override_ot: 300 },
  })
  assert.equal(overridden.totalIncome, 600)
})
