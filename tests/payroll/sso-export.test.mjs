import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/lib/ssoExport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('require', 'exports', compiled)(() => ({}), module.exports)
const { buildSsoExportRows } = module.exports

test('includes Thai employees by default if not exempt', () => {
  const entries = [
    {
      employee_id: 'emp-thai-1',
      amount_normal: 10000,
      override_normal: null,
      deduct_social_security: 500,
      employee: {
        id: 'emp-thai-1',
        employee_code: 'TH01',
        national_id: '1100500123456',
        prefix: 'นาย',
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        nationality: 'ไทย',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['เลขบัตรประชาชน'], '1100500123456')
  assert.equal(rows[0]['คำนำหน้า'], 'นาย')
  assert.equal(rows[0]['ชื่อ'], 'สมชาย')
  assert.equal(rows[0]['สกุล'], 'ใจดี')
  assert.equal(rows[0]['ค่าจ้าง'], 10000)
  assert.equal(rows[0]['เงินสมทบ'], 500)
})

test('includes foreign employees who have SSO deducted', () => {
  const entries = [
    {
      employee_id: 'emp-foreign-1',
      amount_normal: 9000,
      override_normal: null,
      deduct_social_security: 450,
      employee: {
        id: 'emp-foreign-1',
        employee_code: 'MY01',
        national_id: '0012345678901',
        prefix: 'Mr.',
        first_name: 'Kyaw',
        last_name: 'Zayar',
        nationality: 'เมียนมา',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['เลขบัตรประชาชน'], '0012345678901')
  assert.equal(rows[0]['คำนำหน้า'], 'Mr.')
  assert.equal(rows[0]['ชื่อ'], 'Kyaw')
  assert.equal(rows[0]['สกุล'], 'Zayar')
  assert.equal(rows[0]['ค่าจ้าง'], 9000)
  assert.equal(rows[0]['เงินสมทบ'], 450)
})

test('uses social_security_number if national_id is empty for foreign worker', () => {
  const entries = [
    {
      employee_id: 'emp-foreign-legacy',
      amount_normal: 8000,
      override_normal: null,
      deduct_social_security: 400,
      employee: {
        id: 'emp-foreign-legacy',
        employee_code: 'MY02',
        national_id: null,
        social_security_number: '0098765432100',
        prefix: 'Ms.',
        first_name: 'Aye',
        last_name: '',
        nationality: 'เมียนมา',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['เลขบัตรประชาชน'], '0098765432100')
  assert.equal(rows[0]['ชื่อ'], 'Aye')
  assert.equal(rows[0]['สกุล'], '')
  assert.equal(rows[0]['เงินสมทบ'], 400)
})

test('excludes foreign employees who have NO SSO deducted', () => {
  const entries = [
    {
      employee_id: 'emp-foreign-no-sso',
      amount_normal: 9000,
      override_normal: null,
      deduct_social_security: 0,
      employee: {
        id: 'emp-foreign-no-sso',
        employee_code: 'MY03',
        national_id: '',
        prefix: 'Mr.',
        first_name: 'Zaw',
        last_name: 'Min',
        nationality: 'เมียนมา',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 0)
})

test('excludes Thai employees if exempt_social_security is true and 0 deduction', () => {
  const entries = [
    {
      employee_id: 'emp-thai-exempt',
      amount_normal: 15000,
      override_normal: null,
      deduct_social_security: 0,
      employee: {
        id: 'emp-thai-exempt',
        employee_code: 'TH99',
        national_id: '1234567890123',
        prefix: 'นางสาว',
        first_name: 'กานดา',
        last_name: 'มีสุข',
        nationality: 'ไทย',
        exempt_social_security: true,
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 0)
})

test('aggregates multiple periods for same employee properly', () => {
  const entries = [
    {
      employee_id: 'emp-1',
      amount_normal: 5000,
      override_normal: null,
      deduct_social_security: 250,
      employee: {
        id: 'emp-1',
        employee_code: 'MY05',
        national_id: '0011223344556',
        first_name: 'Aung',
        last_name: 'Naing',
        nationality: 'เมียนมา',
      },
    },
    {
      employee_id: 'emp-1',
      amount_normal: 6000,
      override_normal: null,
      deduct_social_security: 300,
      employee: {
        id: 'emp-1',
        employee_code: 'MY05',
        national_id: '0011223344556',
        first_name: 'Aung',
        last_name: 'Naing',
        nationality: 'เมียนมา',
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['ค่าจ้าง'], 11000)
  assert.equal(rows[0]['เงินสมทบ'], 550)
})

test('prefers override_normal over amount_normal when present', () => {
  const entries = [
    {
      employee_id: 'emp-2',
      amount_normal: 8000,
      override_normal: 9000,
      deduct_social_security: 450,
      employee: {
        id: 'emp-2',
        employee_code: 'TH02',
        national_id: '3333333333333',
        first_name: 'วิชัย',
        last_name: 'รุ่งเรือง',
        nationality: 'ไทย',
      },
    },
  ]

  const rows = buildSsoExportRows(entries)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['ค่าจ้าง'], 9000)
  assert.equal(rows[0]['เงินสมทบ'], 450)
})

test('Diamond factory (isTpi: false) strictly excludes foreign employees even if SSO is deducted', () => {
  const entries = [
    {
      employee_id: 'emp-thai-drt',
      amount_normal: 10000,
      override_normal: null,
      deduct_social_security: 500,
      employee: {
        id: 'emp-thai-drt',
        employee_code: 'TH-DRT',
        national_id: '1100500123456',
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        nationality: 'ไทย',
        exempt_social_security: false,
      },
    },
    {
      employee_id: 'emp-foreign-drt',
      amount_normal: 9000,
      override_normal: null,
      deduct_social_security: 450,
      employee: {
        id: 'emp-foreign-drt',
        employee_code: 'MY-DRT',
        national_id: '0012345678901',
        social_security_number: '0012345678901',
        first_name: 'Kyaw',
        last_name: 'Zayar',
        nationality: 'เมียนมา',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries, { isTpi: false })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['ชื่อ'], 'สมชาย')
  assert.equal(rows[0]['เงินสมทบ'], 500)
})

test('TPI factory (isTpi: true) includes foreign employees with SSO deducted', () => {
  const entries = [
    {
      employee_id: 'emp-foreign-tpi',
      amount_normal: 9000,
      override_normal: null,
      deduct_social_security: 450,
      employee: {
        id: 'emp-foreign-tpi',
        employee_code: 'MY-TPI',
        national_id: '0012345678901',
        first_name: 'Kyaw',
        last_name: 'Zayar',
        nationality: 'เมียนมา',
        exempt_social_security: false,
      },
    },
  ]

  const rows = buildSsoExportRows(entries, { isTpi: true })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['ชื่อ'], 'Kyaw')
  assert.equal(rows[0]['เงินสมทบ'], 450)
})
