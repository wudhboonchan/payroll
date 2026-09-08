import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

// Exercise the modal's actual save callback against a database-shaped mock.
const source = readFileSync(new URL('../../src/pages/EmployeeFormModal.tsx', import.meta.url), 'utf8')
const callback = source.slice(source.indexOf('mutationFn: async (') + 'mutationFn: '.length, source.indexOf('\n    onSuccess:'))
  .trim().replace(/,$/, '')
const js = stripTypeScriptTypes(`const save = ${callback}`)

function setup(tier, profileError = null, skilledFrom = '2026-09-07') {
  const writes = []
  const cache = []
  const supabase = { from(table) {
    return {
      update(payload) { writes.push({ table, payload }); return this },
      eq() { return Promise.resolve({ error: null }) },
      upsert(payload, options) {
        assert.equal(options.onConflict, 'employee_id')
        writes.push({ table, payload: { ...payload } })
        return this
      },
      select() { return this },
      single() {
        const payload = writes.at(-1).payload
        const error = typeof profileError === 'function' ? profileError(payload) : profileError
        return Promise.resolve({ data: error ? null : { ...payload }, error })
      },
    }
  } }
  const save = new Function('supabase', 'queryClient', 'user', 'employeeId', 'isTpi', 'tpiRateTier', 'tpiJobCode', 'tpiJobId', 'tpiSkilledFrom', 'normalizePrefix', `${js}; return save`)(
    supabase, { setQueryData: (...args) => cache.push(args) }, { factory_id: 'factory' }, 'employee', true,
    tier, '692021', 'job-id', skilledFrom, value => value,
  )
  return { save, writes, cache }
}
const values = { prefix: 'นาย', first_name: 'Test', nationality: 'ไทย', job_title: '692021', payment_method: 'cash' }
test('skilled save persists tier and job and refreshes the cache used when reopening', async () => {
  const { save, writes, cache } = setup('skilled')
  await save({ values, deleteShifts: false })
  assert.equal(writes[0].payload.job_title, '692021')
  assert.equal(writes[1].payload.rate_tier, 'skilled')
  assert.equal(writes[1].payload.job_id, 'job-id')
  assert.equal(cache[0][1].rate_tier, 'skilled')
})
test('normal save clears stale title and all skilled profile fields', async () => {
  const { save, writes } = setup('normal')
  await save({ values, deleteShifts: false })
  assert.equal(writes[0].payload.job_title, null)
  for (const field of ['job_id', 'job_code', 'skilled_from']) assert.equal(writes[1].payload[field], null)
  assert.equal(writes[1].payload.rate_tier, 'normal')
})
test('profile failure rejects save instead of reporting success or caching unsaved data', async () => {
  const error = new Error('database rejected profile')
  const { save, cache } = setup('skilled', error)
  await assert.rejects(save({ values, deleteShifts: false }), error)
  assert.equal(cache.length, 0)
})

for (const missing of [['job_code'], ['job_id'], ['job_code', 'job_id']]) {
  for (const tier of ['skilled', 'normal']) {
    test(`${tier} save supports database without ${missing.join(', ')}`, async () => {
      const { save, writes, cache } = setup(tier, payload => {
        const column = missing.find(key => Object.hasOwn(payload, key))
        return column ? { code: 'PGRST204', message: `Could not find the '${column}' column of 'tpi_employee_wage_profiles' in the schema cache` } : null
      })
      await save({ values, deleteShifts: false })
      assert.equal(writes.length, 2 + missing.length)
      assert.equal(writes[0].payload.job_title, tier === 'skilled' ? '692021' : null)
      assert.equal(cache[0][1].rate_tier, tier)
      assert.equal(cache[0][1].skilled_from, tier === 'skilled' ? '2026-09-07' : null)
      for (const column of missing) assert.equal(Object.hasOwn(cache[0][1], column), false)
      for (const column of ['job_id', 'job_code'].filter(key => !missing.includes(key))) {
        assert.equal(cache[0][1][column], tier === 'skilled' ? (column === 'job_id' ? 'job-id' : '692021') : null)
      }
    })
  }
}
test('missing required column is not silently discarded', async () => {
  const error = { code: 'PGRST204', message: "Could not find the 'rate_tier' column" }
  const { save, writes, cache } = setup('skilled', error)
  await assert.rejects(save({ values, deleteShifts: false }), err => err === error)
  assert.equal(writes.length, 2)
  assert.equal(cache.length, 0)
})

test('blank skilled date saves using a valid unrestricted date for the legacy database', async () => {
  const { save, writes } = setup('skilled', null, '')
  await save({ values, deleteShifts: false })
  assert.equal(writes[1].payload.skilled_from, '0001-01-01')
})
