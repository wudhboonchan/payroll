import test from 'node:test'
import assert from 'node:assert/strict'
import { entryRate, validateEntries } from '../../src/features/tpi/model.ts'
const job = { id: 'job', normal_rate: 357, skilled_rate: 377 }
const row = { employee_id: 'emp', job_id: 'job', shift_index: 0, is_half_shift: false }
test('all 1-7 deducted hours use rounded hourly deduction, full shift unchanged', () => {
  for (let hours = 1; hours <= 7; hours++) {
    assert.equal(entryRate({ ...row, actual_hours: 8-hours }, [job], [], '2026-10-07'), 357-45*hours)
  }
  assert.equal(entryRate({ ...row, actual_hours: 8 }, [job], [], '2026-10-07'), 357)
})
test('persisted net wage is used once, including legacy half shift', () => {
  assert.equal(entryRate({ ...row, actual_hours: 5, rate_snapshot: 222 }, [job], [], '2026-10-07'), 222)
  assert.equal(entryRate({ ...row, is_half_shift: true, rate_snapshot: 178.5 }, [job], [], '2026-10-07'), 178.5)
})
test('fractional, zero, negative and over-eight working hours are rejected', () => {
  for (const actual_hours of [0, -1, 8.5, 9, 3.5, NaN]) assert.ok(validateEntries([{ ...row, actual_hours }]))
  for (let actual_hours=1; actual_hours<=8; actual_hours++) assert.equal(validateEntries([{ ...row, actual_hours }]), null)
})

test('job validity errors identify code and date while allowing boundary dates', async () => {
  const { jobAvailabilityError } = await import('../../src/features/tpi/model.ts')
  const dated = { ...job, code: '690003', active: true, valid_from: '2026-09-01', expires_on: '2026-09-30' }
  assert.equal(jobAvailabilityError(dated, '2026-09-01'), null)
  assert.equal(jobAvailabilityError(dated, '2026-09-30'), null)
  assert.match(jobAvailabilityError(dated, '2026-10-07'), /690003.*2026-09-30.*2026-10-07/)
  assert.match(jobAvailabilityError(dated, '2026-08-31'), /เริ่มใช้/)
  assert.match(jobAvailabilityError({ ...dated, active: false }, '2026-09-15'), /ปิดใช้งาน/)
})
