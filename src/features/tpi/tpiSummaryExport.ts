import { formatEmployeeFullName } from '../../lib/formatters'
import { isTpiJobCode } from './model'
import type { TpiPayrollCalculationResult } from './payrollCalc'

export function fmtNationality(n: string | null | undefined): string | null {
  if (!n || n === 'ไทย') return null
  if (n === 'เมียนมา' || n === 'พม่า' || n.toLowerCase().includes('myanmar') || n.toLowerCase().includes('burma')) return 'เมียนมา'
  return n
}

export function maskBank(account: string | null | undefined): string {
  if (!account) return '—'
  const s = account.replace(/[-\s]/g, '')
  if (s.length <= 6) return s
  return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
}

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

export function fmtDisplayDate(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `วัน${DAYS[date.getDay()]}ที่ ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

export function getDatesInRange(startStr: string, endStr: string): string[] {
  const dates: string[] = []
  const start = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr + 'T00:00:00')
  const curr = new Date(start)
  while (curr <= end) {
    const y = curr.getFullYear()
    const m = String(curr.getMonth() + 1).padStart(2, '0')
    const d = String(curr.getDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    curr.setDate(curr.getDate() + 1)
  }
  return dates
}

export const monoNum = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function buildTpiEmployeeSummaryPageHtml(
  emp: any,
  periodLabelStr: string,
  stats: TpiPayrollCalculationResult,
  dailyAudit: any[],
  empAdvances: any[],
  generatedAt: string,
  isSkilled: boolean,
  jobMap: Map<string, any>
): string {
  const payMethodLabel = emp.payment_method === 'bank_transfer' ? 'โอนผ่านธนาคาร' : 'เงินสด'
  const bankDetails = emp.payment_method === 'bank_transfer' && emp.bank_name
    ? `${emp.bank_name} ${maskBank(emp.bank_account)}`
    : '—'
  const posLabel = emp.position === 'clerk' ? 'เสมียน' : 'พนักงานทั่วไป'
  const jobTitleLabel = emp.job_title && !isTpiJobCode(emp.job_title) ? ` · ${emp.job_title}` : ''

  const dailyRowsHtml = dailyAudit.map(day => {
    const isWorked = day.shifts && day.shifts.length > 0
    const dayLabel = day.isHoliday ? 'วันหยุดนักขัตฤกษ์' : 'วันทำงานปกติ'

    let shiftDesc = 'หยุด'
    const items: string[] = []

    if (isWorked) {
      shiftDesc = day.shifts.map((s: any) => {
        const jInfo = jobMap.get(s.jobCode)
        const jName = jInfo?.name ? ` - ${jInfo.name}` : ''
        return `${s.shiftName} [${s.jobCode}${jName}]${s.isHalf ? ' (ครึ่ง)' : ''}${s.tier === 'skilled' ? ' (ฝีมือ)' : ''}`
      }).join(' | ')

      day.shifts.forEach((s: any) => {
        const tierNote = s.tier === 'skilled' ? ' (ฝีมือ)' : ''
        if (s.isFirstShiftOfDay) {
          items.push(`กะ 1: ฿${monoNum(s.totalShiftWage)}${tierNote}${s.isHoliday ? ' (หยุด x2)' : ''}`)
        } else {
          items.push(`ควบกะ: ฿${monoNum(s.totalShiftWage)}${tierNote}${s.isHoliday ? ' (หยุด x2)' : ''}`)
        }
        if (s.otPay > 0) {
          items.push(`OT ${s.otHours}ชม.: ฿${monoNum(s.otPay)}`)
        }
      })
    }

    const totalDayEarned = (day.dayTotalWage || 0) + (day.dayTotalOt || 0)

    return `
      <tr style="${!isWorked ? 'opacity:0.55;background:#fafafa' : ''}">
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;line-height:1.3;white-space:nowrap">${fmtDisplayDate(day.date)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;line-height:1.3;color:${day.isHoliday ? '#c0392b' : '#666'};font-weight:${day.isHoliday ? 700 : 400};white-space:nowrap">${dayLabel}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;line-height:1.3">${shiftDesc}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;line-height:1.3">${items.join(' · ') || '—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;line-height:1.3;text-align:right;font-family:monospace;font-weight:600;white-space:nowrap">
          ${totalDayEarned > 0 ? '฿' + monoNum(totalDayEarned) : '—'}
        </td>
      </tr>
    `
  }).join('')

  const periodIncomeRowsHtml = [
    stats.amountDiligence > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">เบี้ยขยัน</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">ประจำงวด</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace">฿${monoNum(stats.amountDiligence)}</td></tr>` : '',
    stats.amountSpecial > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">เงินพิเศษ</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${stats.specialNote || 'ในงวดนี้'}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace">฿${monoNum(stats.amountSpecial)}</td></tr>` : '',
  ].join('')

  const deductionRowsHtml = [
    stats.deductSocialSecurity > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#c0392b">ประกันสังคม (5%)</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666">กะแรก</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace;color:#c0392b">−฿${monoNum(stats.deductSocialSecurity)}</td></tr>` : '',
    ...empAdvances.map((adv: any, i: number) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#c0392b">เบิกล่วงหน้า (#${i+1})</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666">${adv.notes || ''}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace;color:#c0392b">−฿${monoNum(Number(adv.amount))}</td></tr>`),
    stats.deductSafetyEquipment > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#c0392b">อุปกรณ์ จป.</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666">หักอุปกรณ์</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace;color:#c0392b">−฿${monoNum(stats.deductSafetyEquipment)}</td></tr>` : '',
    stats.deductUniform > 0 ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#c0392b">ค่าเสื้อ</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666">หักชุดทำงาน</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace;color:#c0392b">−฿${monoNum(stats.deductUniform)}</td></tr>` : '',
  ].join('')

  const hasAdjustments = !!(periodIncomeRowsHtml || deductionRowsHtml)

  return `
<div class="page-container" style="box-sizing:border-box;font-family:'Sarabun',sans-serif;color:#1a1a1a;font-size:11px;padding:0;page-break-inside:avoid;break-inside:avoid">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:9px;border-bottom:2px solid #1a1a1a;margin-bottom:12px">
    <div>
      <div style="font-weight:800;font-size:17px;line-height:1.25">ห้างหุ้นส่วนจำกัด วิราญกร (สาขา โรงงานทีพีไอ โพลีน)</div>
      <div style="font-size:13px;font-weight:700;color:#555;margin-top:2px">รายงานสรุปภาพรวมพนักงาน (TPI Employee Ledger Summary)</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#666;line-height:1.35">
      <div>งวดเงินเดือน: <strong>${periodLabelStr}</strong></div>
      <div>พิมพ์เมื่อ: ${generatedAt}</div>
    </div>
  </div>

  <!-- Employee Info Box -->
  <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:4px;padding:10px 14px;margin-bottom:12px;display:grid;grid-template-columns:1.2fr 1fr;gap:4px 16px;font-size:11.5px;line-height:1.5">
    <div>
      <div><strong>ชื่อ-นามสกุล:</strong> ${formatEmployeeFullName(emp, true)} ${fmtNationality(emp.nationality) ? `(${fmtNationality(emp.nationality)})` : ''}</div>
      <div><strong>รหัสพนักงาน:</strong> <span style="font-family:monospace">${emp.employee_code}</span> &nbsp; <strong>ตำแหน่ง:</strong> ${posLabel}${jobTitleLabel}</div>
    </div>
    <div>
      <div><strong>อัตราค่าจ้าง:</strong> ${isSkilled ? '฿377/กะ (เรทช่างฝีมือ)' : '฿357/กะ (เรทปกติ)'} &nbsp; <strong>วิธีรับเงิน:</strong> ${payMethodLabel}</div>
      <div><strong>ธนาคาร/เลขบัญชี:</strong> ${bankDetails}</div>
    </div>
  </div>

  <!-- 4 KPI Summary Cards -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
    <div style="background:#1a1a1a;color:#fff;padding:10px 12px;border-radius:4px">
      <div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">กะทำงาน (วันทำงาน)</div>
      <div style="font-size:16px;font-weight:800;font-family:monospace;margin:2px 0">${stats.totalShiftsCount} กะ (${stats.workDaysCount} วัน)</div>
      <div style="font-size:9px;color:#aaa">กะ 1: ${stats.workDaysCount} · ควบกะ: ${Math.max(0, stats.totalShiftsCount - stats.workDaysCount)} · ครึ่งกะ: ${stats.halfShiftsCount}</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:10px 12px;border-radius:4px">
      <div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">รายได้รวม</div>
      <div style="font-size:16px;font-weight:800;font-family:monospace;color:#6ee7b7;margin:2px 0">฿${monoNum(stats.totalIncome)}</div>
      <div style="font-size:9px;color:#aaa">ก่อนหัก (ค่าจ้าง+ค่ากะ+OT+เงินเพิ่ม)</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:10px 12px;border-radius:4px">
      <div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">หักรวม</div>
      <div style="font-size:16px;font-weight:800;font-family:monospace;color:#fca5a5;margin:2px 0">฿${monoNum(stats.totalDeductions)}</div>
      <div style="font-size:9px;color:#aaa">ปกส. + เบิก + อุปกรณ์ + เสื้อ</div>
    </div>
    <div style="background:#1a1a1a;color:#fff;padding:10px 12px;border-radius:4px">
      <div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">สุทธิรับจริง</div>
      <div style="font-size:16px;font-weight:800;font-family:monospace;color:#fde047;margin:2px 0">฿${monoNum(stats.netPay)}</div>
      <div style="font-size:9px;color:#aaa">NET PAY</div>
    </div>
  </div>

  <!-- Table 1: Daily Log -->
  <div style="margin-bottom:12px">
    <div style="font-weight:700;font-size:12.5px;margin-bottom:5px">1. บันทึกรายวัน (Daily Log)</div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;white-space:nowrap;width:110px">วันที่</th>
          <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;white-space:nowrap;width:95px">ประเภทวัน</th>
          <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;width:170px">กะที่ปฏิบัติงาน / รหัสงาน</th>
          <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6">รายละเอียดรายได้</th>
          <th style="background:#f1f3f5;text-align:right;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;white-space:nowrap;width:85px">รวมรายวัน</th>
        </tr>
      </thead>
      <tbody>
        ${dailyRowsHtml}
      </tbody>
    </table>
  </div>

  <!-- Table 2: Adjustments & Deductions (Vertical full-width) -->
  ${hasAdjustments ? `
    <div style="margin-bottom:12px">
      <div style="font-weight:700;font-size:12.5px;margin-bottom:5px">2. รายการประจำงวด & รายการหักเงิน</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;width:140px">รายการ</th>
            <th style="background:#f1f3f5;text-align:left;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6">รายละเอียด / หมายเหตุ</th>
            <th style="background:#f1f3f5;text-align:right;padding:6px 8px;font-size:11px;font-weight:700;border-bottom:1.5px solid #dee2e6;width:100px">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          ${periodIncomeRowsHtml}
          ${deductionRowsHtml}
        </tbody>
      </table>
    </div>
  ` : ''}

  <!-- Net Pay Banner (Vertical full-width) -->
  <div style="background:#1a1a1a;color:#fff;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;border-radius:4px;margin-top:12px">
    <div>
      <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px">NET PAY · สุทธิรับจริง</div>
      <div style="font-size:10.5px;color:#ccc;margin-top:3px">${stats.totalShiftsCount} กะทำงาน (${stats.workDaysCount} วัน) · รายได้ ฿${monoNum(stats.totalIncome)} · หัก ฿${monoNum(stats.totalDeductions)}</div>
    </div>
    <div style="font-family:monospace;font-size:24px;font-weight:800;color:#fde047">
      ฿${monoNum(stats.netPay)}
    </div>
  </div>
</div>
`
}

export function buildTpiEmployeeSummaryFullHtml(
  emp: any,
  periodLabelStr: string,
  stats: TpiPayrollCalculationResult,
  dailyAudit: any[],
  empAdvances: any[],
  generatedAt: string,
  isSkilled: boolean,
  jobMap: Map<string, any>
): string {
  const pageContent = buildTpiEmployeeSummaryPageHtml(
    emp,
    periodLabelStr,
    stats,
    dailyAudit,
    empAdvances,
    generatedAt,
    isSkilled,
    jobMap
  )

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Summary_${emp.employee_code}_${emp.first_name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#fff;font-family:'Sarabun',sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased}
  @page{size:A4 portrait;margin:8mm 10mm}
  @media print{
    html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page-container{page-break-inside:avoid;break-inside:avoid}
  }
</style>
</head>
<body>
  ${pageContent}
</body>
</html>`
}

export function buildTpiEmployeeSummaryExcelRows(
  emp: any,
  periodLabelStr: string,
  stats: TpiPayrollCalculationResult,
  dailyAudit: any[],
  empAdvances: any[],
  isSkilled: boolean,
  jobMap: Map<string, any>
): any[][] {
  const payMethodLabel = emp.payment_method === 'bank_transfer' ? 'โอนผ่านธนาคาร' : 'เงินสด'
  const bankName = emp.payment_method === 'bank_transfer' ? (emp.bank_name || '-') : '-'
  const bankAccount = emp.payment_method === 'bank_transfer' ? (emp.bank_account || '-') : '-'
  const posLabel = emp.position === 'clerk' ? 'เสมียน' : 'พนักงานทั่วไป'

  const rows: any[][] = []

  rows.push(['ห้างหุ้นส่วนจำกัด วิราญกร (สาขา โรงงานทีพีไอ โพลีน)'])
  rows.push(['รายงานสรุปภาพรวมพนักงาน (TPI Employee Ledger Summary)'])
  rows.push(['งวดการจ่ายเงิน:', periodLabelStr])
  rows.push([])

  rows.push(['รหัสพนักงาน', emp.employee_code, 'ชื่อ-นามสกุล', `${formatEmployeeFullName(emp, true)}${isSkilled ? ' ⭐' : ''}`])
  rows.push(['ตำแหน่ง', posLabel, 'ระดับอัตราค่าจ้าง', isSkilled ? '฿377/กะ (เรทฝีมือ ⭐)' : '฿357/กะ (เรทปกติ)'])
  rows.push(['วิธีการรับเงิน', payMethodLabel, 'ธนาคาร', bankName, 'เลขที่บัญชี', bankAccount])
  rows.push([])

  rows.push(['สรุปยอดประจำงวด'])
  rows.push(['จำนวนกะทำงานทั้งหมด (กะ)', stats.totalShiftsCount, 'วันทำงานจริง (วัน)', stats.workDaysCount, 'ครึ่งกะ (กะ)', stats.halfShiftsCount])
  rows.push(['รายได้รวม (บาท)', stats.totalIncome, 'รายการหักรวม (บาท)', stats.totalDeductions, 'สุทธิรับจริง NET PAY (บาท)', stats.netPay])
  rows.push([])

  rows.push(['1. บันทึกรายวัน (Daily Log)'])
  rows.push(['วันที่', 'ประเภทวัน', 'กะ / ลำดับ', 'รหัสงาน (Job Code)', 'ระดับเรท', 'ค่าจ้างกะ (บาท)', 'OT (ชม.)', 'ค่า OT (บาท)', 'รวมรายได้วัน (บาท)'])

  dailyAudit.forEach(day => {
    const isWorked = day.shifts && day.shifts.length > 0
    const dayTypeLabel = day.isHoliday ? 'วันหยุดนักขัตฤกษ์' : 'วันทำงานปกติ'

    if (!isWorked) {
      rows.push([day.date, dayTypeLabel, 'หยุด', '-', '-', 0, 0, 0, 0])
    } else {
      day.shifts.forEach((s: any) => {
        const jInfo = jobMap.get(s.jobCode)
        const jName = jInfo?.name ? ` (${jInfo.name})` : ''
        rows.push([
          day.date,
          dayTypeLabel,
          s.shiftName + (s.isHalf ? ' (ครึ่งกะ)' : ''),
          s.jobCode + jName,
          s.tier === 'skilled' ? 'ฝีมือ (฿377) ⭐' : 'ปกติ (฿357)',
          s.totalShiftWage,
          s.otHours || 0,
          s.otPay || 0,
          s.totalShiftWage + (s.otPay || 0)
        ])
      })
    }
  })

  rows.push([])
  rows.push(['2. รายการประจำงวด & รายการหักเงิน'])
  rows.push(['ประเภทรายการ', 'รายละเอียด / หมายเหตุ', 'จำนวนเงิน (บาท)'])

  if (stats.amountDiligence > 0) rows.push(['รายได้', 'เบี้ยขยันประจำงวด (สิ้นเดือน)', stats.amountDiligence])
  if (stats.amountSpecial > 0) rows.push(['รายได้', `เงินพิเศษ / ปรับปรุง (${stats.specialNote || ''})`, stats.amountSpecial])

  if (stats.deductSocialSecurity > 0) rows.push(['รายการหัก', 'ประกันสังคม (5% กะแรก)', -stats.deductSocialSecurity])
  empAdvances.forEach((adv: any, i: number) => {
    rows.push(['รายการหัก', `เบิกล่วงหน้า (#${i + 1}) ${adv.notes || ''}`, -Number(adv.amount || 0)])
  })
  if (stats.deductSafetyEquipment > 0) rows.push(['รายการหัก', 'อุปกรณ์ความปลอดภัย', -stats.deductSafetyEquipment])
  if (stats.deductUniform > 0) rows.push(['รายการหัก', 'ค่าเสื้อพนักงาน', -stats.deductUniform])

  rows.push([])
  rows.push(['ยอดเงินสุทธิรับจริง (NET PAY)', '', stats.netPay])

  return rows
}
