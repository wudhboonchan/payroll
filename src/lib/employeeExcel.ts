import * as XLSX from 'xlsx'

// ─── Column definitions ────────────────────────────────────────────────────────

export const IMPORT_COLUMNS = [
  { key: 'employee_code',  header: 'รหัสพนักงาน*',         example: '001',           required: true,  note: 'ไม่ซ้ำกัน เช่น 001, EMP001' },
  { key: 'prefix',         header: 'คำนำหน้า',              example: 'นาย',           required: false, note: 'นาย / นาง / นางสาว (หรือเว้นว่าง)' },
  { key: 'first_name',     header: 'ชื่อ*',                 example: 'สมชาย',         required: true,  note: 'ชื่อจริง' },
  { key: 'last_name',      header: 'นามสกุล',               example: 'ใจดี',          required: false, note: 'บังคับสำหรับสัญชาติไทย' },
  { key: 'nationality',    header: 'สัญชาติ*',              example: 'ไทย',           required: true,  note: 'ไทย / เมียนมาร์ / กัมพูชา / ลาว' },
  { key: 'national_id',    header: 'เลขบัตร / Passport',    example: '1234567890123', required: false, note: 'เลขบัตรประชาชน 13 หลัก หรือ Passport' },
  { key: 'rate_per_12h',   header: 'ค่าแรง/วัน (บาท)*',    example: '320',           required: true,  note: 'ตัวเลขเท่านั้น เช่น 320' },
  { key: 'payment_method', header: 'วิธีรับเงิน*',          example: 'bank_transfer', required: true,  note: 'cash หรือ bank_transfer' },
  { key: 'bank_name',      header: 'ธนาคาร',               example: 'กสิกรไทย',     required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'bank_account',   header: 'เลขที่บัญชี',          example: '1234567890',    required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'status',         header: 'สถานะ',                example: 'active',        required: false, note: 'active (ค่าเริ่มต้น) / inactive' },
  { key: 'notes',          header: 'หมายเหตุ',             example: '',              required: false, note: 'ข้อมูลเพิ่มเติม (ไม่บังคับ)' },
] as const

// ─── Valid value lists (single source of truth for template + validator) ───────

export const VALID_NATIONALITIES   = ['ไทย', 'เมียนมาร์', 'กัมพูชา', 'ลาว']
export const VALID_PAYMENT_METHODS = ['cash', 'bank_transfer']
export const VALID_STATUSES        = ['active', 'inactive']
export const VALID_PREFIXES        = ['นาย', 'นาง', 'นางสาว']
export const VALID_BANKS           = [
  'กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย',
  'กรุงศรี', 'ทหารไทยธนชาต', 'ออมสิน', 'อื่นๆ',
]

// ─── Column indices (0-based, must match IMPORT_COLUMNS order) ────────────────
const COL_IDX = {
  employee_code: 0,
  prefix: 1,
  first_name: 2,
  last_name: 3,
  nationality: 4,
  national_id: 5,
  rate_per_12h: 6,
  payment_method: 7,
  bank_name: 8,
  bank_account: 9,
  status: 10,
  notes: 11,
}

function colLetter(idx: number) { return String.fromCharCode(65 + idx) }

// Data rows start at row 7 (1-based): title / instruction / header / ref-row / ex1 / ex2 / ex3
const DATA_ROW_START = 7
function sqref(colIdx: number) {
  const c = colLetter(colIdx)
  return `${c}${DATA_ROW_START}:${c}1000`
}

// ─── Download template ─────────────────────────────────────────────────────────

export function downloadEmployeeTemplate() {
  const wb = XLSX.utils.book_new()
  const REF_SHEET = 'ค่าอ้างอิง'

  // ── Sheet 1: "ค่าอ้างอิง" — lookup lists used by Excel data validation ──────
  const refLists = [
    { title: 'สัญชาติ',      values: VALID_NATIONALITIES },
    { title: 'วิธีรับเงิน',  values: VALID_PAYMENT_METHODS },
    { title: 'สถานะ',        values: VALID_STATUSES },
    { title: 'คำนำหน้า',    values: VALID_PREFIXES },
    { title: 'ธนาคาร',      values: VALID_BANKS },
  ]
  const maxRows = Math.max(...refLists.map(l => l.values.length))
  const refMatrix: string[][] = [refLists.map(l => l.title)]
  for (let r = 0; r < maxRows; r++) {
    refMatrix.push(refLists.map(l => l.values[r] ?? ''))
  }
  const wsRef = XLSX.utils.aoa_to_sheet(refMatrix)
  wsRef['!cols'] = refLists.map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, wsRef, REF_SHEET)

  // Helper to build sheet-qualified named range for data validation
  function refRange(refColIdx: number, count: number) {
    const c = colLetter(refColIdx)
    return `'${REF_SHEET}'!$${c}$2:$${c}$${count + 1}`
  }

  // ── Sheet 2: "พนักงาน" — the import template ──────────────────────────────
  const ncols = IMPORT_COLUMNS.length

  // "ค่าที่ยอมรับ" reference row — copy-pasteable valid values per column
  const refRow = [
    '(เช่น 001, EMP001)',
    VALID_PREFIXES.join(' / '),
    '(ชื่อจริง)',
    '(นามสกุล — บังคับสำหรับไทย)',
    VALID_NATIONALITIES.join(' / '),
    '(เลขบัตร 13 หลัก หรือ Passport)',
    '(ตัวเลข เช่น 320)',
    VALID_PAYMENT_METHODS.join(' / '),
    VALID_BANKS.slice(0, 4).join(' / ') + ' ...',
    '(เลขบัญชี 10-12 หลัก)',
    VALID_STATUSES.join(' / '),
    '(ไม่บังคับ)',
  ]

  const wsData: any[][] = [
    // Row 1 — Title
    ['แบบฟอร์มนำเข้าข้อมูลพนักงาน — ห้างหุ้นส่วนจำกัด วิราญกร', ...Array(ncols - 1).fill('')],
    // Row 2 — Instruction
    ['⚠️  กรอกข้อมูลตั้งแต่แถวที่ 7 เป็นต้นไป  |  คอลัมน์ที่มี * = บังคับกรอก  |  ห้ามลบหรือเปลี่ยนชื่อ Header', ...Array(ncols - 1).fill('')],
    // Row 3 — Column headers
    IMPORT_COLUMNS.map(c => c.header),
    // Row 4 — Reference / valid values row (copy-paste helper)
    ['▶ ค่าที่ยอมรับ / ตัวอย่าง:', ...refRow.slice(1)],
    // Row 5 — Example 1: Thai, bank transfer
    ['001', 'นาย', 'สมชาย', 'ใจดี', 'ไทย', '1234567890123', '320', 'bank_transfer', 'กสิกรไทย', '1234567890', 'active', ''],
    // Row 6 — Example 2: Thai, cash
    ['002', 'นาง', 'สมหญิง', 'รักดี', 'ไทย', '9876543210987', '340', 'cash', '', '', 'active', ''],
    // Row 7+ — Data entry starts here (data validation active)
  ]

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  ws['!cols'] = [
    { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 26 },
    { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 18 },
    { wch: 16 }, { wch: 24 },
  ]

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
  ]

  // ── Excel native dropdown validation ─────────────────────────────────────
  ;(ws as any)['!dataValidations'] = [
    {
      sqref: sqref(COL_IDX.nationality),
      type: 'list',
      formula1: refRange(0, VALID_NATIONALITIES.length),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: `กรุณาเลือกสัญชาติ: ${VALID_NATIONALITIES.join(', ')}`,
      errorTitle: 'สัญชาติไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'สัญชาติ',
      prompt: VALID_NATIONALITIES.join(' / '),
    },
    {
      sqref: sqref(COL_IDX.payment_method),
      type: 'list',
      formula1: refRange(1, VALID_PAYMENT_METHODS.length),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: `ใช้: ${VALID_PAYMENT_METHODS.join(' หรือ ')}`,
      errorTitle: 'วิธีรับเงินไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'วิธีรับเงิน',
      prompt: 'cash = เงินสด  |  bank_transfer = โอนบัญชี',
    },
    {
      sqref: sqref(COL_IDX.bank_name),
      type: 'list',
      formula1: refRange(4, VALID_BANKS.length),
      showDropDown: false,
      showErrorMessage: false,
      errorStyle: 'warning',
      showInputMessage: true,
      promptTitle: 'ธนาคาร',
      prompt: VALID_BANKS.join(', '),
    },
    {
      sqref: sqref(COL_IDX.status),
      type: 'list',
      formula1: refRange(2, VALID_STATUSES.length),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: `ใช้: ${VALID_STATUSES.join(' หรือ ')}`,
      errorTitle: 'สถานะไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'สถานะ',
      prompt: 'active = พนักงานปัจจุบัน  |  inactive = พ้นสภาพ',
    },
    {
      sqref: sqref(COL_IDX.prefix),
      type: 'list',
      formula1: refRange(3, VALID_PREFIXES.length),
      showDropDown: false,
      showErrorMessage: false,
      errorStyle: 'warning',
      showInputMessage: true,
      promptTitle: 'คำนำหน้า',
      prompt: VALID_PREFIXES.join(' / ') + ' (หรือเว้นว่าง)',
    },
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'พนักงาน')

  // ── Sheet 3: "คู่มือ" — human-readable guide ──────────────────────────────
  const guideData: any[][] = [
    ['คำอธิบาย Column', 'บังคับ?', 'ค่าที่ยอมรับ / หมายเหตุ'],
    ...IMPORT_COLUMNS.map(c => [
      c.header.replace('*', '').trim(),
      c.required ? '✅ บังคับ' : '—',
      c.note,
    ]),
    ['', '', ''],
    ['ค่าที่ยอมรับ — สัญชาติ',     '', VALID_NATIONALITIES.join(', ')],
    ['ค่าที่ยอมรับ — วิธีรับเงิน', '', VALID_PAYMENT_METHODS.join(', ')],
    ['ค่าที่ยอมรับ — สถานะ',       '', VALID_STATUSES.join(', ')],
    ['ค่าที่ยอมรับ — ธนาคาร',     '', VALID_BANKS.join(', ')],
    ['ค่าที่ยอมรับ — คำนำหน้า',   '', VALID_PREFIXES.join(', ')],
  ]
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, wsGuide, 'คู่มือ')

  XLSX.writeFile(wb, 'employee_import_template.xlsx')
}

// ─── Parse uploaded file ───────────────────────────────────────────────────────

export interface ParsedRow {
  rowNum: number
  data: Record<string, string>
  errors: string[]
}

export function parseEmployeeExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]

        // If first sheet is the reference sheet, use second sheet
        const sheetName = wb.SheetNames.find(n => n === 'พนักงาน') ?? wb.SheetNames[0]
        const targetWs = wb.Sheets[sheetName]

        const rows: any[][] = XLSX.utils.sheet_to_json(targetWs, { header: 1, defval: '' })

        // Find the header row — contains "รหัสพนักงาน"
        const headerRowIdx = rows.findIndex(row =>
          row.some((cell: any) => String(cell).includes('รหัสพนักงาน'))
        )
        if (headerRowIdx === -1) {
          reject(new Error('ไม่พบ Column Header "รหัสพนักงาน*" — กรุณาใช้ Template ที่ดาวน์โหลดมา'))
          return
        }

        const headerRow = rows[headerRowIdx].map((h: any) => String(h).trim())

        // Skip rows until we hit actual data (skip the "ค่าที่ยอมรับ" row and example rows)
        // Detect: example rows have employee_code that's just digits and first_name in Thai
        // Simpler approach: skip rows where employee_code is one of the known examples
        const EXAMPLE_CODES = new Set(['001', '002', '003'])

        // Map header → column key
        const colKeyMap: Record<string, string> = {}
        IMPORT_COLUMNS.forEach(col => {
          const idx = headerRow.findIndex(h =>
            h.replace('*', '').trim() === col.header.replace('*', '').trim()
          )
          if (idx !== -1) colKeyMap[idx] = col.key
        })

        const empCodeColIdx = Number(
          Object.entries(colKeyMap).find(([, v]) => v === 'employee_code')?.[0] ?? -1
        )

        const parsed: ParsedRow[] = []
        const dataRows = rows.slice(headerRowIdx + 1)

        dataRows.forEach((row, i) => {
          // Skip empty rows
          if (row.every((cell: any) => String(cell).trim() === '')) return

          // Skip the reference row (starts with "▶")
          if (String(row[0]).startsWith('▶')) return

          // Skip example rows by employee_code
          const rawCode = String(row[empCodeColIdx] ?? '').trim()
          if (EXAMPLE_CODES.has(rawCode)) return

          const data: Record<string, string> = {}
          Object.entries(colKeyMap).forEach(([idxStr, key]) => {
            data[key] = String(row[parseInt(idxStr)] ?? '').trim()
          })

          // Defaults
          if (!data.nationality)    data.nationality = 'ไทย'
          if (!data.status)         data.status = 'active'
          if (!data.payment_method) data.payment_method = 'bank_transfer'

          // Validation
          const errors: string[] = []
          if (!data.employee_code) errors.push('รหัสพนักงานว่าง')
          if (!data.first_name)    errors.push('ชื่อว่าง')
          if (!data.rate_per_12h || isNaN(Number(data.rate_per_12h)))
            errors.push('ค่าแรงต้องเป็นตัวเลข')
          if (data.nationality === 'ไทย' && !data.last_name)
            errors.push('สัญชาติไทยต้องกรอกนามสกุล')
          if (data.payment_method === 'bank_transfer' && !data.bank_account)
            errors.push('โอนบัญชีต้องกรอกเลขบัญชี')
          if (!VALID_NATIONALITIES.includes(data.nationality))
            errors.push(`สัญชาติ "${data.nationality}" ไม่รู้จัก`)
          if (!VALID_PAYMENT_METHODS.includes(data.payment_method))
            errors.push(`วิธีรับเงิน "${data.payment_method}" ไม่รู้จัก`)

          parsed.push({ rowNum: headerRowIdx + i + 2, data, errors })
        })

        resolve(parsed)
      } catch (err: any) {
        reject(new Error('ไม่สามารถอ่านไฟล์ได้: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}
