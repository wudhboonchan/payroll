import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTpiPayroll, isEndOfMonthPeriod, isForeignEmployee } from '../../src/features/tpi/payrollCalc.ts'

test('isForeignEmployee identifies Thai vs foreign employees correctly', () => {
  assert.equal(isForeignEmployee({ nationality: 'ไทย' }), false)
  assert.equal(isForeignEmployee({ nationality: null }), false)
  assert.equal(isForeignEmployee({ nationality: '' }), false)
  assert.equal(isForeignEmployee({ nationality: '  ' }), false)
  assert.equal(isForeignEmployee(null), false)
  assert.equal(isForeignEmployee(undefined), false)

  assert.equal(isForeignEmployee({ nationality: 'เมียนมา' }), true)
  assert.equal(isForeignEmployee({ nationality: 'พม่า' }), true)
  assert.equal(isForeignEmployee({ nationality: 'กัมพูชา' }), true)
  assert.equal(isForeignEmployee({ nationality: 'ลาว' }), true)
})

test('isEndOfMonthPeriod accurately identifies end of month periods', () => {
  assert.equal(isEndOfMonthPeriod('2026-08-31'), true)
  assert.equal(isEndOfMonthPeriod('2026-09-30'), true)
  assert.equal(isEndOfMonthPeriod('2026-02-28'), true)
  assert.equal(isEndOfMonthPeriod('2026-08-25'), true)

  assert.equal(isEndOfMonthPeriod('2026-08-15'), false)
  assert.equal(isEndOfMonthPeriod('2026-09-10'), false)
})

test('TPI end of month: normal condition pays 300 THB to all eligible employees', () => {
  const periodEndMonth = {
    id: 'p-end',
    period_start: '2026-08-16',
    period_end: '2026-08-31',
    waive_foreign_diligence: false,
  }

  const thaiEmp = {
    id: 'emp-thai',
    employee_code: 'TP001',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    nationality: 'ไทย',
  }

  const foreignEmp = {
    id: 'emp-foreign',
    employee_code: 'TP002',
    first_name: 'จอห์น',
    last_name: 'อู',
    nationality: 'เมียนมา',
  }

  const thaiResult = calculateTpiPayroll({
    employee: thaiEmp,
    shifts: [],
    advances: [],
    period: periodEndMonth,
  })
  assert.equal(thaiResult.amountDiligence, 300)
  assert.equal(thaiResult.isForeignDiligenceWaived, false)

  const foreignResult = calculateTpiPayroll({
    employee: foreignEmp,
    shifts: [],
    advances: [],
    period: periodEndMonth,
  })
  assert.equal(foreignResult.amountDiligence, 300)
  assert.equal(foreignResult.isForeignDiligenceWaived, false)
})

test('TPI end of month: when waive_foreign_diligence is TRUE, foreign workers get 0 THB while Thai workers still get 300 THB', () => {
  const periodEndMonth = {
    id: 'p-end',
    period_start: '2026-08-16',
    period_end: '2026-08-31',
    waive_foreign_diligence: true,
  }

  const thaiEmp = {
    id: 'emp-thai',
    employee_code: 'TP001',
    first_name: 'สมศรี',
    last_name: 'รักงาน',
    nationality: 'ไทย',
  }

  const foreignEmp1 = {
    id: 'emp-foreign-1',
    employee_code: 'TP002',
    first_name: 'อ่อง',
    last_name: 'วิน',
    nationality: 'เมียนมา',
  }

  const foreignEmp2 = {
    id: 'emp-foreign-2',
    employee_code: 'TP003',
    first_name: 'โซ',
    last_name: 'หน่าย',
    nationality: 'พม่า',
  }

  const thaiResult = calculateTpiPayroll({
    employee: thaiEmp,
    shifts: [],
    advances: [],
    period: periodEndMonth,
  })
  // Thai worker receives normal diligence
  assert.equal(thaiResult.amountDiligence, 300)
  assert.equal(thaiResult.isForeignDiligenceWaived, false)

  const foreignResult1 = calculateTpiPayroll({
    employee: foreignEmp1,
    shifts: [],
    advances: [],
    period: periodEndMonth,
  })
  // Foreign worker receives 0 THB diligence
  assert.equal(foreignResult1.amountDiligence, 0)
  assert.equal(foreignResult1.isForeignDiligenceWaived, true)

  const foreignResult2 = calculateTpiPayroll({
    employee: foreignEmp2,
    shifts: [],
    advances: [],
    period: periodEndMonth,
  })
  // Another foreign worker also receives 0 THB diligence
  assert.equal(foreignResult2.amountDiligence, 0)
  assert.equal(foreignResult2.isForeignDiligenceWaived, true)
})

test('TPI mid-month (not end of month): diligence is always 0 THB regardless of waive flag', () => {
  const periodMidMonth = {
    id: 'p-mid',
    period_start: '2026-08-01',
    period_end: '2026-08-15',
    waive_foreign_diligence: true,
  }

  const thaiEmp = { id: 'emp-1', employee_code: 'TP001', first_name: 'สมชาย', last_name: 'ใจดี', nationality: 'ไทย' }
  const foreignEmp = { id: 'emp-2', employee_code: 'TP002', first_name: 'มิน', last_name: 'ซู', nationality: 'เมียนมา' }

  const thaiResult = calculateTpiPayroll({ employee: thaiEmp, shifts: [], advances: [], period: periodMidMonth })
  const foreignResult = calculateTpiPayroll({ employee: foreignEmp, shifts: [], advances: [], period: periodMidMonth })

  assert.equal(thaiResult.amountDiligence, 0)
  assert.equal(foreignResult.amountDiligence, 0)
  assert.equal(thaiResult.isEndOfMonth, false)
})
