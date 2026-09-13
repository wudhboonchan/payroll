import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTpiPayroll } from '../../src/features/tpi/payrollCalc.ts'

test('position allowance is permanently 0 even with has_position_allowance=true at end of month', () => {
  const emp = {
    id: 'emp-1',
    employee_code: 'TP001',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    nationality: 'ไทย',
    wage_type: 'daily',
    position: 'worker',
    has_position_allowance: true,
    is_safety_officer: true,
  }

  const periodEndOfMonth = {
    id: 'p-1',
    period_start: '2026-08-16',
    period_end: '2026-08-31',
  }

  const result = calculateTpiPayroll({
    employee: emp,
    shifts: [],
    advances: [],
    period: periodEndOfMonth,
  })

  // Position allowance must always be 0
  assert.equal(result.amountPosition, 0)
  // Safety allowance remains functional (+500 on end of month)
  assert.equal(result.amountSafetyOfficer, 500)
})

test('position allowance is 0 when extra amount_position is provided', () => {
  const emp = {
    id: 'emp-2',
    employee_code: 'TP002',
    first_name: 'สมศักดิ์',
    last_name: 'ขยัน',
    nationality: 'ไทย',
    wage_type: 'daily',
    position: 'clerk',
  }

  const period = {
    id: 'p-2',
    period_start: '2026-08-01',
    period_end: '2026-08-15',
  }

  const result = calculateTpiPayroll({
    employee: emp,
    shifts: [],
    advances: [],
    period,
    extras: {
      amount_position: 1000,
    },
  })

  assert.equal(result.amountPosition, 0)
})
