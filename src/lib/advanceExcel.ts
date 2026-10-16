import * as XLSX from 'xlsx'

export interface AdvanceEmployee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
}

export interface AdvanceImportRow {
  rowNumber: number
  code: string
  employee?: AdvanceEmployee
  amount: number
  notes: string
  advanceNumber: 1 | 2
  errors: string[]
}

export const ADVANCE_HEADERS = ['รหัสพนักงาน', 'หมายเหตุ', 'ยอดเงิน', 'ครั้งที่ 2']

export function advanceRoundKey(employeeId: string, advanceNumber: number) {
  return JSON.stringify([employeeId, advanceNumber])
}

export function createAdvanceTemplate() {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([ADVANCE_HEADERS])
  sheet['!cols'] = [{ wch: 22 }, { wch: 45 }, { wch: 20 }, { wch: 18 }]
  // Text cells preserve employee codes with leading zeroes when entered in Excel.
  for (let row = 2; row <= 1001; row++) sheet[`A${row}`] = { t: 's', v: '', z: '@' }
  sheet['!ref'] = 'A1:D1001'
  XLSX.utils.book_append_sheet(workbook, sheet, 'เบิกล่วงหน้า')
  return workbook
}

export function parseAdvanceWorkbook(workbook: XLSX.WorkBook, employees: AdvanceEmployee[]): AdvanceImportRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('ไม่พบแผ่นงานในไฟล์')
  const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true })
  const headers = (cells[0] || []).map(value => String(value).trim())
  if (headers.length !== 4 || ADVANCE_HEADERS.some(header => headers.filter(h => h === header).length !== 1)) {
    throw new Error('หัวตารางต้องมี รหัสพนักงาน หมายเหตุ ยอดเงิน และครั้งที่ 2 กรุณาใช้ Template ใหม่')
  }
  const indexes = ADVANCE_HEADERS.map(header => headers.indexOf(header))
  const employeeMap = new Map<string, AdvanceEmployee[]>()
  for (const employee of employees) {
    const code = employee.employee_code.trim()
    employeeMap.set(code, [...(employeeMap.get(code) || []), employee])
  }
  const rows: AdvanceImportRow[] = []
  const seen = new Map<string, AdvanceImportRow>()
  for (let index = 1; index < cells.length; index++) {
    const values = cells[index]
    if (values.every(value => String(value).trim() === '')) continue
    const codeCell = sheet[XLSX.utils.encode_cell({ r: index, c: indexes[0] })]
    const code = (codeCell ? XLSX.utils.format_cell(codeCell) : '').trim()
    const notes = String(values[indexes[1]] ?? '').trim()
    const rawAmount = values[indexes[2]]
    const amountText = String(rawAmount ?? '').trim()
    const numericText = amountText.replace(/,/g, '')
    const amount = Number(numericText)
    const errors: string[] = []
    const secondRound = String(values[indexes[3]] ?? '').trim().toLowerCase()
    const advanceNumber: 1 | 2 = ['yes', 'y'].includes(secondRound) ? 2 : 1
    if (!['', 'no', 'n', 'yes', 'y'].includes(secondRound)) errors.push('ครั้งที่ 2 ต้องเป็น Yes / Y หรือเว้นว่าง / No / N สำหรับครั้งที่ 1')
    const matches = employeeMap.get(code) || []
    if (!code) errors.push('กรุณากรอกรหัสพนักงาน')
    else if (matches.length !== 1) errors.push(matches.length ? 'รหัสพนักงานซ้ำในฐานข้อมูล' : 'ไม่พบพนักงานที่ใช้งานอยู่ในบริษัทนี้')
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      errors.push('ยอดเงินต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง')
    }
    if (indexes.some(column => sheet[XLSX.utils.encode_cell({ r: index, c: column })]?.f)) errors.push('กรุณาใช้ค่าโดยตรงแทนสูตร Excel')
    // These strings change deduction categories elsewhere in the payroll system.
    if (/สแกนหน้าไม่สำเร็จ|หักทำผิดวินัย|หักผิดวินัย|ค่าปรับผิดระเบียบ|หักค่าปรับ จป\.|ลงโทษ ขาดงาน|ลงโทษ ขาด\/ลา\/มาสาย/.test(notes)) errors.push('หมายเหตุมีคำที่สงวนไว้สำหรับรายการหักพิเศษ')
    const row = { rowNumber: index + 1, code, employee: matches.length === 1 ? matches[0] : undefined, amount, notes, advanceNumber, errors }
    const key = advanceRoundKey(code, advanceNumber)
    const previous = seen.get(key)
    if (previous) {
      row.errors.push(`เบิกครั้งที่ ${advanceNumber} ซ้ำกับแถว ${previous.rowNumber}`)
      if (!previous.errors.includes('รายการซ้ำในไฟล์')) previous.errors.push('รายการซ้ำในไฟล์')
    } else seen.set(key, row)
    rows.push(row)
  }
  if (!rows.length) throw new Error('ไม่พบข้อมูล กรุณากรอกข้อมูลตั้งแต่แถวที่ 2')
  if (rows.length > 5000) throw new Error('นำเข้าได้ครั้งละไม่เกิน 5,000 รายการ')
  return rows
}

export async function parseAdvanceExcel(file: File, employees: AdvanceEmployee[]) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('กรุณาเลือกไฟล์ .xlsx หรือ .xls')
  if (file.size > 10 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 10 MB')
  return parseAdvanceWorkbook(XLSX.read(await file.arrayBuffer(), { type: 'array' }), employees)
}
