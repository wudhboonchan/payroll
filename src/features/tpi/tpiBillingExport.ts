import type { FactoryBillingSummary } from './tpiBillingCalc'

export async function exportFactoryBillingToExcel(
  summary: FactoryBillingSummary,
  filename?: string
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const rows: any[][] = []

  // Company Header
  rows.push(['ห้างหุ้นส่วนจำกัด วิราญกร'])
  rows.push(['ใบสรุปยอดวางบิลเบิกค่าจ้างโรงงาน (Factory Billing Statement)'])
  rows.push(['โรงงานต้นสังกัด:', summary.factoryName])
  rows.push(['งวดการจ่ายเงิน:', summary.periodLabel])
  rows.push([])

  // Main Table Header (2 rows for hierarchy)
  const headerRow1 = [
    'ข้อมูลรหัสงาน', '', '',
    'จำนวนแรงงาน (กะทำงาน)', '', '', '', '', '', '',
    'ค่าจ้างจ่ายพนักงาน (ต้นทุน)', '', '', '', '', '', '', '', '',
    'ยอดตั้งเบิกโรงงานต้นสังกัด (รายรับ)', '', '', '', '', '', '', '',
    'ผลกำไรส่วนต่าง', ''
  ]

  const headerRow2 = [
    'รหัสงาน', 'แผนก', 'รายละเอียดงาน',
    // Normal Tier
    'ปกติ (ชาย)', 'ปกติ (หญิง)', 'รวมปกติ',
    // Skilled Tier
    'ฝีมือ (ชาย)', 'ฝีมือ (หญิง)', 'รวมฝีมือ',
    'รวมแรงงานทั้งหมด',
    // Wage to Employees
    'อัตราปกติ', 'รวมค่าแรงปกติ',
    'อัตราฝีมือ', 'รวมค่าแรงฝีมือ',
    'OT 1.5x (ชม.)', 'เงิน OT 1.5x',
    'OT 2.0x (ชม.)', 'เงิน OT 2.0x',
    'รวมเงินจ่ายพนักงาน',
    // Billing to Factory
    'อัตราตั้งเบิกปกติ', 'รวมตั้งเบิกปกติ',
    'อัตราตั้งเบิกฝีมือ', 'รวมตั้งเบิกฝีมือ',
    'ตั้งเบิก OT 1.5x', 'ตั้งเบิก OT 2.0x', 'รวมตั้งเบิก OT',
    'รวมเงินตั้งเบิกทั้งหมด',
    // Gross Margin
    'กำไรส่วนต่าง (บาท)', '% กำไร'
  ]

  rows.push(headerRow1)
  rows.push(headerRow2)

  const startRowIndex = 8 // 1-based index in Excel where data begins

  summary.jobGroups.forEach((g) => {
    rows.push([
      g.jobCode,
      g.department,
      g.jobDescription,

      // Shifts
      g.normalMaleShifts,
      g.normalFemaleShifts,
      g.totalNormalShifts,

      g.skilledMaleShifts,
      g.skilledFemaleShifts,
      g.totalSkilledShifts,

      g.totalShifts,

      // Employee Pay
      g.normalRate,
      g.totalNormalWage,

      g.skilledRate,
      g.totalSkilledWage,

      g.ot15Hours,
      g.ot15Pay,

      g.ot20Hours,
      g.ot20Pay,

      g.totalWagePaid,

      // Factory Billing
      g.billingNormalRate,
      g.billingNormalAmount,

      g.billingSkilledRate,
      g.billingSkilledAmount,

      g.ot15BillingAmount,
      g.ot20BillingAmount,
      g.totalOtBillingAmount,

      g.totalBillingAmount,

      // Profit
      g.grossProfit,
      `${g.marginPercent.toFixed(2)}%`
    ])
  })

  // Grand Total Row
  const endRowIndex = startRowIndex + summary.jobGroups.length - 1
  if (summary.jobGroups.length > 0) {
    rows.push([
      'รวมทั้งสิ้น (Grand Total)', '', '',
      // Shifts sums
      { f: `SUM(D${startRowIndex}:D${endRowIndex})` },
      { f: `SUM(E${startRowIndex}:E${endRowIndex})` },
      { f: `SUM(F${startRowIndex}:F${endRowIndex})` },
      { f: `SUM(G${startRowIndex}:G${endRowIndex})` },
      { f: `SUM(H${startRowIndex}:H${endRowIndex})` },
      { f: `SUM(I${startRowIndex}:I${endRowIndex})` },
      { f: `SUM(J${startRowIndex}:J${endRowIndex})` },

      // Wage paid sums
      '',
      { f: `SUM(L${startRowIndex}:L${endRowIndex})` },
      '',
      { f: `SUM(N${startRowIndex}:N${endRowIndex})` },
      { f: `SUM(O${startRowIndex}:O${endRowIndex})` },
      { f: `SUM(P${startRowIndex}:P${endRowIndex})` },
      { f: `SUM(Q${startRowIndex}:Q${endRowIndex})` },
      { f: `SUM(R${startRowIndex}:R${endRowIndex})` },
      { f: `SUM(S${startRowIndex}:S${endRowIndex})` },

      // Billing sums
      '',
      { f: `SUM(U${startRowIndex}:U${endRowIndex})` },
      '',
      { f: `SUM(W${startRowIndex}:W${endRowIndex})` },
      { f: `SUM(X${startRowIndex}:X${endRowIndex})` },
      { f: `SUM(Y${startRowIndex}:Y${endRowIndex})` },
      { f: `SUM(Z${startRowIndex}:Z${endRowIndex})` },
      { f: `SUM(AA${startRowIndex}:AA${endRowIndex})` },

      // Profit sums
      { f: `SUM(AB${startRowIndex}:AB${endRowIndex})` },
      `${summary.overallMarginPercent.toFixed(2)}%`
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column Widths
  ws['!cols'] = [
    { wch: 14 }, // A: jobCode
    { wch: 16 }, // B: department
    { wch: 22 }, // C: jobDescription
    { wch: 11 }, // D: normal M
    { wch: 11 }, // E: normal F
    { wch: 11 }, // F: total normal
    { wch: 11 }, // G: skilled M
    { wch: 11 }, // H: skilled F
    { wch: 11 }, // I: total skilled
    { wch: 14 }, // J: total shifts
    { wch: 11 }, // K: normal rate
    { wch: 14 }, // L: total normal wage
    { wch: 11 }, // M: skilled rate
    { wch: 14 }, // N: total skilled wage
    { wch: 12 }, // O: ot 1.5 hrs
    { wch: 14 }, // P: ot 1.5 pay
    { wch: 12 }, // Q: ot 2.0 hrs
    { wch: 14 }, // R: ot 2.0 pay
    { wch: 17 }, // S: total wage paid
    { wch: 14 }, // T: billing normal rate
    { wch: 16 }, // U: total billing normal
    { wch: 14 }, // V: billing skilled rate
    { wch: 16 }, // W: total billing skilled
    { wch: 18 }, // X: ot 1.5 billing
    { wch: 18 }, // Y: ot 2.0 billing
    { wch: 16 }, // Z: total ot billing
    { wch: 18 }, // AA: total billing
    { wch: 16 }, // AB: gross profit
    { wch: 11 }, // AC: margin %
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'วางบิลเบิกโรงงาน')

  const safeFilename = filename || `Factory_Billing_${summary.periodLabel.replace(/[\s/\\–—]/g, '_')}.xlsx`
  XLSX.writeFile(wb, safeFilename)
}
