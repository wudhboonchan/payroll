import * as XLSX from 'xlsx'

// ─── Column definitions ────────────────────────────────────────────────────────

export const IMPORT_COLUMNS_TPI = [
  { key: 'employee_code',          header: 'รหัสพนักงาน*',          example: '1267',          required: true,  note: 'รหัสพนักงานไม่ซ้ำกัน เช่น 001, 1267' },
  { key: 'prefix',                 header: 'คำนำหน้า',               example: 'นาย',           required: false, note: 'นาย / นาง / นางสาว / Mr. / Ms. / Mrs.' },
  { key: 'first_name',             header: 'ชื่อ*',                  example: 'สมชาย',         required: true,  note: 'ชื่อจริง' },
  { key: 'last_name',              header: 'นามสกุล',                example: 'ใจดี',          required: false, note: 'บังคับสำหรับสัญชาติไทย (ต่างชาติเว้นว่างได้)' },
  { key: 'nationality',            header: 'สัญชาติ*',               example: 'ไทย',           required: true,  note: 'ไทย / เมียนมา / กัมพูชา / ลาว' },
  { key: 'national_id',            header: 'เลขบัตร / เลข ปกส',     example: '1234567890123', required: false, note: 'คนไทย: เลขบัตร 13 หลัก / ต่างชาติ: เลข ปกส เมื่อได้รับแล้ว' },
  { key: 'position',               header: 'กลุ่มงาน*',              example: 'worker',        required: true,  note: 'worker (ทั่วไป) / clerk (เสมียน)' },
  { key: 'job_title',              header: 'ตำแหน่งงาน',             example: 'ช่างเครื่อง',   required: false, note: 'เช่น หัวหน้าช่าง, พนักงานขับรถ, ช่างเชื่อม' },
  { key: 'rate_tier',              header: 'ประเภทค่าแรง*',          example: 'ปกติ',          required: true,  note: 'ปกติ / ฝีมือ (คิดค่าแรงอัตโนมัติตามรหัสงาน)' },
  { key: 'payment_method',         header: 'วิธีรับเงิน*',           example: 'bank_transfer', required: true,  note: 'bank_transfer (โอนบัญชี) / cash (เงินสด)' },
  { key: 'bank_name',              header: 'ธนาคาร',                example: 'กสิกรไทย',     required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'bank_account',           header: 'เลขที่บัญชี',           example: '1234567890',    required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'status',                 header: 'สถานะ',                 example: 'active',        required: false, note: 'active (ปกติ) / inactive (พ้นสภาพ)' },
  { key: 'is_safety_officer',      header: 'เจ้าหน้าที่ จป.',        example: 'ไม่ใช่',        required: false, note: 'ใช่ / ไม่ใช่ (+500 บาท/เดือน)' },
  { key: 'has_position_allowance', header: 'ค่าตำแหน่ง',            example: 'ไม่ใช่',        required: false, note: 'ใช่ / ไม่ใช่ (+1,000 บาท/เดือน)' },
  { key: 'exempt_social_security', header: 'ยกเว้น ปกส',            example: 'ไม่ใช่',        required: false, note: 'ใช่ / ไม่ใช่ (สำหรับคนไทยที่ได้รับการยกเว้น)' },
  { key: 'data_complete',          header: 'ข้อมูลสมบูรณ์',          example: 'ใช่',           required: false, note: 'ใช่ / ไม่ใช่ (ยืนยันข้อมูลพร้อมหัก ปกส)' },
  { key: 'notes',                  header: 'หมายเหตุ',              example: '',              required: false, note: 'ข้อมูลเพิ่มเติม (ไม่บังคับ)' },
] as const

export const IMPORT_COLUMNS_DIAMOND = [
  { key: 'employee_code',          header: 'รหัสพนักงาน*',         example: '001',           required: true,  note: 'ไม่ซ้ำกัน เช่น 001, EMP001' },
  { key: 'prefix',                 header: 'คำนำหน้า',              example: 'นาย',           required: false, note: 'นาย / นาง / นางสาว (หรือเว้นว่าง)' },
  { key: 'first_name',             header: 'ชื่อ*',                 example: 'สมชาย',         required: true,  note: 'ชื่อจริง' },
  { key: 'last_name',              header: 'นามสกุล',               example: 'ใจดี',          required: false, note: 'บังคับสำหรับสัญชาติไทย' },
  { key: 'nationality',            header: 'สัญชาติ*',              example: 'ไทย',           required: true,  note: 'ไทย / เมียนมา / กัมพูชา / ลาว' },
  { key: 'national_id',            header: 'เลขบัตร / เลข ปกส',    example: '1234567890123', required: false, note: 'เลขบัตรประชาชน 13 หลัก (คนไทย) หรือเลข ปกส (ต่างชาติ)' },
  { key: 'position',               header: 'ตำแหน่ง*',              example: 'worker',        required: true,  note: 'worker (ทั่วไป) / clerk (เสมียน)' },
  { key: 'job_title',              header: 'ตำแหน่งงาน',            example: 'พนักงานขับรถ',  required: false, note: 'เช่น หัวหน้าช่าง, พนักงานขับรถ, ช่างเชื่อม' },
  { key: 'rate_per_12h',           header: 'ค่าแรง/วัน (บาท)*',    example: '320',           required: true,  note: 'ตัวเลขเท่านั้น เช่น 320' },
  { key: 'payment_method',         header: 'วิธีรับเงิน*',          example: 'bank_transfer', required: true,  note: 'cash หรือ bank_transfer' },
  { key: 'bank_name',              header: 'ธนาคาร',               example: 'กสิกรไทย',     required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'bank_account',           header: 'เลขที่บัญชี',          example: '1234567890',    required: false, note: 'บังคับถ้าวิธีรับเงิน = bank_transfer' },
  { key: 'status',                 header: 'สถานะ',                example: 'active',        required: false, note: 'active (ค่าเริ่มต้น) / inactive' },
  { key: 'notes',                  header: 'หมายเหตุ',             example: '',              required: false, note: 'ข้อมูลเพิ่มเติม (ไม่บังคับ)' },
] as const

// Default export for compatibility
export const IMPORT_COLUMNS = IMPORT_COLUMNS_TPI

// ─── Valid value lists (single source of truth for template + validator) ───────

export const VALID_NATIONALITIES   = ['ไทย', 'เมียนมา', 'กัมพูชา', 'ลาว']
export const VALID_POSITIONS       = ['worker', 'clerk', 'พนักงานทั่วไป', 'เสมียน']
export const VALID_RATE_TIERS      = ['ปกติ', 'ฝีมือ']
export const VALID_PAYMENT_METHODS = ['bank_transfer', 'cash', 'โอนบัญชี', 'เงินสด']
export const VALID_STATUSES        = ['active', 'inactive', 'ปกติ', 'พ้นสภาพ']
export const VALID_PREFIXES        = ['นาย', 'นาง', 'นางสาว', 'Mr.', 'Ms.', 'Mrs.']
export const VALID_BANKS           = [
  'กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย',
  'กรุงศรี', 'ทหารไทยธนชาต', 'ออมสิน', 'ธ.ก.ส.', 'เพื่อการเกษตรและสหกรณ์การเกษตร', 'อื่นๆ',
]
export const VALID_YES_NO          = ['ใช่', 'ไม่ใช่']

function colLetter(idx: number) { return String.fromCharCode(65 + idx) }

// Data rows start at row 7 (1-based): title / instruction / header / ref-row / ex1 / ex2 / ex3
const DATA_ROW_START = 7
function sqref(colIdx: number) {
  const c = colLetter(colIdx)
  return `${c}${DATA_ROW_START}:${c}1000`
}

export interface TemplateOptions {
  isTpi?: boolean
  factoryName?: string
}

export function downloadEmployeeTemplate(options?: TemplateOptions) {
  const isTpi = options?.isTpi ?? true
  const rawFactoryName = options?.factoryName?.trim() || ''
  const cleanFactoryName = rawFactoryName.replace(/tpi|ทีพีไอ|โพลีน/gi, '').trim()
  const templateTitle = cleanFactoryName ? `แบบฟอร์มนำเข้าข้อมูลพนักงาน — ${cleanFactoryName}` : 'แบบฟอร์มนำเข้าข้อมูลพนักงาน'
  const columns = isTpi ? IMPORT_COLUMNS_TPI : IMPORT_COLUMNS_DIAMOND
  const wb = XLSX.utils.book_new()
  const REF_SHEET = 'ค่าอ้างอิง'

  // ── Sheet 1: "ค่าอ้างอิง" — lookup lists used by Excel data validation ──────
  const refLists = [
    { title: 'สัญชาติ',        values: VALID_NATIONALITIES },
    { title: 'วิธีรับเงิน',    values: ['bank_transfer', 'cash'] },
    { title: 'สถานะ',          values: ['active', 'inactive'] },
    { title: 'คำนำหน้า',      values: VALID_PREFIXES },
    { title: 'ธนาคาร',        values: VALID_BANKS },
    { title: 'กลุ่มงาน',       values: ['worker', 'clerk'] },
    { title: 'ประเภทค่าแรง',   values: VALID_RATE_TIERS },
    { title: 'ใช่_ไม่ใช่',     values: VALID_YES_NO },
  ]
  const maxRows = Math.max(...refLists.map(l => l.values.length))
  const refMatrix: string[][] = [refLists.map(l => l.title)]
  for (let r = 0; r < maxRows; r++) {
    refMatrix.push(refLists.map(l => l.values[r] ?? ''))
  }
  const wsRef = XLSX.utils.aoa_to_sheet(refMatrix)
  wsRef['!cols'] = refLists.map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, wsRef, REF_SHEET)

  function refRange(refColIdx: number, count: number) {
    const c = colLetter(refColIdx)
    return `'${REF_SHEET}'!$${c}$2:$${c}$${count + 1}`
  }

  // ── Sheet 2: "พนักงาน" — the import template ──────────────────────────────
  const ncols = columns.length
  const refRow = columns.map(c => c.note)

  let exRows: (string | number)[][] = []
  if (isTpi) {
    exRows = [
      // Example 1: Thai, worker, normal rate tier, complete profile
      ['001', 'นาย', 'สมชาย', 'ใจดี', 'ไทย', '1234567890123', 'worker', 'พนักงานฝ่ายผลิต', 'ปกติ', 'bank_transfer', 'กสิกรไทย', '1234567890', 'active', 'ไม่ใช่', 'ไม่ใช่', 'ไม่ใช่', 'ใช่', ''],
      // Example 2: Foreigner (Myanmar), worker, skilled rate tier, cash, waiting for SSN
      ['002', 'Mr.', 'Kyaw', '', 'เมียนมา', '', 'worker', 'ช่างเชื่อม', 'ฝีมือ', 'cash', '', '', 'active', 'ไม่ใช่', 'ไม่ใช่', 'ไม่ใช่', 'ไม่ใช่', 'รอเลข ปกส'],
      // Example 3: Thai, clerk, normal, จป. + ค่าตำแหน่ง
      ['1267', 'นางสาว', 'จุฑาทิพย์', 'มีสุข', 'ไทย', '3100500123456', 'clerk', 'เสมียนประสานงาน', 'ปกติ', 'bank_transfer', 'ไทยพาณิชย์', '9876543210', 'active', 'ใช่', 'ใช่', 'ไม่ใช่', 'ใช่', ''],
    ]
  } else {
    exRows = [
      ['001', 'นาย', 'สมชาย', 'ใจดี', 'ไทย', '1234567890123', 'worker', 'พนักงานฝ่ายผลิต', 350, 'bank_transfer', 'กสิกรไทย', '1234567890', 'active', ''],
      ['003', 'นางสาว', 'ขยัน', 'รอบคอบ', 'ไทย', '5555555555555', 'clerk', 'การเงิน', 15000, 'bank_transfer', 'ไทยพาณิชย์', '1112223334', 'active', ''],
    ]
  }

  const wsData: (string | number)[][] = [
    // Row 1 — Title
    [templateTitle, ...Array(ncols - 1).fill('')],
    // Row 2 — Instruction
    ['⚠️  กรอกข้อมูลตั้งแต่แถวที่ 7 เป็นต้นไป  |  คอลัมน์ที่มี * = บังคับกรอก  |  ห้ามลบหรือเปลี่ยนชื่อ Header', ...Array(ncols - 1).fill('')],
    // Row 3 — Column headers
    columns.map(c => c.header),
    // Row 4 — Reference / valid values row
    ['▶ ค่าที่ยอมรับ / หมายเหตุ:', ...refRow.slice(1)],
    // Example rows
    ...exRows,
  ]

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  ws['!cols'] = columns.map(c => ({
    wch: Math.max(c.header.length * 2.5, 14),
  }))

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
  ]

  // Dynamic dropdown validation mapping
  const colKeyToIdx: Record<string, number> = {}
  columns.forEach((c, idx) => {
    colKeyToIdx[c.key] = idx
  })

  const validations: any[] = []

  if (colKeyToIdx.nationality !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.nationality),
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
    })
  }

  if (colKeyToIdx.position !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.position),
      type: 'list',
      formula1: refRange(5, 2),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: 'ใช้: worker หรือ clerk',
      errorTitle: 'กลุ่มงานไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'กลุ่มงาน',
      prompt: 'worker = พนักงานทั่วไป | clerk = เสมียน',
    })
  }

  if (colKeyToIdx.rate_tier !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.rate_tier),
      type: 'list',
      formula1: refRange(6, VALID_RATE_TIERS.length),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: 'ใช้: ปกติ หรือ ฝีมือ',
      errorTitle: 'ประเภทค่าแรงไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'ประเภทค่าแรง',
      prompt: 'ปกติ (ค่าแรงปกติ) / ฝีมือ (ค่าแรงฝีมือ)',
    })
  }

  if (colKeyToIdx.payment_method !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.payment_method),
      type: 'list',
      formula1: refRange(1, 2),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: 'ใช้: bank_transfer หรือ cash',
      errorTitle: 'วิธีรับเงินไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'วิธีรับเงิน',
      prompt: 'bank_transfer = โอนบัญชี | cash = เงินสด',
    })
  }

  if (colKeyToIdx.bank_name !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.bank_name),
      type: 'list',
      formula1: refRange(4, VALID_BANKS.length),
      showDropDown: false,
      showErrorMessage: false,
      errorStyle: 'warning',
      showInputMessage: true,
      promptTitle: 'ธนาคาร',
      prompt: VALID_BANKS.join(', '),
    })
  }

  if (colKeyToIdx.status !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.status),
      type: 'list',
      formula1: refRange(2, 2),
      showDropDown: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      error: 'ใช้: active หรือ inactive',
      errorTitle: 'สถานะไม่ถูกต้อง',
      showInputMessage: true,
      promptTitle: 'สถานะ',
      prompt: 'active = ปกติ | inactive = พ้นสภาพ',
    })
  }

  if (colKeyToIdx.prefix !== undefined) {
    validations.push({
      sqref: sqref(colKeyToIdx.prefix),
      type: 'list',
      formula1: refRange(3, VALID_PREFIXES.length),
      showDropDown: false,
      showErrorMessage: false,
      errorStyle: 'warning',
      showInputMessage: true,
      promptTitle: 'คำนำหน้า',
      prompt: VALID_PREFIXES.join(' / ') + ' (หรือเว้นว่าง)',
    })
  }

  // Yes / No dropdowns
  const yesNoKeys = ['is_safety_officer', 'has_position_allowance', 'exempt_social_security', 'data_complete']
  yesNoKeys.forEach(k => {
    if (colKeyToIdx[k] !== undefined) {
      validations.push({
        sqref: sqref(colKeyToIdx[k]),
        type: 'list',
        formula1: refRange(7, VALID_YES_NO.length),
        showDropDown: false,
        showErrorMessage: false,
        errorStyle: 'warning',
        showInputMessage: true,
        promptTitle: 'ใช่ / ไม่ใช่',
        prompt: 'ใช่ หรือ ไม่ใช่',
      })
    }
  })

  ;(ws as any)['!dataValidations'] = validations

  XLSX.utils.book_append_sheet(wb, ws, 'พนักงาน')

  // ── Sheet 3: "คู่มือ" — guide ──────────────────────────────
  const guideData: (string | number)[][] = [
    ['คำอธิบาย Column', 'บังคับ?', 'ค่าที่ยอมรับ / หมายเหตุ'],
    ...columns.map(c => [
      c.header.replace('*', '').trim(),
      c.required ? '✅ บังคับ' : '—',
      c.note,
    ]),
    ['', '', ''],
    ['ค่าที่ยอมรับ — สัญชาติ',      '', VALID_NATIONALITIES.join(', ')],
    ['ค่าที่ยอมรับ — กลุ่มงาน',     '', 'worker (ทั่วไป), clerk (เสมียน)'],
    ...(isTpi ? [['ค่าที่ยอมรับ — ประเภทค่าแรง', '', 'ปกติ, ฝีมือ (คำนวณค่าแรงอัตโนมัติตามรหัสงาน)']] : []),
    ['ค่าที่ยอมรับ — วิธีรับเงิน',  '', 'bank_transfer (โอนบัญชี), cash (เงินสด)'],
    ['ค่าที่ยอมรับ — สถานะ',        '', 'active (พนักงานปัจจุบัน), inactive (พ้นสภาพ)'],
    ['ค่าที่ยอมรับ — ธนาคาร',      '', VALID_BANKS.join(', ')],
    ['ค่าที่ยอมรับ — คำนำหน้า',    '', VALID_PREFIXES.join(', ')],
  ]
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 65 }]
  XLSX.utils.book_append_sheet(wb, wsGuide, 'คู่มือ')

  const downloadFilename = 'employee_import_template.xlsx'
  XLSX.writeFile(wb, downloadFilename)
}

// ─── Parse uploaded file ───────────────────────────────────────────────────────

export interface ParsedRow {
  rowNum: number
  data: Record<string, string>
  errors: string[]
}

function cleanHeaderKey(h: string): string {
  return h.replace(/[\s\*\(\)\[\]\/—\-_]/g, '').toLowerCase()
}

export function parseEmployeeExcel(file: File, options?: { isTpi?: boolean }): Promise<ParsedRow[]> {
  const isTpi = options?.isTpi ?? true

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })

        // If sheet "พนักงาน" exists, prioritize it
        const sheetName = wb.SheetNames.find(n => n === 'พนักงาน') ?? wb.SheetNames[0]
        const targetWs = wb.Sheets[sheetName]
        if (!targetWs) {
          reject(new Error('ไม่พบ Sheet ข้อมูลพนักงาน'))
          return
        }

        const rows: unknown[][] = XLSX.utils.sheet_to_json(targetWs, { header: 1, defval: '' })

        // Find the header row — contains "รหัสพนักงาน"
        const headerRowIdx = rows.findIndex((row: unknown[]) =>
          row.some((cell: unknown) => String(cell).includes('รหัสพนักงาน'))
        )
        if (headerRowIdx === -1) {
          reject(new Error('ไม่พบ Column Header "รหัสพนักงาน*" — กรุณาใช้ Template ที่ดาวน์โหลดมา'))
          return
        }

        const headerRow = (rows[headerRowIdx] as string[]).map((h: unknown) => String(h).trim())

        // Skip example codes
        const EXAMPLE_CODES = new Set(['001', '002', '003', '1267'])

        // Smart header mapping
        const colKeyMap: Record<number, string> = {}

        headerRow.forEach((h, idx) => {
          const raw = cleanHeaderKey(h)
          if (!raw) return

          if (raw.includes('รหัสพนักงาน') || raw === 'employeecode' || raw === 'code') {
            colKeyMap[idx] = 'employee_code'
          } else if (raw.includes('คำนำหน้า') || raw === 'prefix') {
            colKeyMap[idx] = 'prefix'
          } else if (raw.includes('ชื่อ') && !raw.includes('สกุล') && !raw.includes('ชื่อจริง') && !raw.includes('บัญชี')) {
            colKeyMap[idx] = 'first_name'
          } else if (raw.includes('นามสกุล') || raw === 'lastname') {
            colKeyMap[idx] = 'last_name'
          } else if (raw.includes('สัญชาติ') || raw === 'nationality') {
            colKeyMap[idx] = 'nationality'
          } else if (raw.includes('เลขบัตร') || raw.includes('ปกส') || raw.includes('passport') || raw === 'nationalid') {
            colKeyMap[idx] = 'national_id'
          } else if (raw.includes('กลุ่มงาน') || raw === 'position' || (raw.includes('ตำแหน่ง') && !raw.includes('ตำแหน่งงาน') && !raw.includes('ค่าตำแหน่ง'))) {
            colKeyMap[idx] = 'position'
          } else if (raw.includes('ตำแหน่งงาน') || raw === 'jobtitle') {
            colKeyMap[idx] = 'job_title'
          } else if (raw.includes('ประเภทค่าแรง') || raw.includes('ประเภทค่าจ้าง') || raw === 'ratetier') {
            colKeyMap[idx] = 'rate_tier'
          } else if (raw.includes('ค่าแรง') || raw.includes('ค่าจ้าง') || raw === 'rateper12h' || raw === 'rate') {
            colKeyMap[idx] = 'rate_per_12h'
          } else if (raw.includes('วิธีรับเงิน') || raw === 'paymentmethod') {
            colKeyMap[idx] = 'payment_method'
          } else if (raw.includes('ธนาคาร') || raw === 'bankname') {
            colKeyMap[idx] = 'bank_name'
          } else if (raw.includes('เลขที่บัญชี') || raw.includes('เลขบัญชี') || raw === 'bankaccount') {
            colKeyMap[idx] = 'bank_account'
          } else if (raw.includes('สถานะ') || raw === 'status') {
            colKeyMap[idx] = 'status'
          } else if (raw.includes('จป') || raw.includes('ความปลอดภัย') || raw === 'issafetyofficer') {
            colKeyMap[idx] = 'is_safety_officer'
          } else if (raw.includes('ค่าตำแหน่ง') || raw === 'haspositionallowance') {
            colKeyMap[idx] = 'has_position_allowance'
          } else if (raw.includes('ยกเว้นปกส') || raw.includes('ยกเว้นประกัน') || raw === 'exemptsocialsecurity') {
            colKeyMap[idx] = 'exempt_social_security'
          } else if (raw.includes('ข้อมูลสมบูรณ์') || raw === 'datacomplete') {
            colKeyMap[idx] = 'data_complete'
          } else if (raw.includes('หมายเหตุ') || raw === 'notes' || raw === 'note') {
            colKeyMap[idx] = 'notes'
          }
        })

        const empCodeColIdx = Number(
          Object.entries(colKeyMap).find(([, v]) => v === 'employee_code')?.[0] ?? -1
        )

        const parsed: ParsedRow[] = []
        const dataRows = rows.slice(headerRowIdx + 1)

        dataRows.forEach((row: unknown[], i) => {
          // Skip empty rows
          if (row.every((cell: unknown) => String(cell).trim() === '')) return

          // Skip reference header notes row (starts with "▶")
          if (String(row[0]).startsWith('▶')) return

          const rawCode = String(row[empCodeColIdx] ?? '').trim()
          if (!rawCode) return

          // Skip example rows
          if (EXAMPLE_CODES.has(rawCode) && (i < 5)) return

          const data: Record<string, string> = {}
          Object.entries(colKeyMap).forEach(([idxStr, key]) => {
            const idx = parseInt(idxStr)
            data[key] = String(row[idx] ?? '').trim()
          })

          // ── Normalization ──
          // Nationality
          if (!data.nationality) {
            data.nationality = 'ไทย'
          } else if (data.nationality.includes('พม่า') || data.nationality.includes('เมียนมา') || data.nationality.toLowerCase().includes('myanmar') || data.nationality.toLowerCase().includes('burma')) {
            data.nationality = 'เมียนมา'
          } else if (data.nationality.includes('กัมพูชา') || data.nationality.includes('เขมร') || data.nationality.toLowerCase().includes('cambodia')) {
            data.nationality = 'กัมพูชา'
          } else if (data.nationality.includes('ลาว') || data.nationality.toLowerCase().includes('lao')) {
            data.nationality = 'ลาว'
          }

          // Position: worker vs clerk
          if (!data.position) {
            data.position = 'worker'
          } else if (data.position.includes('เสมียน') || data.position.toLowerCase().includes('clerk')) {
            data.position = 'clerk'
          } else {
            data.position = 'worker'
          }

          // Rate tier for TPI
          if (!data.rate_tier) {
            data.rate_tier = 'normal'
          } else if (data.rate_tier.includes('ฝีมือ') || data.rate_tier.toLowerCase().includes('skilled')) {
            data.rate_tier = 'skilled'
          } else {
            data.rate_tier = 'normal'
          }

          // Payment method
          if (!data.payment_method) {
            data.payment_method = 'bank_transfer'
          } else if (data.payment_method.includes('สด') || data.payment_method.toLowerCase().includes('cash')) {
            data.payment_method = 'cash'
          } else {
            data.payment_method = 'bank_transfer'
          }

          // Status
          if (!data.status) {
            data.status = 'active'
          } else if (data.status.includes('พ้น') || data.status.includes('ออก') || data.status.toLowerCase().includes('inactive')) {
            data.status = 'inactive'
          } else {
            data.status = 'active'
          }

          // Booleans
          const parseBool = (val?: string) => {
            if (!val) return 'false'
            const s = val.trim().toLowerCase()
            return (s === 'ใช่' || s === 'yes' || s === 'true' || s === '1') ? 'true' : 'false'
          }
          data.is_safety_officer = parseBool(data.is_safety_officer)
          data.has_position_allowance = parseBool(data.has_position_allowance)
          data.exempt_social_security = parseBool(data.exempt_social_security)
          data.data_complete = parseBool(data.data_complete)

          // Auto-assign wage_type based on position & factory
          data.wage_type = isTpi ? 'daily' : (data.position === 'clerk' ? 'monthly' : 'daily')

          // ── Validation ──
          const errors: string[] = []
          if (!data.employee_code) errors.push('รหัสพนักงานว่าง')
          if (!data.first_name)    errors.push('ชื่อว่าง')

          if (data.nationality === 'ไทย' && !data.last_name) {
            errors.push('พนักงานไทยต้องระบุนามสกุล')
          }

          if (data.payment_method === 'bank_transfer') {
            if (!data.bank_account) errors.push('โอนบัญชีต้องกรอกเลขบัญชี')
          }

          // Only require numeric rate_per_12h for non-TPI
          if (!isTpi) {
            if (!data.rate_per_12h || isNaN(Number(data.rate_per_12h))) {
              errors.push('ค่าแรงต้องเป็นตัวเลข')
            }
          }

          if (!VALID_NATIONALITIES.includes(data.nationality)) {
            errors.push(`สัญชาติ "${data.nationality}" ไม่ถูกต้อง`)
          }

          parsed.push({ rowNum: headerRowIdx + i + 2, data, errors })
        })

        resolve(parsed)
      } catch (err: unknown) {
        const error = err as Error
        reject(new Error('ไม่สามารถอ่านไฟล์ได้: ' + error.message))
      }
    }
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์'))
    reader.readAsArrayBuffer(file)
  })
}
