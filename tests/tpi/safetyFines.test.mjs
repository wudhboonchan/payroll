import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateFineInstallments,
  parseThaiDateToIso,
  formatIsoToThaiDate,
  groupSafetyAdvancesToIncidents,
  formatSafetyFineNote,
} from '../../src/features/tpi/safetyFines.ts'

test('calculateFineInstallments splits into 500-baht increments with exact final remainder', () => {
  assert.deepEqual(calculateFineInstallments(1000), [500, 500])
  assert.deepEqual(calculateFineInstallments(2071), [500, 500, 500, 500, 71])
  assert.deepEqual(calculateFineInstallments(2131), [500, 500, 500, 500, 131])
  assert.deepEqual(calculateFineInstallments(350), [350])
  assert.deepEqual(calculateFineInstallments(0), [])
})

test('parseThaiDateToIso and formatIsoToThaiDate converts accurately between Buddhist and CE', () => {
  assert.equal(parseThaiDateToIso('16/08/2569'), '2026-08-16')
  assert.equal(formatIsoToThaiDate('2026-08-16'), '16/08/2569')
})

test('groupSafetyAdvancesToIncidents groups 5 installment rows into 1 single incident with correct fields', () => {
  const legacyRows = [
    {
      id: 'row-5',
      employee_id: 'emp-1',
      period_id: 'p-5',
      amount: 131,
      notes: 'หักค่าปรับผิดระเบียบ (วันที่ 16/08/2569 [5/5]) | สาเหตุ: แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต | ยอดปรับเต็ม ฿2,131 (จป. ฿1,000 + HR ฿1,131 [฿377×3]) (งวดที่ 5/5 = ฿131)',
      created_at: '2026-09-13T10:00:00Z',
    },
    {
      id: 'row-4',
      employee_id: 'emp-1',
      period_id: 'p-4',
      amount: 500,
      notes: 'หักค่าปรับผิดระเบียบ (วันที่ 16/08/2569 [4/5]) | สาเหตุ: แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต | ยอดปรับเต็ม ฿2,131 (จป. ฿1,000 + HR ฿1,131 [฿377×3]) (งวดที่ 4/5 = ฿500)',
      created_at: '2026-09-13T10:00:00Z',
    },
    {
      id: 'row-3',
      employee_id: 'emp-1',
      period_id: 'p-3',
      amount: 500,
      notes: 'หักค่าปรับผิดระเบียบ (วันที่ 16/08/2569 [3/5]) | สาเหตุ: แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต | ยอดปรับเต็ม ฿2,131 (จป. ฿1,000 + HR ฿1,131 [฿377×3]) (งวดที่ 3/5 = ฿500)',
      created_at: '2026-09-13T10:00:00Z',
    },
    {
      id: 'row-2',
      employee_id: 'emp-1',
      period_id: 'p-2',
      amount: 500,
      notes: 'หักค่าปรับผิดระเบียบ (วันที่ 16/08/2569 [2/5]) | สาเหตุ: แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต | ยอดปรับเต็ม ฿2,131 (จป. ฿1,000 + HR ฿1,131 [฿377×3]) (งวดที่ 2/5 = ฿500)',
      created_at: '2026-09-13T10:00:00Z',
    },
    {
      id: 'row-1',
      employee_id: 'emp-1',
      period_id: 'p-1',
      amount: 500,
      notes: 'หักค่าปรับผิดระเบียบ (วันที่ 16/08/2569 [1/5]) | สาเหตุ: แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต | ยอดปรับเต็ม ฿2,131 (จป. ฿1,000 + HR ฿1,131 [฿377×3]) (งวดที่ 1/5 = ฿500)',
      created_at: '2026-09-13T10:00:00Z',
    },
  ]

  const incidents = groupSafetyAdvancesToIncidents(legacyRows, 'p-1')
  assert.equal(incidents.length, 1, 'Should group 5 rows into 1 incident')

  const inc = incidents[0]
  assert.equal(inc.employeeId, 'emp-1')
  assert.equal(inc.thDateStr, '16/08/2569')
  assert.equal(inc.incidentDate, '2026-08-16')
  assert.equal(inc.reason, 'แอบใช้โทรศัพท์มือถือในพื้นที่ผลิต')
  assert.equal(inc.safetyAmount, 1000)
  assert.equal(inc.includeHr, true)
  assert.equal(inc.shiftRate, 377)
  assert.equal(inc.hrAmount, 1131)
  assert.equal(inc.totalAmount, 2131)
  assert.equal(inc.installments.length, 5)
  assert.equal(inc.rowIds.length, 5)

  // Test sorting of steps
  assert.equal(inc.installments[0].step, 1)
  assert.equal(inc.installments[0].isCurrent, true)
  assert.equal(inc.installments[4].step, 5)
  assert.equal(inc.installments[4].amount, 131)
})
