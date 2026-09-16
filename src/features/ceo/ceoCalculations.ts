/**
 * ceoCalculations.ts
 * Business logic and helper functions for Phase 3: CEO Cockpit & Outsource Financial Hub
 * Virankorn Payroll System
 */

export interface FactoryPeriodSummary {
  factoryId: string
  factoryName: string
  companyType: string // 'tra_phet' | 'tpi'
  periodId: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  status: 'draft' | 'approved'
  totalWorkers: number
  totalShifts: number
  totalGrossWage: number
  totalDeductions: number
  totalNetWage: number
  advanceCount: number
  totalAdvanceAmount: number
  overrideCount: number
  overrides: Array<{
    id: string
    employeeName: string
    employeeCode: string
    item: string
    oldVal?: number | null
    newVal?: number | null
    reason: string
    updatedAt?: string
  }>
  spikes: Array<{
    employeeName: string
    employeeCode: string
    previousNet: number
    currentNet: number
    percentDiff: number
  }>
}

export interface CeoConsolidatedOverview {
  periodLabel: string
  periodStart: string
  periodEnd: string
  factories: FactoryPeriodSummary[]
  totalBillingRevenue: number
  totalWorkerWages: number
  totalAdminWages: number
  totalEmployerSocialSecurity: number
  totalOperatingExpenses: number
  grossProfit: number
  grossMarginPercent: number
  netProfit: number
  netMarginPercent: number
  bankBalance: number
  projectedBalanceAfterPayout: number
}

/**
 * Calculates net profit and margins for outsource operations
 */
export function calculateOutsourceMargin(params: {
  billingRevenue: number
  workerWages: number
  adminWages: number
  employerSocialSecurity: number
  operatingExpenses: number
}) {
  const { billingRevenue, workerWages, adminWages, employerSocialSecurity, operatingExpenses } = params
  const grossProfit = Math.max(0, billingRevenue - workerWages)
  const grossMarginPercent = billingRevenue > 0 ? (grossProfit / billingRevenue) * 100 : 0

  const totalCost = workerWages + adminWages + employerSocialSecurity + operatingExpenses
  const netProfit = billingRevenue - totalCost
  const netMarginPercent = billingRevenue > 0 ? (netProfit / billingRevenue) * 100 : 0

  return {
    grossProfit,
    grossMarginPercent,
    totalCost,
    netProfit,
    netMarginPercent,
  }
}

/**
 * Detects wage anomalies / spikes where current wage differs from previous by > threshold% (default 30%)
 */
export function detectWageSpikes(
  currentEntries: Array<{ employee_code: string; name: string; net: number }>,
  previousEntries: Map<string, number>,
  thresholdPercent = 30
) {
  const spikes: Array<{
    employeeName: string
    employeeCode: string
    previousNet: number
    currentNet: number
    percentDiff: number
  }> = []

  for (const emp of currentEntries) {
    const prev = previousEntries.get(emp.employee_code)
    if (prev && prev > 1000) {
      const diff = emp.net - prev
      const pct = (diff / prev) * 100
      if (Math.abs(pct) >= thresholdPercent) {
        spikes.push({
          employeeName: emp.name,
          employeeCode: emp.employee_code,
          previousNet: prev,
          currentNet: emp.net,
          percentDiff: Math.round(pct),
        })
      }
    }
  }

  return spikes
}

/**
 * Bank Batch Payout Formatter
 * Generates formatted text/CSV files for uploading to business bank portals
 */
export interface BankPayoutRecord {
  category: 'คนงานตราเพชร' | 'คนงาน TPI' | 'แอดมิน / ทีมงาน'
  employeeCode: string
  fullName: string
  nationalId?: string | null
  bankName: string
  bankAccount: string
  netAmount: number
}

export function generateBankBatchCSV(records: BankPayoutRecord[], format: 'kbank' | 'scb' | 'promptpay' | 'standard'): string {
  const cleanAcc = (acc: string) => (acc || '').replace(/[^0-9]/g, '')
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  if (format === 'kbank') {
    // K-Cash Connect / K-Direct Credit CSV Format:
    // Seq, BankCode, AccountNumber, Amount, BeneficiaryName, Ref, IdNum
    const header = 'Seq,BankCode,AccountNo,Amount,ReceiverName,Reference,IDCard\n'
    const rows = records.map((r, idx) => {
      const bankCode = r.bankName.includes('กสิกร') ? '004' : '014' // standard bank routing
      return `${idx + 1},${bankCode},"${cleanAcc(r.bankAccount)}",${r.netAmount.toFixed(2)},"${r.fullName}","PAYROLL-${todayStr}","${r.nationalId || ''}"`
    })
    return header + rows.join('\n')
  }

  if (format === 'scb') {
    // SCB Business Anywhere Payroll format
    const header = 'RecordType,AccountNo,Amount,ReceiverName,BankCode,MobileNo\n'
    const rows = records.map(r => {
      return `D,"${cleanAcc(r.bankAccount)}",${r.netAmount.toFixed(2)},"${r.fullName}","${r.bankName}",""`
    })
    return header + rows.join('\n')
  }

  if (format === 'promptpay') {
    // PromptPay Bulk Transfer (National ID or Mobile)
    const header = 'Seq,RecipientType,TargetID,Amount,RecipientName,Category\n'
    const rows = records.map((r, idx) => {
      const target = r.nationalId || cleanAcc(r.bankAccount)
      return `${idx + 1},CITIZEN_ID,"${target}",${r.netAmount.toFixed(2)},"${r.fullName}","${r.category}"`
    })
    return header + rows.join('\n')
  }

  // Standard Excel CSV
  const header = 'ลำดับ,หมวดหมู่,รหัสพนักงาน,ชื่อ-นามสกุล,ธนาคาร,เลขที่บัญชี,ยอดจ่ายสุทธิ (บาท)\n'
  const rows = records.map((r, idx) => {
    return `${idx + 1},"${r.category}","${r.employeeCode}","${r.fullName}","${r.bankName}","'${cleanAcc(r.bankAccount)}",${r.netAmount.toFixed(2)}`
  })
  return header + rows.join('\n')
}
