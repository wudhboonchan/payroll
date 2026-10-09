import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculatePayroll } from '../../src/lib/payrollCalc.ts'

const page = readFileSync(new URL('../../src/pages/PayrollEntry.tsx', import.meta.url), 'utf8')

test('Tra Phet uses shift income once in both preview and save, ignoring saved extras', () => {
  assert.match(page, /amount_special: autoSp,/)
  assert.match(page, /amount_special: Math\.round\(autoSpecial \* 100\) \/ 100/)
  assert.match(page, /override_special: null/)
  assert.doesNotMatch(page, /extraEntries\.amount_(special|diligence|position)|savedSpecial|รายการรายได้เพิ่มเติม/)
  assert.match(page, /\[autoSp, Number\(entry\.amount_special\)\]/)
  assert.match(page, /\[0, Number\(entry\.override_special \|\| 0\)\]/)
})

test('four cross-position shifts at 300 produce 8350 income and 3954 net', () => {
  const input = {
    position: 'worker', rate_per_12h: 650, normal_days: 11,
    amount_special: [300, 300, 300, 300].reduce((sum, pay) => sum + pay, 0),
    amount_diligence: 0, amount_position: 0, override_special: null,
    social_security_rate: 0.05, deduct_advance: 4200,
  }
  for (let reload = 0; reload < 3; reload++) {
    const result = calculatePayroll(input)
    assert.equal(result.effective_special, 1200)
    assert.equal(result.total_income, 8350)
    assert.equal(result.deduct_social_security, 196)
    assert.equal(result.total_deductions, 4396)
    assert.equal(result.net_pay, 3954)
  }
})

test('no cross-position shifts add no special income; deductions remain included', () => {
  const result = calculatePayroll({
    rate_per_12h: 650, normal_days: 1, amount_special: 0,
    social_security_rate: 0.05, deduct_safety_equipment: 100, deduct_uniform: 50,
  })
  assert.equal(result.total_income, 650)
  assert.equal(result.total_deductions, 168)
  assert.equal(result.net_pay, 482)
})
