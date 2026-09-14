import type { TimesheetBillingReport, EmployeeTimesheetRow } from './tpiTimesheetCalc'

/**
 * Exports 7-Day Employee Timesheet Billing report to Excel matching factory specification
 */
export async function exportEmployeeTimesheetExcel(
  report: TimesheetBillingReport,
  factoryName = 'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)'
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const rows: any[][] = []

  const days = report.dateRange.days
  const dayCount = days.length // typically 7

  // Title Row
  rows.push([factoryName])
  rows.push([`ใบวางบิลเบิกค่าแรงงานรายบุคคล (รอบ 7 วัน: ${report.dateRange.start} ถึง ${report.dateRange.end})`])
  rows.push([])

  function appendSection(sectionTitle: string, workerRows: EmployeeTimesheetRow[], summary: any) {
    // Section Header
    rows.push([sectionTitle])

    // Header Tier 1
    const h1: any[] = ['รหัสแรงงาน', 'ชื่อ - นามสกุล', 'วันที่']
    for (let i = 1; i < dayCount; i++) h1.push('')
    h1.push('ค่าจ้าง')
    h1.push('จำนวนชั่วโมงการทำงาน', '', '', '', '')
    h1.push('จำนวนเงิน', '', '', '', '')
    h1.push('ค่าบริการ', '')
    h1.push('รวมเงิน')
    rows.push(h1)

    // Header Tier 2 (Day names + Subheaders)
    const h2: any[] = ['', '']
    days.forEach(d => h2.push(d.dayName))
    h2.push('')
    h2.push('ปกติ', 'OT 1.5', 'OT 2', 'OT 3', 'รวม')
    h2.push('ปกติ', 'OT 1.5', 'OT 2', 'OT 3', 'รวม')
    h2.push('ค่าจ้างพื้นฐาน', 'ค่าบริการ')
    h2.push('')
    rows.push(h2)

    // Header Tier 3 (Day numbers)
    const h3: any[] = ['', '']
    days.forEach(d => h3.push(d.dayNum))
    for (let i = 0; i < 14; i++) h3.push('')
    rows.push(h3)

    // Worker Rows
    if (workerRows.length === 0) {
      const emptyRow: any[] = ['—', 'ไม่มีรายการ', ...new Array(dayCount + 13).fill('—')]
      rows.push(emptyRow)
    } else {
      workerRows.forEach((r) => {
        const rData: any[] = [
          r.employeeCode,
          r.fullName,
        ]

        // 7 days daily hours
        r.dailyHours.forEach(h => {
          rData.push(h > 0 ? h : '')
        })

        // Base rate
        rData.push(r.dailyRate)

        // Hours
        rData.push(
          r.normalHours > 0 ? r.normalHours : '',
          r.ot15Hours > 0 ? r.ot15Hours : '',
          r.ot20Hours > 0 ? r.ot20Hours : '',
          r.ot30Hours > 0 ? r.ot30Hours : '',
          r.totalHours
        )

        // Wages
        rData.push(
          r.normalWage > 0 ? r.normalWage : '',
          r.ot15Wage > 0 ? r.ot15Wage : '',
          r.ot20Wage > 0 ? r.ot20Wage : '',
          r.ot30Wage > 0 ? r.ot30Wage : '',
          r.totalWage
        )

        // Service Fee
        rData.push(
          r.baseWageForFee > 0 ? r.baseWageForFee : '',
          r.serviceFee > 0 ? r.serviceFee : ''
        )

        // Total Billing
        rData.push(r.totalBillingAmount)

        rows.push(rData)
      })
    }

    // Section Summary Row
    const sumRow: any[] = ['รวม', '']
    summary.totalDailyHours.forEach((h: number) => {
      sumRow.push(h > 0 ? h : '')
    })
    sumRow.push('') // wage
    sumRow.push(
      summary.normalHours || '',
      summary.ot15Hours || '',
      summary.ot20Hours || '',
      summary.ot30Hours || '',
      summary.totalHours || ''
    )
    sumRow.push(
      summary.normalWage || '',
      summary.ot15Wage || '',
      summary.ot20Wage || '',
      summary.ot30Wage || '',
      summary.totalWage || ''
    )
    sumRow.push(
      summary.baseWageForFee || '',
      summary.serviceFee || ''
    )
    sumRow.push(summary.totalBillingAmount || '')
    rows.push(sumRow)
    rows.push([]) // blank line
  }

  // 1. Thai Workers Section
  appendSection('คนงานสัญชาติไทย', report.thaiWorkers, report.thaiSummary)

  // 2. Foreign Workers Section
  appendSection('คนงานต่างด้าว', report.foreignWorkers, report.foreignSummary)

  // 3. Grand Total Row across both nationalities
  const grandRow: any[] = [
    'ยอดรวมทั้งสองสัญชาติ',
    'ตัวอักษร',
    report.grandTotal.bahtText
  ]
  // Pad with empty cells
  const remainingCols = 2 + dayCount + 13 - 4
  for (let i = 0; i < remainingCols; i++) grandRow.push('')
  grandRow.push('รวมเงิน')
  grandRow.push(report.grandTotal.totalBillingAmount)

  rows.push(grandRow)

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column Widths
  const colWidths = [
    { wch: 12 }, // รหัสแรงงาน
    { wch: 24 }, // ชื่อ - นามสกุล
  ]
  // 7 days cols
  for (let i = 0; i < dayCount; i++) {
    colWidths.push({ wch: 6 })
  }
  colWidths.push({ wch: 9 }) // ค่าจ้าง
  // Hours cols
  colWidths.push({ wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 8 })
  // Wage cols
  colWidths.push({ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 11 })
  // Service fee cols
  colWidths.push({ wch: 12 }, { wch: 11 })
  // Total billing
  colWidths.push({ wch: 13 })

  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, 'ใบวางบิล 7 วัน (รายบุคคล)')

  const filename = `TPI_ใบวางบิลรายบุคคล_7วัน_${report.dateRange.start}_ถึง_${report.dateRange.end}.xlsx`
  XLSX.writeFile(wb, filename)
}
