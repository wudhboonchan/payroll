import test from 'node:test'
import assert from 'node:assert/strict'
import {isJobAvailable,entryRate,validateEntries,usage,wageTier} from '../../src/features/tpi/model.ts'
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
