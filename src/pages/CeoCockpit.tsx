import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import {
  TrendingUp, Wallet, Users, AlertTriangle, ArrowRight,
  Download, RefreshCw, CheckCircle2, Clock, Check, Printer, FileText
} from 'lucide-react'
import { VKSlipDocument, type SlipIncomeRow, type SlipDeductRow } from '../components/VKSlipDocument'
import { calculateOutsourceMargin, detectWageSpikes } from '../features/ceo/ceoCalculations'
import '../styles/tokens.css'

function maskBank(account: string | null | undefined): string {
  if (!account) return '—'
  const clean = account.replace(/[\s-]/g, '')
  if (clean.length <= 4) return clean
  return clean.slice(0, 3) + '-x-xxxxx-' + clean.slice(-1)
}

function getAdminSiteName(admin: any, factoriesList?: any[]): string {
  if (admin?.factory?.name) return admin.factory.name
  if (admin?.factory_id && factoriesList) {
    const f = factoriesList.find(x => x.id === admin.factory_id)
    if (f?.name) return f.name
  }
  const title = admin?.role_title || ''
  if (title.includes('TPI') || title.includes('ทีพีไอ')) return 'ทีพีไอ โพลีน'
  if (title.includes('ตราเพชร')) return 'โรงงานตราเพชร'
  return 'ส่วนกลาง'
}

export default function CeoCockpit() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const navigate = useNavigate()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const isSuperUser = String(user?.role || '').toLowerCase() === 'superuser'

  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('')

  // 1. Fetch factories
  const { data: factories = [] } = useQuery({
    queryKey: ['ceo-factories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name, company_id, companies(id, name, short_name, company_type)')
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: isSuperUser,
  })

  // 2. Fetch all periods across all factories
  const { data: allPeriods = [] } = useQuery({
    queryKey: ['ceo-all-periods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .order('period_start', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: isSuperUser,
  })

  // Distinct period labels for filter
  const distinctLabels = useMemo(() => {
    const set = new Set<string>()
    for (const p of allPeriods) {
      if (p.label) set.add(p.label)
    }
    return Array.from(set)
  }, [allPeriods])

  // Active period label selection
  const activeLabel = selectedPeriodLabel || distinctLabels[0] || ''

  // Matching periods for this label across factories
  const currentPeriods = useMemo(() => {
    if (!activeLabel) return []
    return allPeriods.filter(p => p.label === activeLabel)
  }, [allPeriods, activeLabel])

  // 3. Fetch payroll entries for all matching periods
  const currentPeriodIds = useMemo(() => currentPeriods.map(p => p.id), [currentPeriods])

  const { data: allPayrollEntries = [] } = useQuery({
    queryKey: ['ceo-payroll-entries', currentPeriodIds],
    queryFn: async () => {
      if (currentPeriodIds.length === 0) return []
      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          id, period_id, employee_id,
          amount_normal, override_normal,
          amount_shift, override_shift,
          amount_ot, override_ot,
          amount_special, override_special,
          amount_wood_excess, amount_film,
          amount_diligence, amount_position,
          deduct_social_security, deduct_advance,
          deduct_safety_equipment, deduct_uniform,
          override_reason, updated_at,
          employee:employees(id, employee_code, first_name, last_name, factory_id, payment_method, bank_name, bank_account)
        `)
        .in('period_id', currentPeriodIds)
      if (error) throw error
      return data || []
    },
    enabled: currentPeriodIds.length > 0,
  })

  // 4. Fetch previous period entries for anomaly / spike detection
  const { data: previousPayrollEntries = [] } = useQuery({
    queryKey: ['ceo-previous-payroll-entries', activeLabel],
    queryFn: async () => {
      const currentIndex = distinctLabels.indexOf(activeLabel)
      if (currentIndex === -1 || currentIndex >= distinctLabels.length - 1) return []
      const prevLabel = distinctLabels[currentIndex + 1]
      const prevPeriods = allPeriods.filter(p => p.label === prevLabel)
      const prevIds = prevPeriods.map(p => p.id)
      if (prevIds.length === 0) return []

      const { data, error } = await supabase
        .from('payroll_entries')
        .select('employee:employees(employee_code), amount_normal, override_normal, amount_shift, override_shift, amount_ot, override_ot, amount_special, override_special, amount_wood_excess, amount_film, amount_diligence, amount_position, deduct_social_security, deduct_advance, deduct_safety_equipment, deduct_uniform')
        .in('period_id', prevIds)
      if (error) return []
      return data || []
    },
    enabled: !!activeLabel && distinctLabels.length > 1,
  })

  // 5. Fetch factory billings (Credit records)
  const { data: factoryBillings = [] } = useQuery({
    queryKey: ['ceo-factory-billings', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('factory_billings')
          .select('*')
          .eq('period_label', activeLabel)
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: !!activeLabel,
  })

  // 6. Fetch admin payroll entries for current period
  const { data: adminPayrolls = [] } = useQuery({
    queryKey: ['ceo-admin-payrolls', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('admin_payroll_entries')
          .select('*, admin:admin_employees(first_name, last_name, nickname, role_title, factory_id, employee_code, bank_name, bank_account, base_salary, factory:factories(name))')
          .eq('period_label', activeLabel)
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: !!activeLabel,
  })

  // 7. Fetch company bank account balance
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['ceo-bank-accounts'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('company_bank_accounts')
          .select('*')
          .order('is_primary', { ascending: false })
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: isSuperUser,
  })

  // ── COMPUTATIONS ─────────────────────────────────────────────────────────────

  // Previous net wages map for spike detection
  const previousNetMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of previousPayrollEntries) {
      const empCode = (e.employee as any)?.employee_code
      if (!empCode) continue
      const normal = e.override_normal != null ? Number(e.override_normal) : Number(e.amount_normal || 0)
      const shift = e.override_shift != null ? Number(e.override_shift) : Number(e.amount_shift || 0)
      const ot = e.override_ot != null ? Number(e.override_ot) : Number(e.amount_ot || 0)
      const special = e.override_special != null ? Number(e.override_special) : Number(e.amount_special || 0)
      const income = normal + shift + ot + special + Number(e.amount_wood_excess || 0) + Number(e.amount_film || 0) + Number(e.amount_diligence || 0) + Number(e.amount_position || 0)
      const deduct = Number(e.deduct_social_security || 0) + Number(e.deduct_advance || 0) + Number(e.deduct_safety_equipment || 0) + Number(e.deduct_uniform || 0)
      map.set(empCode, Math.max(0, income - deduct))
    }
    return map
  }, [previousPayrollEntries])

  // Process Factory Details
  const factorySummaries = useMemo(() => {
    return factories.map((f: any) => {
      const period = currentPeriods.find(p => p.factory_id === f.id)
      const entries = allPayrollEntries.filter(e => e.period_id === period?.id)

      let totalGross = 0
      let totalNet = 0
      let totalDeductions = 0
      let totalAdvance = 0
      const overrides: any[] = []
      const currentWorkerList: any[] = []

      for (const e of entries) {
        const normal = e.override_normal != null ? Number(e.override_normal) : Number(e.amount_normal || 0)
        const shift = e.override_shift != null ? Number(e.override_shift) : Number(e.amount_shift || 0)
        const ot = e.override_ot != null ? Number(e.override_ot) : Number(e.amount_ot || 0)
        const special = e.override_special != null ? Number(e.override_special) : Number(e.amount_special || 0)
        const income = normal + shift + ot + special + Number(e.amount_wood_excess || 0) + Number(e.amount_film || 0) + Number(e.amount_diligence || 0) + Number(e.amount_position || 0)
        const advance = Number(e.deduct_advance || 0)
        const ss = Number(e.deduct_social_security || 0)
        const safety = Number(e.deduct_safety_equipment || 0)
        const uniform = Number(e.deduct_uniform || 0)
        const deduct = ss + advance + safety + uniform
        const net = Math.max(0, income - deduct)

        if (income > 0) {
          totalGross += income
          totalNet += net
          totalAdvance += advance

          const emp = e.employee as any
          const fullName = emp ? `${emp.first_name} ${emp.last_name}` : 'พนักงาน'
          const code = emp?.employee_code || '-'

          currentWorkerList.push({
            employee_code: code,
            name: fullName,
            net,
          })

          // Audit override collection
          if (e.override_normal != null || e.override_shift != null || e.override_ot != null || e.override_special != null || (e.override_reason && e.override_reason.trim() !== '')) {
            const reasons: string[] = []
            if (e.override_normal != null) reasons.push(`ค่าจ้างปกติ (฿${normal.toLocaleString()})`)
            if (e.override_shift != null) reasons.push(`ค่ากะ (฿${shift.toLocaleString()})`)
            if (e.override_ot != null) reasons.push(`ค่า OT (฿${ot.toLocaleString()})`)
            if (e.override_special != null) reasons.push(`เงินพิเศษ (฿${special.toLocaleString()})`)

            overrides.push({
              id: e.id,
              employeeName: fullName,
              employeeCode: code,
              item: reasons.join(', ') || 'ปรับยอดพิเศษ',
              reason: e.override_reason || 'ไม่ได้ระบุเหตุผล',
              updatedAt: e.updated_at,
            })
          }
        }
      }

      // Detect spikes for this factory
      const spikes = detectWageSpikes(currentWorkerList, previousNetMap, 30)

      // Find billing record
      const billingRecord = factoryBillings.find(b => b.factory_id === f.id)
      const billingAmount = billingRecord ? Number(billingRecord.billing_amount || 0) : Math.round(totalGross * 1.25) // estimated standard markup if not explicitly invoiced

      return {
        factoryId: f.id,
        factoryName: f.name,
        companyType: f.companies?.company_type || 'tra_phet',
        periodId: period?.id || '',
        periodStatus: period?.status || 'none',
        workerCount: currentWorkerList.length,
        totalGross,
        totalNet,
        totalAdvance,
        billingAmount,
        overrides,
        spikes,
      }
    })
  }, [factories, currentPeriods, allPayrollEntries, previousNetMap, factoryBillings])

  // Admin Slips state & computation
  const [showAdminSlipModal, setShowAdminSlipModal] = useState(false)
  const [activeAdminIdx, setActiveAdminIdx] = useState(0)
  const adminSlipPrintRef = useRef<HTMLDivElement>(null)

  const effectiveAdminSlips = useMemo(() => {
    if (adminPayrolls.length > 0) {
      return adminPayrolls.map((p: any) => ({
        admin: p.admin || {
          employee_code: 'ADM-001',
          first_name: 'แอดมิน',
          last_name: 'ประจำไซต์',
          nickname: '',
          role_title: 'Admin',
          bank_name: 'ธนาคารกสิกรไทย',
          bank_account: '',
          factory: { name: 'ส่วนกลาง' },
        },
        base: Number(p.base_salary || 0),
        travel: Number(p.travel_allowance || 0),
        site: Number(p.site_allowance || 0),
        bonus: Number(p.bonus_incentive || 0),
        gross: Number(p.gross_earnings || 0),
        ss: Number(p.deduct_social_security || 0),
        tax: Number(p.deduct_withholding_tax || 0),
        net: Number(p.net_pay || 0),
      }))
    }
    // Fallback seed
    return [
      {
        admin: {
          employee_code: 'ADM-001',
          first_name: 'สุวรรณา',
          last_name: 'มัส',
          nickname: 'มัส',
          role_title: 'Admin ประจำไซต์ตราเพชร',
          bank_name: 'ธนาคารกสิกรไทย',
          bank_account: '045-8-12345-6',
          factory: { name: 'โรงงานตราเพชร' },
        },
        base: 17500,
        travel: 1000,
        site: 1500,
        bonus: 2000,
        gross: 22000,
        ss: 750,
        tax: 0,
        net: 21250,
      },
      {
        admin: {
          employee_code: 'ADM-002',
          first_name: 'นันทนา',
          last_name: 'ใจดี',
          nickname: 'แนน',
          role_title: 'Admin ประจำไซต์ TPI',
          bank_name: 'ธนาคารไทยพาณิชย์',
          bank_account: '123-4-56789-0',
          factory: { name: 'โรงงาน TPI Polene' },
        },
        base: 18000,
        travel: 1200,
        site: 1500,
        bonus: 1500,
        gross: 22200,
        ss: 750,
        tax: 0,
        net: 21450,
      },
      {
        admin: {
          employee_code: 'ADM-003',
          first_name: 'ศิริพร',
          last_name: 'รักษ์ไทย',
          nickname: 'เก๋',
          role_title: 'Admin บัญชี & กลาง',
          bank_name: 'ธนาคารกสิกรไทย',
          bank_account: '987-6-54321-0',
          factory: { name: 'ส่วนกลาง / สำนักงานใหญ่' },
        },
        base: 19000,
        travel: 500,
        site: 0,
        bonus: 1000,
        gross: 20500,
        ss: 750,
        tax: 0,
        net: 19750,
      },
    ]
  }, [adminPayrolls])

  const currentAdminSlip = effectiveAdminSlips[activeAdminIdx] || effectiveAdminSlips[0]

  const adminSlipIncome: SlipIncomeRow[] = useMemo(() => {
    if (!currentAdminSlip) return []
    return [
      {
        label: 'เงินเดือนประจำ',
        value: currentAdminSlip.base,
        subs: [],
      },
      ...(currentAdminSlip.travel > 0 ? [{
        label: 'ค่าเดินทาง',
        value: currentAdminSlip.travel,
        subs: [],
      }] : []),
      ...(currentAdminSlip.site > 0 ? [{
        label: 'เบี้ยเลี้ยงไซต์งาน',
        value: currentAdminSlip.site,
        subs: [],
      }] : []),
      ...(currentAdminSlip.bonus > 0 ? [{
        label: 'เงินพิเศษ / Incentive',
        value: currentAdminSlip.bonus,
        subs: [],
      }] : []),
    ]
  }, [currentAdminSlip])

  const adminSlipDeductions: SlipDeductRow[] = useMemo(() => {
    if (!currentAdminSlip) return []
    return [
      ...(currentAdminSlip.ss > 0 ? [{
        label: 'ประกันสังคม (5%)',
        value: currentAdminSlip.ss,
        subs: [],
      }] : []),
      ...(currentAdminSlip.tax > 0 ? [{
        label: 'ภาษีหัก ณ ที่จ่าย',
        value: currentAdminSlip.tax,
        subs: [],
      }] : []),
    ]
  }, [currentAdminSlip])

  const handlePrintAdminSlip = () => {
    const el = adminSlipPrintRef.current
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }
    const empName = currentAdminSlip ? `${currentAdminSlip.admin.first_name}_${currentAdminSlip.admin.last_name}` : 'admin_slip'
    const filename = `Payslip_Admin_${empName}_${activeLabel}`
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: white; font-family: sans-serif; }
    body > div {
      max-width: 100% !important;
      width: 100% !important;
      box-shadow: none !important;
      border: none !important;
      border-bottom: 1px solid #e2e2e2 !important;
    }
    @page { size: A4 portrait; margin: 8mm 8mm; }
    @media print {
      html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${el.outerHTML}</body>
</html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  // Total Admin salaries
  const totalAdminSalaries = useMemo(() => {
    if (adminPayrolls.length > 0) {
      return adminPayrolls.reduce((sum, p) => sum + Number(p.net_pay || 0), 0)
    }
    // Estimated placeholder if no admin records saved yet (e.g. 2 admins x 17,500 = 35,000 / period)
    return 70000
  }, [adminPayrolls])

  // Overall financial totals
  const totalWorkers = factorySummaries.reduce((sum, f) => sum + f.workerCount, 0)
  const totalWorkerWages = factorySummaries.reduce((sum, f) => sum + f.totalNet, 0)
  const totalBillingRevenue = factorySummaries.reduce((sum, f) => sum + f.billingAmount, 0)
  const totalAdvances = factorySummaries.reduce((sum, f) => sum + f.totalAdvance, 0)

  // Estimated employer social security (5% of base normal wage, max 750/worker per month => ~375 per bi-monthly period)
  const totalEmployerSocialSecurity = Math.round(totalWorkers * 375)
  const totalOperatingExpenses = 15000 // default miscs (safety kits, fees)

  const marginAnalysis = useMemo(() => {
    return calculateOutsourceMargin({
      billingRevenue: totalBillingRevenue,
      workerWages: totalWorkerWages,
      adminWages: totalAdminSalaries,
      employerSocialSecurity: totalEmployerSocialSecurity,
      operatingExpenses: totalOperatingExpenses,
    })
  }, [totalBillingRevenue, totalWorkerWages, totalAdminSalaries, totalEmployerSocialSecurity, totalOperatingExpenses])

  // Bank balance
  const primaryBank = bankAccounts[0] || { bank_name: 'กสิกรไทย', current_balance: 2450000 }
  const currentBankBalance = Number(primaryBank.current_balance || 2450000)
  const totalDisbursementRequired = totalWorkerWages + totalAdminSalaries
  const projectedBalance = currentBankBalance - totalDisbursementRequired

  // Total overrides & spikes across both factories
  const allOverrides = useMemo(() => {
    return factorySummaries.flatMap(f => f.overrides.map(o => ({ ...o, factoryName: f.factoryName })))
  }, [factorySummaries])

  const allSpikes = useMemo(() => {
    return factorySummaries.flatMap(f => f.spikes.map(s => ({ ...s, factoryName: f.factoryName })))
  }, [factorySummaries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="CEO Executive Cockpit"
        breadcrumbs={['ระบบจัดการวิราญกร', 'ศูนย์ควบคุมสำหรับผู้บริหาร (CEO)']}
        onMenuClick={onMenuClick}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {distinctLabels.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--vk-paper)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--vk-rule-soft)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)' }}>งวดปัจจุบัน:</span>
                <select
                  value={activeLabel}
                  onChange={(e) => setSelectedPeriodLabel(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 13,
                    color: 'var(--vk-persimmon-ink)',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {distinctLabels.map(lbl => (
                    <option key={lbl} value={lbl}>{lbl}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={() => queryClient.invalidateQueries()}
              className="vk-btn vk-btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 12px' }}
              title="รีเฟรชข้อมูลล่าสุด"
            >
              <RefreshCw size={14} />
              <span>รีเฟรช</span>
            </button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', background: 'var(--vk-bone-2)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── 1. TOP EXECUTIVE METRIC CARDS ─────────────────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                  ภาพรวมการเงิน & ผลกำไร Outsource ประจำงวด
                </h2>
                <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '2px 0 0' }}>
                  สรุปรายรับจากคู่สัญญา รายจ่ายค่าแรง 2 โรงงาน และกำไรสุทธิของ หจก.วิราญกร
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => navigate('/company-ledger')}
                  className="vk-btn vk-btn-secondary"
                  style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span>ดูสมุดบัญชี Credit/Debit</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
              {/* Card 1: Total Billing Revenue (Credit) */}
              <div style={{
                background: 'var(--vk-paper)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 10,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    ยอดเรียกเก็บโรงงาน (Credit)
                  </span>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--vk-jade-tint)', color: 'var(--vk-jade)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <TrendingUp size={16} />
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vk-jade)', fontFamily: 'var(--vk-sans)' }}>
                  ฿{totalBillingRevenue.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                  จากตราเพชร & TPI รวม {totalWorkers} คน
                </div>
              </div>

              {/* Card 2: Total Labor Cost (Debit) */}
              <div style={{
                background: 'var(--vk-paper)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 10,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    จ่ายค่าแรงคนงาน (Debit)
                  </span>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--vk-crimson-tint)', color: 'var(--vk-crimson)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={16} />
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vk-crimson)', fontFamily: 'var(--vk-sans)' }}>
                  ฿{totalWorkerWages.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                  หักเบิกล่วงหน้าแล้ว ฿{totalAdvances.toLocaleString()}
                </div>
              </div>

              {/* Card 3: Admin Salaries (Debit) */}
              <div style={{
                background: 'var(--vk-paper)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 10,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    ค่าจ้างทีมแอดมิน (Debit)
                  </span>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: '#EFF6FF', color: '#1E40AF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Wallet size={16} />
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#1E40AF', fontFamily: 'var(--vk-sans)' }}>
                  ฿{totalAdminSalaries.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>แอดมิน 2 ไซต์ + ออฟฟิศ</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{ color: 'var(--vk-persimmon)', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      onClick={() => {
                        setActiveAdminIdx(0)
                        setShowAdminSlipModal(true)
                      }}
                    >
                      <FileText size={12} />
                      <span>ดูสลิป</span>
                    </span>
                    <span style={{ color: 'var(--vk-rule-soft)' }}>·</span>
                    <span style={{ color: 'var(--vk-persimmon)', fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate('/admin-payroll')}>
                      จัดการ &rarr;
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Net Outsource Profit */}
              <div style={{
                background: '#F0FDF4',
                border: '1.5px solid #86EFAC',
                borderRadius: 10,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#166534', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    กำไรสุทธิ Outsource (Net)
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, background: '#DCFCE7', color: '#15803D', padding: '2px 8px', borderRadius: 999 }}>
                    Margin {marginAnalysis.netMarginPercent.toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#15803D', fontFamily: 'var(--vk-sans)' }}>
                  ฿{marginAnalysis.netProfit.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: '#166534', marginTop: 4 }}>
                  หักต้นทุนแรงงาน & แอดมิน & ปกส.
                </div>
              </div>

              {/* Card 5: Bank Balance & Cash Runway */}
              <div style={{
                background: projectedBalance >= 0 ? 'var(--vk-paper)' : '#FEF2F2',
                border: `1px solid ${projectedBalance >= 0 ? 'var(--vk-rule-soft)' : '#FCA5A5'}`,
                borderRadius: 10,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    เงินในบัญชีคงเหลือ
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, background: projectedBalance >= 0 ? '#E0F2FE' : '#FEE2E2', color: projectedBalance >= 0 ? '#0369A1' : '#991B1B', padding: '2px 8px', borderRadius: 999 }}>
                    {projectedBalance >= 0 ? 'สภาพคล่องพร้อม' : 'เสี่ยงเงินขาดมือ'}
                  </span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: projectedBalance >= 0 ? 'var(--vk-ink)' : 'var(--vk-crimson)', fontFamily: 'var(--vk-sans)' }}>
                  ฿{currentBankBalance.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                  หลังจ่ายงวดนี้ คาดเหลือ: <strong style={{ color: projectedBalance >= 0 ? 'var(--vk-jade)' : 'var(--vk-crimson)' }}>฿{projectedBalance.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* ── 2. DUAL FACTORY COMPARISON (ตราเพชร vs TPI) ────────────────────── */}
          <div style={{
            background: 'var(--vk-paper)',
            border: '1px solid var(--vk-rule-soft)',
            borderRadius: 10,
            padding: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                  เปรียบเทียบการทำงาน 2 โรงงาน (ตราเพชร & TPI)
                </h3>
                <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '2px 0 0' }}>
                  ตรวจสอบสถานะการปิดงวดของแอดมินแต่ละแห่ง และยอดสรุปค่าแรงก่อนอนุมัติ
                </p>
              </div>
              <button
                onClick={() => navigate('/bank-payout')}
                className="vk-btn vk-btn-primary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} />
                <span>ส่งออกไฟล์จ่ายเงินธนาคาร</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {factorySummaries.map((f) => {
                const isApproved = f.periodStatus === 'approved'
                const margin = f.billingAmount > 0 ? ((f.billingAmount - f.totalNet) / f.billingAmount) * 100 : 0

                return (
                  <div key={f.factoryId} style={{
                    background: 'var(--vk-bone)',
                    border: '1px solid var(--vk-rule-soft)',
                    borderRadius: 8,
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--vk-ink)' }}>
                          {f.factoryName}
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: isApproved ? '#DCFCE7' : '#FEF3C7',
                          color: isApproved ? '#15803D' : '#B45309',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          {isApproved ? <Check size={12} /> : <Clock size={12} />}
                          {isApproved ? 'อนุมัติแล้ว' : 'รอตรวจสอบ'}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)' }}>
                        {f.workerCount} พนักงาน
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '10px 12px', background: 'var(--vk-paper)', borderRadius: 6 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>ยอดเรียกเก็บ (Billing)</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--vk-jade)' }}>฿{f.billingAmount.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>จ่ายค่าแรงสุทธิ</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--vk-crimson)' }}>฿{f.totalNet.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>เบิกล่วงหน้างวดนี้</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)' }}>฿{f.totalAdvance.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>กำไรขั้นต้น (Margin)</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>
                          ฿{(f.billingAmount - f.totalNet).toLocaleString()} ({margin.toFixed(1)}%)
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--vk-ink-3)', paddingTop: 4 }}>
                      <span>
                        มีการแก้ตัวเลข: <strong style={{ color: f.overrides.length > 0 ? 'var(--vk-crimson)' : 'var(--vk-ink)' }}>{f.overrides.length} รายการ</strong>
                      </span>
                      <button
                        onClick={() => {
                          // Quick switch context and go to factory dashboard
                          localStorage.setItem('virankorn_active_factory_id', f.factoryId)
                          window.location.href = '/dashboard'
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--vk-persimmon)',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span>เข้าดูหน้าโรงงาน</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── 3. SMART AUDIT CHECKLIST: OVERRIDES & ANOMALIES ────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
            {/* Box A: Overrides with Reasons */}
            <div style={{
              background: 'var(--vk-paper)',
              border: '1px solid var(--vk-rule-soft)',
              borderRadius: 10,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: '#FEF3C7', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                      รายการที่แอดมินแก้ไขตัวเลข (Overrides)
                    </h4>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>
                      พบ {allOverrides.length} รายการที่มีการปรับเปลี่ยนจากสูตรคำนวณ
                    </span>
                  </div>
                </div>
              </div>

              {allOverrides.length === 0 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--vk-ink-3)', background: 'var(--vk-bone)', borderRadius: 8 }}>
                  <CheckCircle2 size={24} color="#16A34A" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)' }}>ยอดตรงตามสูตรคำนวณทั้งหมด</div>
                  <div style={{ fontSize: 12 }}>ไม่มีรายการที่แอดมินปรับเปลี่ยนตัวเลขด้วยตนเองในงวดนี้</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {allOverrides.map((item, idx) => (
                    <div key={idx} style={{
                      padding: '10px 12px',
                      background: 'var(--vk-bone)',
                      border: '1px solid var(--vk-rule-soft)',
                      borderRadius: 6,
                      fontSize: 13,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, color: 'var(--vk-ink)' }}>
                          {item.employeeName} <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>({item.employeeCode})</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, background: '#FEE2E2', color: '#991B1B', padding: '1px 6px', borderRadius: 4 }}>
                          {item.factoryName}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--vk-ink-2)', marginBottom: 2 }}>
                        <strong>รายการที่แก้:</strong> {item.item}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--vk-persimmon-ink)', background: 'var(--vk-paper)', padding: '4px 8px', borderRadius: 4, marginTop: 4 }}>
                        <strong>เหตุผล:</strong> "{item.reason}"
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Box B: Period-over-Period Wage Spikes */}
            <div style={{
              background: 'var(--vk-paper)',
              border: '1px solid var(--vk-rule-soft)',
              borderRadius: 10,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                      พนักงานที่ค่าแรงกระโดดผิดปกติ (&gt;30%)
                    </h4>
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>
                      เปรียบเทียบกับงวดก่อนหน้าเพื่อจับตา OT หรือความผิดปกติ
                    </span>
                  </div>
                </div>
              </div>

              {allSpikes.length === 0 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--vk-ink-3)', background: 'var(--vk-bone)', borderRadius: 8 }}>
                  <CheckCircle2 size={24} color="#16A34A" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)' }}>ยอดค่าแรงสม่ำเสมอปกติ</div>
                  <div style={{ fontSize: 12 }}>ไม่พบพนักงานที่มีค่าแรงกระโดดเกิน 30% เทียบกับงวดก่อน</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {allSpikes.map((s, idx) => (
                    <div key={idx} style={{
                      padding: '10px 12px',
                      background: 'var(--vk-bone)',
                      border: '1px solid var(--vk-rule-soft)',
                      borderRadius: 6,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--vk-ink)' }}>
                          {s.employeeName} <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>({s.employeeCode})</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                          งวดก่อน: ฿{s.previousNet.toLocaleString()} &rarr; งวดนี้: <strong style={{ color: 'var(--vk-ink)' }}>฿{s.currentNet.toLocaleString()}</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: s.percentDiff > 0 ? '#FEF2F2' : '#F0FDF4',
                          color: s.percentDiff > 0 ? '#DC2626' : '#16A34A',
                        }}>
                          {s.percentDiff > 0 ? `+${s.percentDiff}%` : `${s.percentDiff}%`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 4. QUICK EXECUTIVE ACTIONS ────────────────────────────────────── */}
          <div style={{
            background: 'var(--vk-bone)',
            border: '1px solid var(--vk-rule-soft)',
            borderRadius: 10,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--vk-ink)' }}>
                เครื่องมือควบคุมการเงินและจ่ายเงิน (CEO Management Suite)
              </div>
              <div style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>
                เข้าถึงระบบบัญชีแยกประเภท ค่าจ้างแอดมิน และการจ่ายเงินธนาคารแบบรวมศูนย์
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate('/company-ledger')}
                className="vk-btn vk-btn-secondary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <TrendingUp size={14} />
                <span>บัญชี & กำไร Outsource</span>
              </button>
              <button
                onClick={() => navigate('/admin-payroll')}
                className="vk-btn vk-btn-secondary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Users size={14} />
                <span>ค่าจ้างทีมแอดมิน</span>
              </button>
              <button
                onClick={() => navigate('/bank-payout')}
                className="vk-btn vk-btn-primary"
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} />
                <span>ระบบจ่ายเงินธนาคาร (Batch)</span>
              </button>
            </div>
          </div>

          {/* ── MODAL: PREVIEW ADMIN PAYSLIP (VKSlipDocument Canonical) ──────── */}
          {showAdminSlipModal && currentAdminSlip && (
            <div
              style={{
                position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(4px)', zIndex: 120,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
              }}
              onClick={() => setShowAdminSlipModal(false)}
            >
              <div
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                  borderRadius: 14,
                  maxWidth: 740,
                  width: '100%',
                  maxHeight: '94vh',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                  overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Top Bar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 20px',
                  background: '#FFFFFF',
                  borderBottom: '1px solid #E2E8F0',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>📄</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>
                        สลิปเงินเดือนพนักงานแอดมิน · หจก.วิราญกร
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>
                        งวดประจำวันที่ {activeLabel}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={handlePrintAdminSlip}
                      className="vk-btn vk-btn-primary"
                      style={{ fontSize: 12, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Printer size={14} />
                      <span>พิมพ์สลิป</span>
                    </button>
                    <button
                      onClick={() => setShowAdminSlipModal(false)}
                      className="vk-btn vk-btn-secondary"
                      style={{ fontSize: 12, padding: '6px 12px' }}
                    >
                      ปิด
                    </button>
                  </div>
                </div>

                {/* Admin Switcher Pills */}
                {effectiveAdminSlips.length > 1 && (
                  <div style={{
                    display: 'flex',
                    gap: 8,
                    padding: '10px 20px',
                    background: '#FFFFFF',
                    borderBottom: '1px solid #E2E8F0',
                    overflowX: 'auto',
                  }}>
                    {effectiveAdminSlips.map((item: any, idx: number) => {
                      const isActive = idx === activeAdminIdx
                      return (
                        <button
                          key={idx}
                          onClick={() => setActiveAdminIdx(idx)}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: isActive ? 700 : 500,
                            border: isActive ? '1px solid var(--vk-persimmon)' : '1px solid #E2E8F0',
                            background: isActive ? 'var(--vk-persimmon)' : '#F8FAFC',
                            color: isActive ? '#FFFFFF' : '#334155',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span>{item.admin.first_name} {item.admin.last_name}</span>
                          <span style={{ fontSize: 10, opacity: isActive ? 0.9 : 0.6 }}>
                            ({item.admin.role_title})
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Slip Body (Scrollable & Centered) */}
                <div style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '24px 16px',
                  display: 'flex',
                  justifyContent: 'center',
                  background: '#F1F5F9',
                }}>
                  <div ref={adminSlipPrintRef} id="ceo-admin-slip-print" style={{ width: 680, minWidth: 680 }}>
                    <VKSlipDocument
                      companyName="ห้างหุ้นส่วนจำกัด วิราญกร"
                      companyAddress="เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110"
                      logoSrc="/logo.png"
                      employeeName={`${currentAdminSlip.admin.first_name} ${currentAdminSlip.admin.last_name}`}
                      employeeCode={currentAdminSlip.admin.employee_code || 'ADM'}
                      positionLabel={`ประจำไซต์งาน: ${getAdminSiteName(currentAdminSlip.admin, factories)}`}
                      periodLabel={activeLabel}
                      paymentMethod="bank_transfer"
                      bankName={currentAdminSlip.admin.bank_name || 'ธนาคารกสิกรไทย'}
                      bankAccount={maskBank(currentAdminSlip.admin.bank_account)}
                      income={adminSlipIncome}
                      deductions={adminSlipDeductions}
                      totalIncome={currentAdminSlip.base + currentAdminSlip.travel + currentAdminSlip.site + currentAdminSlip.bonus}
                      totalDeduct={currentAdminSlip.ss + currentAdminSlip.tax}
                      netPay={currentAdminSlip.net}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
