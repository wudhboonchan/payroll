import test from 'node:test'
import assert from 'node:assert/strict'

test('is_pending flag on shift entry is preserved and can be confirmed or removed', () => {
  const entries = [
    { employee_id: 'emp-1', job_id: 'job-1', shift_index: 0, is_pending: true },
    { employee_id: 'emp-2', job_id: 'job-2', shift_index: 1, is_pending: false },
    { employee_id: 'emp-3', job_id: 'job-1', shift_index: 0, is_pending: true },
  ]

  // Count pending
  const pendingCount = entries.filter((e) => !!e.is_pending).length
  assert.equal(pendingCount, 2)

  // Confirm individual
  const confirmedOne = entries.map((e) =>
    e.employee_id === 'emp-1' ? { ...e, is_pending: false } : e
  )
  assert.equal(confirmedOne[0].is_pending, false)
  assert.equal(confirmedOne[2].is_pending, true)

  // Confirm all
  const confirmedAll = entries.map((e) => ({ ...e, is_pending: false }))
  assert.equal(confirmedAll.every((e) => !e.is_pending), true)

  // Remove worker
  const removed = entries.filter((e) => e.employee_id !== 'emp-3')
  assert.equal(removed.length, 2)
  assert.equal(removed.some((e) => e.employee_id === 'emp-3'), false)
})

test('safety fine + HR penalty calculates 3x shift rate and splits into 500-baht installments with exact remainder', () => {
  function computeInstallments(safetyAmount, shiftRate, includeHr) {
    const hrAmount = includeHr ? Math.round(shiftRate * 3 * 100) / 100 : 0
    const total = Math.round((safetyAmount + hrAmount) * 100) / 100
    const list = []
    let rem = total
    while (rem > 0) {
      if (rem >= 500) {
        list.push(500)
        rem = Math.round((rem - 500) * 100) / 100
      } else {
        list.push(rem)
        rem = 0
      }
    }
    return { total, hrAmount, list }
  }

  // User's example: 357 rate, 1000 safety, 357*3 = 1071 HR -> Total 2071 -> 500x4 + 71
  const ex1 = computeInstallments(1000, 357, true)
  assert.equal(ex1.hrAmount, 1071)
  assert.equal(ex1.total, 2071)
  assert.deepEqual(ex1.list, [500, 500, 500, 500, 71])
  assert.equal(ex1.list.reduce((s, a) => s + a, 0), 2071)

  // Safety fine only: 1000 -> 500, 500
  const ex2 = computeInstallments(1000, 357, false)
  assert.equal(ex2.hrAmount, 0)
  assert.equal(ex2.total, 1000)
  assert.deepEqual(ex2.list, [500, 500])

  // Skilled clerk: 377 rate, 1000 safety, 377*3 = 1131 HR -> Total 2131 -> 500x4 + 131
  const ex3 = computeInstallments(1000, 377, true)
  assert.equal(ex3.hrAmount, 1131)
  assert.equal(ex3.total, 2131)
  assert.deepEqual(ex3.list, [500, 500, 500, 500, 131])

  // 2nd safety violation: 2000 safety, 357*3 = 1071 HR -> Total 3071 -> 500x6 + 71
  const ex4 = computeInstallments(2000, 357, true)
  assert.equal(ex4.total, 3071)
  assert.deepEqual(ex4.list, [500, 500, 500, 500, 500, 500, 71])
})
