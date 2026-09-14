import test from 'node:test'
import assert from 'node:assert/strict'
import {isJobAvailable,entryRate,validateEntries,usage,wageTier,calculateEntryOt,getShiftOtTimeRange,getJobBaseRate} from '../../src/features/tpi/model.ts'
import {referenceJobs} from '../../src/features/tpi/referenceJobs.ts'
const job={...referenceJobs[7],id:'job',quota:4,planned_morning:2,planned_afternoon:2,planned_night:0,skilled_rate:450}
const row=(employee_id,shift_index,job_id='job')=>({employee_id,shift_index,job_id})
test('source totals: 14 regular jobs / 40 forces and 11 temporary jobs / 73 forces; 4 clerk jobs have 377 skilled rate',()=>{
 assert.equal(referenceJobs.length,25)
 assert.equal(new Set(referenceJobs.map(j=>j.code)).size,25)
 assert.equal(referenceJobs.filter(j=>j.job_type==='regular').reduce((a,j)=>a+j.quota,0),40)
 assert.equal(referenceJobs.filter(j=>j.job_type==='temporary').reduce((a,j)=>a+j.quota,0),73)
 assert.equal(referenceJobs.filter(j=>j.job_group==='clerk').length,4)
 assert.equal(referenceJobs.filter(j=>j.job_group==='general').length,21)
 assert.ok(referenceJobs.every(j=>j.normal_rate===357))
 assert.ok(referenceJobs.filter(j=>j.job_group==='clerk').every(j=>j.skilled_rate===377))
})
test('actual 3 morning + 1 afternoon allowed for plan 2 + 2',()=>{
 const entries=[row('a',0),row('b',0),row('c',0),row('a',1)]
 assert.equal(validateEntries(entries),null)
 assert.deepEqual(usage(entries,'job'),{total:4,shifts:[3,1,0]})
})
test('third shift is rejected across all jobs; duplicate shift across jobs rejected',()=>{
 assert.ok(validateEntries([row('a',0),row('a',1),row('a',2,'other')]))
 assert.ok(validateEntries([row('a',0),row('a',0,'other')]))
 assert.equal(validateEntries([row('a',0),row('a',2,'other')]),null)
})
test('357 per shift, 714 for two shifts, skilled rate chosen by effective date',()=>{
 const profile={employee_id:'a',rate_tier:'skilled',skilled_from:'2026-09-06',job_id:'job'}
 assert.equal(entryRate(row('a',0),[job],[profile],'2026-09-05')+entryRate(row('a',1),[job],[profile],'2026-09-05'),714)
 assert.equal(entryRate(row('a',0),[job],[profile],'2026-09-06'),450)
 assert.equal(wageTier(profile,'2026-09-05'),'normal')
 assert.equal(entryRate({...row('a',0),rate_snapshot:357},[job],[profile],'2026-09-06'),357)
 assert.equal(entryRate(row('a',0),[{...job,skilled_rate:null}],[profile],'2026-09-06'),null)
})
test('clerk jobs (692021, 692032, 692041, 692050) pay skilled rate 377 for skilled clerk workers across rotation',()=>{
 const clerkJobs = referenceJobs.filter(j => ['692021', '692032', '692041', '692050'].includes(j.code))
 assert.equal(clerkJobs.length, 4)
 
 const skilledClerk = { employee_id: 'clerk-1', rate_tier: 'skilled', skilled_from: '2026-09-01' }
 const normalClerk = { employee_id: 'clerk-2', rate_tier: 'normal' }
 
 for (const cJob of clerkJobs) {
   // Skilled clerk receives 377 from DB on any rotated clerk job without single-job binding
   assert.equal(entryRate(row('clerk-1', 0, cJob.id), clerkJobs, [skilledClerk], '2026-09-08'), 377)
   // Half shift is 377 / 2 = 188.5
   assert.equal(entryRate({ ...row('clerk-1', 0, cJob.id), is_half_shift: true }, clerkJobs, [skilledClerk], '2026-09-08'), 188.5)
   // Normal clerk receives 357 on any rotated clerk job
   assert.equal(entryRate(row('clerk-2', 0, cJob.id), clerkJobs, [normalClerk], '2026-09-08'), 357)
 }
})
test('job active range includes expiration day and rejects inactive or future jobs',()=>{
 const temporary={...job,valid_from:'2026-09-01',expires_on:'2026-09-30'}
 assert.equal(isJobAvailable(temporary,'2026-09-30'),true)
 assert.equal(isJobAvailable(temporary,'2026-10-01'),false)
 assert.equal(isJobAvailable(temporary,'2026-08-31'),false)
 assert.equal(isJobAvailable({...temporary,active:false},'2026-09-01'),false)
})

test('all employees calculate OT at 1.5x hourly rate ceil to baht; clerks no longer 2x',()=>{
  // 357 / 8 * 1.5 = 66.9375 -> ceil(66.9375 * 1) = 67, ceil(66.9375 * 2) = 134
  const otWorker1h = calculateEntryOt(1, 357, false)
  assert.deepEqual(otWorker1h, { ot_hours: 1, ot_pay: 67 })
  const otWorker2h = calculateEntryOt(2, 357, false)
  assert.deepEqual(otWorker2h, { ot_hours: 2, ot_pay: 134 })

  // Clerks also calculate 1.5x now
  const otClerk1h = calculateEntryOt(1, 357, true)
  assert.deepEqual(otClerk1h, { ot_hours: 1, ot_pay: 67 })
  const otClerk2h = calculateEntryOt(2, 377, true)
  // 377 / 8 * 1.5 = 70.6875 -> ceil(70.6875 * 2) = 142
  assert.deepEqual(otClerk2h, { ot_hours: 2, ot_pay: 142 })
})

test('getShiftOtTimeRange computes exact pre-shift and post-shift time ranges',()=>{
  // Shift 0 (เช้า): 07:40 - 16:00
  assert.equal(getShiftOtTimeRange(0, 2, true), '05:40 — 07:40')
  assert.equal(getShiftOtTimeRange(0, 2, false), '16:00 — 18:00')

  // Shift 1 (บ่าย): 15:40 - 00:00
  assert.equal(getShiftOtTimeRange(1, 2, true), '13:40 — 15:40')
  assert.equal(getShiftOtTimeRange(1, 2, false), '00:00 — 02:00')

  // Shift 2 (ดึก): 23:40 - 08:00
  assert.equal(getShiftOtTimeRange(2, 2, true), '21:40 — 23:40')
  assert.equal(getShiftOtTimeRange(2, 2, false), '08:00 — 10:00')
})

test('validateEntries rejects 2 shifts + OT while permitting 2 shifts without OT and 1 shift with OT',()=>{
  // 1 shift + OT -> allowed
  assert.equal(validateEntries([{ employee_id: 'w1', job_id: 'job', shift_index: 0, ot_hours: 2 }]), null)

  // 2 shifts without OT -> allowed
  assert.equal(validateEntries([
    { employee_id: 'w1', job_id: 'job', shift_index: 0 },
    { employee_id: 'w1', job_id: 'job', shift_index: 1 }
  ]), null)

  // 2 shifts + OT on shift 1 -> rejected
  assert.match(validateEntries([
    { employee_id: 'w1', job_id: 'job', shift_index: 0, ot_hours: 2 },
    { employee_id: 'w1', job_id: 'job', shift_index: 1 }
  ]) || '', /ไม่สามารถทำ OT ได้/)

  // 2 shifts + OT on shift 2 -> rejected
  assert.match(validateEntries([
    { employee_id: 'w1', job_id: 'job', shift_index: 0 },
    { employee_id: 'w1', job_id: 'job', shift_index: 1, ot_hours: 1 }
  ]) || '', /ไม่สามารถทำ OT ได้/)
})

test('OT under a different job position calculates OT pay using that job position rate',()=>{
  // Main shift is regular job with rate 357
  const regularJob = { ...referenceJobs[0], id: 'job-main', normal_rate: 357, skilled_rate: null }
  // OT performed on a higher-paying job or clerk job with rate 377
  const otClerkJob = { ...referenceJobs[24], id: 'job-ot-clerk', normal_rate: 357, skilled_rate: 377, job_group: 'clerk' }
  const skilledProfile = { employee_id: 'w1', rate_tier: 'skilled', skilled_from: '2026-09-01' }

  const mainBaseRate = getJobBaseRate(regularJob, 'w1', [skilledProfile], '2026-09-13')
  assert.equal(mainBaseRate, 357)

  const otBaseRate = getJobBaseRate(otClerkJob, 'w1', [skilledProfile], '2026-09-13')
  assert.equal(otBaseRate, 377)

  // 4 hours OT on otClerkJob: (377 / 8 * 1.5) = 70.6875 -> ceil(70.6875 * 4) = ceil(282.75) = 283
  const otCalc = calculateEntryOt(4, otBaseRate)
  assert.deepEqual(otCalc, { ot_hours: 4, ot_pay: 283 })

  // Compare if calculated with mainBaseRate 357: ceil(357 / 8 * 1.5 * 4) = ceil(267.75) = 268
  const mainOtCalc = calculateEntryOt(4, mainBaseRate)
  assert.deepEqual(mainOtCalc, { ot_hours: 4, ot_pay: 268 })
  assert.notEqual(otCalc.ot_pay, mainOtCalc.ot_pay)
})

