import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as XLSX from 'xlsx'

const source = readFileSync(new URL('../../src/lib/advanceExcel.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('require', 'exports', compiled)(() => XLSX, module.exports)
const { advanceRoundKey, parseAdvanceWorkbook, createAdvanceTemplate, ADVANCE_HEADERS } = module.exports
const employees = [{ id: 'emp-1', employee_code: '001', first_name: 'สมชาย', last_name: 'ใจดี' }]
function workbook(rows, headers = ADVANCE_HEADERS) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'เบิก')
  return book
}

test('template round trip preserves code zeroes and optional notes', () => {
  const book = createAdvanceTemplate()
  XLSX.utils.sheet_add_aoa(book.Sheets[book.SheetNames[0]], [['001', '', 1234.5]], { origin: 'A2' })
  const result = parseAdvanceWorkbook(XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })), employees)
  assert.equal(result.length, 1)
  assert.equal(result[0].code, '001')
  assert.equal(result[0].employee.id, 'emp-1')
  assert.equal(result[0].amount, 1234.5)
  assert.equal(result[0].notes, '')
  assert.deepEqual(result[0].errors, [])
})
test('matches by headers, accepts thousands, and preserves physical row numbers', () => {
  const result = parseAdvanceWorkbook(workbook([[], ['1,234.50', 'เหตุผล', '001', 'Y']], ['ยอดเงิน', 'หมายเหตุ', 'รหัสพนักงาน', 'ครั้งที่ 2']), employees)
  assert.equal(result[0].rowNumber, 3)
  assert.equal(result[0].amount, 1234.5)
  assert.deepEqual(result[0].errors, [])
})
test('rejects invalid money and unknown codes', () => {
  for (const value of ['', 0, -1, 'NaN', '1e3', '12บาท', '1,2', 1.234, Infinity]) {
    assert.ok(parseAdvanceWorkbook(workbook([['001', '', value]]), employees)[0].errors.length, String(value))
  }
  assert.ok(parseAdvanceWorkbook(workbook([['unknown', '', 10]]), employees)[0].errors.length)
})
test('blocks duplicate rounds even when amount and notes change', () => {
  const result = parseAdvanceWorkbook(workbook([['001', '', 10], ['001', 'เปลี่ยนยอด', 20, 'N'], ['001', '', 10, 'Yes']]), employees)
  assert.ok(result[0].errors.length)
  assert.ok(result[1].errors.length)
  assert.deepEqual(result[2].errors, [])
})
test('same amount and notes are allowed across two rounds in one file', () => {
  const result = parseAdvanceWorkbook(workbook([['001', '', 10, ''], ['001', '', 10, 'YES']]), employees)
  assert.deepEqual(result.map(row => row.advanceNumber), [1, 2])
  assert.ok(result.every(row => !row.errors.length))
})
test('round flag accepts case and surrounding whitespace, rejects typos', () => {
  for (const value of ['Yes', 'YES', 'Y', 'y', ' yes ']) {
    const [row] = parseAdvanceWorkbook(workbook([['001', '', 10, value]]), employees)
    assert.equal(row.advanceNumber, 2)
    assert.deepEqual(row.errors, [])
  }
  for (const value of ['', 'No', 'NO', 'n', ' N ']) {
    const [row] = parseAdvanceWorkbook(workbook([['001', '', 10, value]]), employees)
    assert.equal(row.advanceNumber, 1)
    assert.deepEqual(row.errors, [])
  }
  for (const value of ['yse', '2', 'true', 'ใช่']) assert.ok(parseAdvanceWorkbook(workbook([['001', '', 10, value]]), employees)[0].errors.length)
})
test('mixed rounds per employee and duplicate second rounds', () => {
  const otherEmployee = { ...employees[0], id: 'emp-2', employee_code: '002' }
  const mixed = parseAdvanceWorkbook(workbook([['001', '', 10, ''], ['002', '', 10, 'Y']]), [...employees, otherEmployee])
  assert.deepEqual(mixed.map(row => row.advanceNumber), [1, 2])
  assert.ok(mixed.every(row => !row.errors.length))
  const repeated = parseAdvanceWorkbook(workbook([['001', '', 10, 'Yes'], ['001', 'different', 20, 'Y']]), employees)
  assert.ok(repeated.every(row => row.errors.length))
  assert.notEqual(advanceRoundKey('emp-1', 1), advanceRoundKey('emp-1', 2))
})
test('rejects formulas, reserved deduction notes, ambiguous employee codes, and wrong headers', () => {
  const book = workbook([['001', '', 10]])
  book.Sheets['เบิก'].C2.f = '5+5'
  assert.ok(parseAdvanceWorkbook(book, employees)[0].errors.length)
  assert.ok(parseAdvanceWorkbook(workbook([['001', 'หักทำผิดวินัย', 10]]), employees)[0].errors.length)
  assert.ok(parseAdvanceWorkbook(workbook([['001', '', 10]]), [...employees, { ...employees[0], id: 'other' }])[0].errors.length)
  assert.throws(() => parseAdvanceWorkbook(workbook([], ['รหัส', 'หมายเหตุ', 'ยอดเงิน']), employees))
  assert.throws(() => parseAdvanceWorkbook(createAdvanceTemplate(), employees), /ไม่พบข้อมูล/)
})
