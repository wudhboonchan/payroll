import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeWageForm } from '../../src/features/tpi/employeeWageForm.ts'
const jobs = [{ id: 'raw-material', code: '692050' }, { id: 'temporary', code: 'P133/69' }]
for (const profile of [null, { rate_tier: 'normal' }]) {
  test(`legacy 692050 opens as skilled with ${profile ? 'normal' : 'missing'} profile`, () => {
    const result = employeeWageForm('692050', profile, jobs)
    assert.equal(result.rateTier, 'skilled')
    assert.equal(result.jobCode, '692050')
    assert.equal(result.jobId, 'raw-material')
    assert.equal(result.skilledFrom, '') // Do not invent an effective date.
  })
}
test('numeric legacy code is recognized before jobs load or after job is removed', () => {
  assert.equal(employeeWageForm(' 692050 ', null, []).rateTier, 'skilled')
})
test('known alphanumeric job code is recognized', () => {
  assert.equal(employeeWageForm('P133/69', null, jobs).rateTier, 'skilled')
})
test('ordinary title is not treated as skilled', () => {
  assert.equal(employeeWageForm('พนักงานทั่วไป', null, jobs).rateTier, 'normal')
})
test('saved normal employee reopens as normal after title and skilled fields are cleared', () => {
  assert.deepEqual(employeeWageForm(null, { rate_tier: 'normal', job_code: null, job_id: null, skilled_from: null }, jobs), {
    rateTier: 'normal', jobCode: '', jobId: '', skilledFrom: '',
  })
})
test('saved skilled profile retains assigned job and effective date', () => {
  assert.deepEqual(employeeWageForm(null, { rate_tier: 'skilled', job_code: '692050', job_id: 'raw-material', skilled_from: '2026-09-01' }, jobs), {
    rateTier: 'skilled', jobCode: '692050', jobId: 'raw-material', skilledFrom: '2026-09-01',
  })
})

test('unrestricted skilled date reopens as an empty optional field', () => {
  const result = employeeWageForm('692050', { rate_tier: 'skilled', skilled_from: '0001-01-01' }, jobs)
  assert.equal(result.skilledFrom, '')
  assert.equal(result.rateTier, 'skilled')
})
