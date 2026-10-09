import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../../src/pages/EmployeeSummary.tsx', import.meta.url), 'utf8')
const start = page.indexOf('    const workedDaysList = dailyEstimates.filter')
const end = page.indexOf('\n  }, [dailyEstimates, empEntry, empAdvances, clerkPeriodBase])', start)
const summarize = new Function('dailyEstimates', 'empEntry', 'empAdvances', 'clerkPeriodBase', page.slice(start, end))
const shifts = Array.from({ length: 11 }, (_, i) => ({
  isWorked: true, shiftType: 'morning', baseWage: 357, shiftAllowance: 293,
  otPay: 0, woodExcess: 0, filmAmount: 0, crossPay: i < 4 ? 300 : 0,
}))

for (const savedSpecial of [1200, 2400]) {
  test(`summary ignores legacy saved special ${savedSpecial} and duplicate override`, () => {
    const stats = summarize(shifts, {
      amount_special: savedSpecial, override_special: 1200,
      amount_diligence: 300, amount_position: 500,
      deduct_social_security: 196,
    }, [{ amount: 4200 }], 0)
    assert.equal(stats.grossEarnings, 8350)
    assert.equal(stats.totalSpecialAllowances, 1200)
    assert.equal(stats.totalDeductions, 4396)
    assert.equal(stats.netEarnings, 3954)
  })
}

test('summary includes equipment and uniform deductions and works before payroll is saved', () => {
  assert.equal(summarize(shifts, null, [], 0).grossEarnings, 8350)
  const stats = summarize(shifts, { deduct_social_security: 196, deduct_safety_equipment: 100, deduct_uniform: 50 }, [{ amount: 4200 }], 0)
  assert.equal(stats.netEarnings, 3804)
  assert.doesNotMatch(page, /stats\.entry(?:Special|Position|Diligence)/)
})
