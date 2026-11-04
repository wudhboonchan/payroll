import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeShiftDay } from '../../src/features/tpi/shiftConcurrency.ts'
const entry = (id, shift = 0, job = 'job') => ({ employee_id: id, shift_index: shift, job_id: job })
const day = (revision, entries) => ({ revision, entries, is_holiday: false })
test('stale revision merges changes for different employees without dropping either', () => {
  const result = mergeShiftDay(day(54, [entry('a')]), day(54, [entry('a'), entry('b')]), day(55, [entry('a'), entry('c')]))
  assert.equal(result.revision, 55)
  assert.deepEqual(result.entries.map(e => e.employee_id).sort(), ['a', 'b', 'c'])
})
test('concurrent move of same employee is rejected', () => {
  assert.throws(() => mergeShiftDay(day(54, [entry('a')]), day(54, [entry('a', 1)]), day(55, [entry('a', 2)])), /ข้อมูลวันนี้ถูกแก้ไขแล้ว/)
})
test('remote deletion is preserved while a different employee is added', () => {
  assert.deepEqual(mergeShiftDay(day(1, [entry('a')]), day(1, [entry('a'), entry('b')]), day(2, [])).entries, [entry('b')])
})
test('same edit is accepted and snapshot-only changes do not conflict', () => {
  assert.equal(mergeShiftDay(day(1, [entry('a')]), day(1, [entry('a', 1)]), day(2, [entry('a', 1)])).entries[0].shift_index, 1)
  assert.doesNotThrow(() => mergeShiftDay(day(1, [entry('a')]), day(1, [entry('a', 1)]), day(2, [{ ...entry('a'), rate_snapshot: 500 }])))
})
test('deleting versus editing the same employee is rejected', () => {
  assert.throws(() => mergeShiftDay(day(1, [entry('a')]), day(1, []), day(2, [entry('a', 1)])))
})
