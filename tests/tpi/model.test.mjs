import test from 'node:test'
import assert from 'node:assert/strict'
import {isJobAvailable,entryRate,validateEntries,usage,wageTier} from '../../src/features/tpi/model.ts'
import {referenceJobs} from '../../src/features/tpi/referenceJobs.ts'
const job={...referenceJobs[7],id:'job',quota:4,planned_morning:2,planned_afternoon:2,planned_night:0,skilled_rate:450}
const row=(employee_id,shift_index,job_id='job')=>({employee_id,shift_index,job_id})
test('source totals: 14 regular jobs / 40 forces and 11 temporary jobs / 73 forces',()=>{
 assert.equal(referenceJobs.length,25)
 assert.equal(new Set(referenceJobs.map(j=>j.code)).size,25)
 assert.equal(referenceJobs.filter(j=>j.job_type==='regular').reduce((a,j)=>a+j.quota,0),40)
 assert.equal(referenceJobs.filter(j=>j.job_type==='temporary').reduce((a,j)=>a+j.quota,0),73)
 assert.ok(referenceJobs.every(j=>j.normal_rate===357&&j.skilled_rate===null))
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
 const profile={employee_id:'a',rate_tier:'skilled',skilled_from:'2026-09-06'}
 assert.equal(entryRate(row('a',0),[job],[profile],'2026-09-05')+entryRate(row('a',1),[job],[profile],'2026-09-05'),714)
 assert.equal(entryRate(row('a',0),[job],[profile],'2026-09-06'),450)
 assert.equal(wageTier(profile,'2026-09-05'),'normal')
 assert.equal(entryRate({...row('a',0),rate_snapshot:357},[job],[profile],'2026-09-06'),357)
 assert.equal(entryRate(row('a',0),[{...job,skilled_rate:null}],[profile],'2026-09-06'),null)
})
test('job active range includes expiration day and rejects inactive or future jobs',()=>{
 const temporary={...job,valid_from:'2026-09-01',expires_on:'2026-09-30'}
 assert.equal(isJobAvailable(temporary,'2026-09-30'),true)
 assert.equal(isJobAvailable(temporary,'2026-10-01'),false)
 assert.equal(isJobAvailable(temporary,'2026-08-31'),false)
 assert.equal(isJobAvailable({...temporary,active:false},'2026-09-01'),false)
})
