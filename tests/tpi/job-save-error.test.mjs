import test from 'node:test'
import assert from 'node:assert/strict'
import { jobSaveErrorMessage } from '../../src/features/tpi/jobSaveError.ts'

test('missing column never claims the existing table is missing', () => {
  const result = jobSaveErrorMessage({ code: 'PGRST204', message: "Could not find the 'cost_owner' column of 'tpi_job_codes' in the schema cache" })
  assert.match(result, /ติดตั้งการปรับปรุงฐานข้อมูล/)
  assert.doesNotMatch(result, /ยังไม่พบตาราง/)
})
test('missing table and ordinary save failures retain distinct explanations', () => {
  assert.match(jobSaveErrorMessage({ code: 'PGRST205' }), /ยังไม่พบตาราง/)
  assert.match(jobSaveErrorMessage({ code: '23505', message: 'duplicate key' }), /duplicate key/)
})
