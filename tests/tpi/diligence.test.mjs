import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDiligence } from '../../src/features/tpi/diligence.ts'
test('saved automatic 300 becomes zero after attendance without inventing an override', () => {
  assert.deepEqual(resolveDiligence(0, { amount_diligence: 300, override_reason: null }), { amount: 0, override: null })
})
test('deleting attendance restores automatic entitlement even if zero was previously saved', () => {
  assert.deepEqual(resolveDiligence(300, { amount_diligence: 0, override_reason: null }), { amount: 300, override: null })
})
test('only explicit diligence override survives a change in eligibility', () => {
  assert.deepEqual(resolveDiligence(0, { override_reason: 'ค่า จป.: ฿500, เบี้ยขยัน: ฿300' }), { amount: 300, override: 300 })
  assert.deepEqual(resolveDiligence(300, { override_reason: 'เบี้ยขยัน: ฿0' }), { amount: 0, override: 0 })
  assert.deepEqual(resolveDiligence(0, { override_reason: 'ค่ากะ: ฿300' }), { amount: 0, override: null })
})

test('diligence override requires a nonblank reason and preserves it on reload', async () => {
  const { formatDiligenceOverride, diligenceOverrideReason } = await import('../../src/features/tpi/diligence.ts')
  for (const reason of ['', '   ', '\n\t']) assert.throws(() => formatDiligenceOverride(300, reason), /กรุณาระบุเหตุผล/)
  const reason = 'ตรวจสอบเอกสารแล้ว, อนุมัติตามหนังสือ\nเลขที่ 123'
  const override_reason = `ค่า จป.: ฿500, ${formatDiligenceOverride(300, reason)}`
  assert.equal(diligenceOverrideReason({ override_reason }), reason)
  assert.deepEqual(resolveDiligence(0, { override_reason }), { amount: 300, override: 300 })
  assert.equal(diligenceOverrideReason({ override_reason: 'เบี้ยขยัน: ฿300' }), '')
})
