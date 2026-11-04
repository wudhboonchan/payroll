import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { calculatePayroll } from '../../src/lib/payrollCalc.ts'

// Exercise the actual approval checker with database responses, without network or auth.
const source = readFileSync(new URL('../../src/lib/periodApprovalCheck.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export async function checkPeriodApprovalStatus', 'async function checkPeriodApprovalStatus')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  .outputText.replace(/export \{\};?/, '')
const period = { id: 'period', period_start: '2026-10-01', period_end: '2026-10-15', social_security_rate: 0.05 }

async function check({ nationality = 'เมียนมา', exempt = false, ss = 0, entryChanges = {}, missing = false, actualHours = null } = {}) {
  const data = {
    employees: [{ id: 'employee', employee_code: '2001', first_name: 'Test', last_name: '',
      nationality, exempt_social_security: exempt, national_id: 'registered', social_security_number: 'registered',
      data_complete: true, position: 'worker', wage_type: 'daily', rate_per_12h: 537 }],
    advance_payments: [],
    payroll_entries: missing ? [] : [{ employee_id: 'employee', amount_normal: actualHours === -1 ? 0 : 357,
      amount_shift: actualHours === -1 ? 0 : 180, amount_ot: 0, amount_wood_excess: 0, amount_film: 0,
      amount_special: 0, amount_diligence: 0, amount_position: 0, deduct_advance: 0, deduct_social_security: ss, ...entryChanges }],
    shift_assignments: [{ employee_id: 'employee', work_date: '2026-10-01', actual_hours: actualHours }],
  }
  const supabase = { from(table) {
    const query = { then(resolve) { resolve({ data: data[table], error: null }) } }
    for (const method of ['select', 'eq', 'limit']) query[method] = () => query
    query.range = (from, to) => Promise.resolve({ data: data[table].slice(from, to + 1), error: null })
    return query
  } }
  const checker = new Function('supabase', 'calculatePayroll', 'calculateTpiPayroll', `${js}; return checkPeriodApprovalStatus`)(
    supabase, calculatePayroll, () => { throw new Error('Unexpected TPI calculation') })
  return checker('factory', period, false)
}

test('registered foreign employee remains saved under Tra Phet policy', async () => {
  const result = await check()
  assert.equal(result.canApprove, true)
  assert.equal(result.outdatedCount, 0)
  assert.equal(result.savedCount, 1)
})

test('Thai social security still blocks approval when missing and reports the difference', async () => {
  const result = await check({ nationality: 'ไทย' })
  assert.equal(result.canApprove, false)
  assert.match(result.outdatedEmployees[0].reasons[0], /ประกันสังคม: คำนวณ 18 บาท \/ บันทึก 0 บาท/)
  assert.equal((await check({ nationality: 'ไทย', ss: 18 })).canApprove, true)
  assert.equal((await check({ nationality: null, ss: 18 })).canApprove, true)
  assert.equal((await check({ nationality: 'ไทย', exempt: true })).canApprove, true)
})

test('real wage changes and legacy extras still block approval', async () => {
  for (const entryChanges of [{ amount_normal: 300 }, { amount_shift: 100 }, { amount_special: 100 },
    { override_special: 100 }, { amount_diligence: 300 }, { amount_position: 100 }]) {
    const result = await check({ entryChanges })
    assert.equal(result.canApprove, false)
    assert.equal(result.outdatedCount, 1)
    assert.equal(result.outdatedEmployees[0].reasons.length, 1)
  }
})

test('missing entries block approval; unpaid foreign shifts do not create false differences', async () => {
  const result = await check({ missing: true })
  assert.equal(result.canApprove, false)
  assert.equal(result.unsavedCount, 1)
  assert.equal((await check({ actualHours: -1 })).canApprove, true)
})

async function checkTpi({ employeeChanges = {}, entryChanges = {}, missing = false, noShifts = false, holiday = false } = {}) {
  const { calculateTpiPayroll } = await import('../../src/features/tpi/payrollCalc.ts')
  const employee = { id: 'tpi-worker', employee_code: 'TP001', first_name: 'Test', last_name: '',
    nationality: 'เมียนมา', national_id: 'registered', data_complete: true, position: 'worker', ...employeeChanges }
  const shifts = [{ id: 'shift', employee_id: employee.id, work_date: '2026-10-01', shift_index: 1,
    rate_snapshot: 650, rate_tier: 'normal', is_half_shift: false, actual_hours: 8, ot_hours: 2,
    ot_pay: 100, is_holiday_ot: holiday }]
  const result = calculateTpiPayroll({ employee, shifts, advances: [{ amount: 200 }], period })
  const data = {
    employees: [employee], advance_payments: [{ employee_id: employee.id, amount: 200 }],
    tpi_shift_entries: noShifts ? [] : shifts,
    tpi_shift_days: [{ work_date: '2026-10-01', is_holiday: holiday }],
    payroll_entries: missing ? [] : [{ employee_id: employee.id, amount_normal: result.effectiveNormal,
      amount_shift: result.effectiveShift, amount_ot: result.totalOtPay, deduct_advance: result.deductAdvance,
      deduct_social_security: result.deductSocialSecurity, amount_position: result.amountPosition,
      amount_special: result.amountSpecial, amount_diligence: result.amountDiligence, ...entryChanges }],
  }
  const supabase = { from(table) {
    const query = { then(resolve) { resolve({ data: data[table], error: null }) } }
    for (const method of ['select', 'eq', 'limit', 'gte', 'lte']) query[method] = () => query
    query.range = (from, to) => Promise.resolve({ data: data[table].slice(from, to + 1), error: null })
    return query
  } }
  const checker = new Function('supabase', 'calculatePayroll', 'calculateTpiPayroll', `${js}; return checkPeriodApprovalStatus`)(
    supabase, () => { throw new Error('TPI must not use Tra Phet calculation') }, calculateTpiPayroll)
  return { status: await checker('tpi-factory', period, true), calculated: result }
}

test('TPI still deducts social security from registered foreign workers and blocks missing deductions', async () => {
  const { status, calculated } = await checkTpi()
  assert.ok(calculated.deductSocialSecurity > 0)
  assert.equal(status.canApprove, true)
  assert.equal((await checkTpi({ entryChanges: { deduct_social_security: 0 } })).status.outdatedCount, 1)
})

test('TPI retains Thai, incomplete foreign, and exempt employee social security rules', async () => {
  for (const [employeeChanges, eligible] of [
    [{ nationality: 'ไทย' }, true],
    [{ data_complete: false }, false],
    [{ national_id: null, social_security_number: null }, false],
    [{ exempt_social_security: true }, false],
  ]) {
    const { status, calculated } = await checkTpi({ employeeChanges })
    assert.equal(calculated.deductSocialSecurity > 0, eligible)
    assert.equal(status.canApprove, true)
  }
})

test('TPI approval still validates holidays, advances, wages, unsaved and orphan entries', async () => {
  assert.equal((await checkTpi({ holiday: true })).status.canApprove, true)
  for (const entryChanges of [{ amount_normal: 1 }, { amount_ot: 1 }, { deduct_advance: 0 }]) {
    assert.equal((await checkTpi({ entryChanges })).status.outdatedCount, 1)
  }
  assert.equal((await checkTpi({ missing: true })).status.unsavedCount, 1)
  const orphan = (await checkTpi({ noShifts: true })).status
  assert.equal(orphan.canApprove, false)
  assert.equal(orphan.outdatedCount, 1)
})
