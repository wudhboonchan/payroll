import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import {
  Plus, FileText, Edit, Trash2, RefreshCw, Search, FileSpreadsheet,
  ArrowDownLeft, ArrowUpRight, Wallet, CheckCircle2, AlertTriangle
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { calculateOutsourceMargin } from '../features/ceo/ceoCalculations'
import '../styles/tokens.css'

export const CATEGORY_MAP: Record<string, { label: string; defaultType: 'credit' | 'debit'; color: string }> = {
  billing_income: { label: 'ค่าวางบิลเรียกเก็บโรงงาน', defaultType: 'credit', color: 'var(--vk-jade)' },
  owner_capital: { label: 'เงินโอนเข้าจากกรรมการ/ทุน', defaultType: 'credit', color: 'var(--vk-jade)' },
  other_income: { label: 'รายรับอื่นๆ / ดอกเบี้ยรับ', defaultType: 'credit', color: 'var(--vk-jade)' },
  worker_wages: { label: 'จ่ายค่าแรงคนงาน', defaultType: 'debit', color: 'var(--vk-crimson)' },
  admin_salary: { label: 'จ่ายเงินเดือนทีมแอดมิน', defaultType: 'debit', color: 'var(--vk-crimson)' },
  employer_social_security: { label: 'สมทบประกันสังคมนายจ้าง (5%)', defaultType: 'debit', color: '#B45309' },
  safety_equipment: { label: 'อุปกรณ์ความปลอดภัย / PPE', defaultType: 'debit', color: '#D97706' },
  vehicle_transport: { label: 'ค่ายานพาหนะ / น้ำมัน / เดินทาง', defaultType: 'debit', color: '#2563EB' },
  operating_expense: { label: 'ค่าใช้จ่ายดำเนินงาน / ออฟฟิศ', defaultType: 'debit', color: '#4B5563' },
  withholding_tax: { label: 'ภาษีหัก ณ ที่จ่าย', defaultType: 'debit', color: '#DC2626' },
  other_expense: { label: 'ค่าใช้จ่ายเบ็ดเตล็ดอื่นๆ', defaultType: 'debit', color: '#6B7280' },
}

export default function CompanyLedger() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const isSuperUser = String(user?.role || '').toLowerCase() === 'superuser'

  // Default to 'ledger' as requested
  const [activeTab, setActiveTab] = useState<'ledger' | 'pnl' | 'bank'>('ledger')
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('')

  // Ledger Filter & Search states
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // Transaction Modal State
  const [showTxModal, setShowTxModal] = useState(false)
  const [editingTx, setEditingTx] = useState<any | null>(null)
  const [txForm, setTxForm] = useState({
    type: 'debit' as 'credit' | 'debit',
    category: 'operating_expense',
    amount: '',
    description: '',
    date: new Date().toISOString().slice(0, 10),
    bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
    reference_no: '',
  })

  const [editingBilling, setEditingBilling] = useState<any | null>(null)
  const [billingForm, setBillingForm] = useState({
    billing_amount: '',
    invoice_number: '',
    billing_status: 'draft',
    notes: '',
  })

  // 1. Fetch factories
  const { data: factories = [] } = useQuery({
    queryKey: ['ceo-factories-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('id, name, company_id').order('name')
      if (error) throw error
      return data || []
    },
    enabled: isSuperUser,
  })

  // 2. Fetch periods
  const { data: allPeriods = [] } = useQuery({
    queryKey: ['ceo-periods-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').order('period_start', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: isSuperUser,
  })

  const distinctLabels = useMemo(() => {
    const s = new Set<string>()
    for (const p of allPeriods) if (p.label) s.add(p.label)
    return Array.from(s)
  }, [allPeriods])

  const activeLabel = selectedPeriodLabel || distinctLabels[0] || ''

  // 3. Fetch payroll entries for this period label
  const activePeriods = useMemo(() => allPeriods.filter(p => p.label === activeLabel), [allPeriods, activeLabel])
  const activePeriodIds = useMemo(() => activePeriods.map(p => p.id), [activePeriods])

  const { data: payrollEntries = [] } = useQuery({
    queryKey: ['ceo-ledger-payroll-entries', activePeriodIds],
    queryFn: async () => {
      if (activePeriodIds.length === 0) return []
      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          id, period_id, amount_normal, override_normal,
          amount_shift, override_shift, amount_ot, override_ot,
          amount_special, override_special, amount_wood_excess,
          amount_film, amount_diligence, amount_position,
          deduct_social_security, deduct_advance, deduct_safety_equipment, deduct_uniform,
          employee:employees(factory_id)
        `)
        .in('period_id', activePeriodIds)
      if (error) throw error
      return data || []
    },
    enabled: activePeriodIds.length > 0,
  })

  // 4. Fetch factory billings
  const { data: billings = [] } = useQuery({
    queryKey: ['ceo-factory-billings-ledger', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('factory_billings').select('*').eq('period_label', activeLabel)
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: !!activeLabel,
  })

  // 5. Fetch ledger transactions
  const { data: transactions = [] } = useQuery({
    queryKey: ['ceo-ledger-transactions', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('company_ledger_transactions')
          .select('*')
          .eq('period_label', activeLabel)
          .order('transaction_date', { ascending: true })
          .order('created_at', { ascending: true })
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: !!activeLabel,
  })

  // ── PASSBOOK LEDGER CALCULATIONS (RUNNING BALANCE) ──────────────────────────
  const rowsWithBalance = useMemo(() => {
    let running = 0
    return transactions.map((tx: any) => {
      const amt = Number(tx.amount || 0)
      if (tx.transaction_type === 'credit') {
        running += amt
      } else {
        running -= amt
      }
      return {
        ...tx,
        balance: running,
      }
    })
  }, [transactions])

  const totalCredit = useMemo(() => {
    return transactions
      .filter((t: any) => t.transaction_type === 'credit')
      .reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
  }, [transactions])

  const totalDebit = useMemo(() => {
    return transactions
      .filter((t: any) => t.transaction_type === 'debit')
      .reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
  }, [transactions])

  const netLedgerBalance = totalCredit - totalDebit

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    return rowsWithBalance.filter((r: any) => {
      if (filterType !== 'all' && r.transaction_type !== filterType) return false
      if (filterCategory !== 'all' && r.category !== filterCategory) return false
      if (searchTerm) {
        const q = searchTerm.toLowerCase()
        const matchDesc = (r.description || '').toLowerCase().includes(q)
        const matchRef = (r.reference_no || '').toLowerCase().includes(q)
        const matchCat = (CATEGORY_MAP[r.category]?.label || r.category || '').toLowerCase().includes(q)
        if (!matchDesc && !matchRef && !matchCat) return false
      }
      return true
    })
  }, [rowsWithBalance, filterType, filterCategory, searchTerm])

  // 6. Fetch company bank accounts
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['ceo-bank-accounts-ledger'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('company_bank_accounts').select('*')
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: isSuperUser,
  })

  // 7. Fetch admin payrolls
  const { data: adminPayrolls = [] } = useQuery({
    queryKey: ['ceo-admin-payrolls-ledger', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('admin_payroll_entries').select('*').eq('period_label', activeLabel)
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: !!activeLabel,
  })

  // ── P&L CALCULATIONS ────────────────────────────────────────────────────────
  const factoryBreakdown = useMemo(() => {
    return factories.map((f: any) => {
      const period = activePeriods.find(p => p.factory_id === f.id)
      const entries = payrollEntries.filter(e => e.period_id === period?.id)

      let totalGross = 0
      let totalNet = 0
      let totalSS = 0
      for (const e of entries) {
        const normal = e.override_normal != null ? Number(e.override_normal) : Number(e.amount_normal || 0)
        const shift = e.override_shift != null ? Number(e.override_shift) : Number(e.amount_shift || 0)
        const ot = e.override_ot != null ? Number(e.override_ot) : Number(e.amount_ot || 0)
        const special = e.override_special != null ? Number(e.override_special) : Number(e.amount_special || 0)
        const income = normal + shift + ot + special + Number(e.amount_wood_excess || 0) + Number(e.amount_film || 0) + Number(e.amount_diligence || 0) + Number(e.amount_position || 0)
        const deduct = Number(e.deduct_social_security || 0) + Number(e.deduct_advance || 0) + Number(e.deduct_safety_equipment || 0) + Number(e.deduct_uniform || 0)
        if (income > 0) {
          totalGross += income
          totalNet += Math.max(0, income - deduct)
          totalSS += Number(e.deduct_social_security || 0)
        }
      }

      const existingBilling = billings.find((b: any) => b.factory_id === f.id)
      const billingAmount = existingBilling ? Number(existingBilling.billing_amount || 0) : Math.round(totalGross * 1.25)
      const invoiceNo = existingBilling?.invoice_number || 'ยังไม่ออกเลขที่บิล'
      const status = existingBilling?.billing_status || 'draft'

      return {
        factoryId: f.id,
        factoryName: f.name,
        periodId: period?.id,
        billingRecord: existingBilling,
        billingAmount,
        invoiceNo,
        status,
        totalGross,
        totalNet,
        totalSS,
        grossMargin: billingAmount - totalNet,
        marginPercent: billingAmount > 0 ? ((billingAmount - totalNet) / billingAmount) * 100 : 0,
      }
    })
  }, [factories, activePeriods, payrollEntries, billings])

  const totalBilling = factoryBreakdown.reduce((s, f) => s + f.billingAmount, 0)
  const totalWorkerWages = factoryBreakdown.reduce((s, f) => s + f.totalNet, 0)
  const totalAdminWages = adminPayrolls.length > 0 ? adminPayrolls.reduce((s: number, a: any) => s + Number(a.net_pay || 0), 0) : 70000
  const employerSocialSecurity = Math.round(factoryBreakdown.reduce((s, f) => s + f.totalSS, 0) * 1.0) || 45000
  const otherExpenses = transactions.filter((t: any) => t.transaction_type === 'debit').reduce((s: number, t: any) => s + Number(t.amount || 0), 0) || 12000

  const pnl = useMemo(() => {
    return calculateOutsourceMargin({
      billingRevenue: totalBilling,
      workerWages: totalWorkerWages,
      adminWages: totalAdminWages,
      employerSocialSecurity,
      operatingExpenses: otherExpenses,
    })
  }, [totalBilling, totalWorkerWages, totalAdminWages, employerSocialSecurity, otherExpenses])

  const primaryBank = bankAccounts[0] || { bank_name: 'ธนาคารกสิกรไทย', account_number: '123-4-56789-0', current_balance: 2450000 }
  const currentBankBalance = Number(primaryBank.current_balance || 2450000)
  const payoutNeeded = totalWorkerWages + totalAdminWages
  const projectedBalance = currentBankBalance - payoutNeeded

  // ── MUTATIONS ───────────────────────────────────────────────────────────────
  const saveBillingMutation = useMutation({
    mutationFn: async () => {
      if (!editingBilling) return
      const amt = parseFloat(billingForm.billing_amount) || 0
      const activePeriod = activePeriods.find(p => p.factory_id === editingBilling.factoryId)

      const payload = {
        factory_id: editingBilling.factoryId,
        period_label: activeLabel,
        period_start: activePeriod?.period_start || new Date().toISOString().slice(0, 10),
        period_end: activePeriod?.period_end || new Date().toISOString().slice(0, 10),
        billing_amount: amt,
        net_receivable: amt,
        invoice_number: billingForm.invoice_number,
        billing_status: billingForm.billing_status,
        notes: billingForm.notes,
        created_by: user?.id,
      }

      const { error } = await supabase
        .from('factory_billings')
        .upsert(payload, { onConflict: 'factory_id,period_label' })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('บันทึกยอดวางบิลโรงงานเรียบร้อยแล้ว')
      setEditingBilling(null)
      queryClient.invalidateQueries({ queryKey: ['ceo-factory-billings-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['ceo-factory-billings'] })
    },
    onError: (err: any) => toast.error('บันทึกไม่สำเร็จ: ' + err.message),
  })

  // Add or Edit Transaction
  const saveTxMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(txForm.amount)
      if (!amt || amt <= 0) throw new Error('กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0)')
      if (!txForm.description.trim()) throw new Error('กรุณาระบุคำอธิบายรายการ')

      const payload = {
        transaction_date: txForm.date,
        transaction_type: txForm.type,
        category: txForm.category,
        amount: amt,
        description: txForm.description.trim(),
        period_label: activeLabel,
        bank_account_name: txForm.bank_account_name.trim(),
        reference_no: txForm.reference_no.trim() || null,
        created_by: user?.id,
      }

      if (editingTx?.id) {
        const { error } = await supabase.from('company_ledger_transactions').update(payload).eq('id', editingTx.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('company_ledger_transactions').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingTx ? 'แก้ไขรายการสมุดบัญชีเรียบร้อย' : 'เพิ่มรายการในสมุดบัญชีเรียบร้อย')
      setShowTxModal(false)
      setEditingTx(null)
      setTxForm({
        type: 'debit',
        category: 'operating_expense',
        amount: '',
        description: '',
        date: new Date().toISOString().slice(0, 10),
        bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
        reference_no: '',
      })
      queryClient.invalidateQueries({ queryKey: ['ceo-ledger-transactions'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Delete Transaction
  const deleteTxMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('company_ledger_transactions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('ลบรายการบัญชีเรียบร้อย')
      queryClient.invalidateQueries({ queryKey: ['ceo-ledger-transactions'] })
    },
    onError: (err: any) => toast.error('ลบไม่สำเร็จ: ' + err.message),
  })

  // Auto-Sync Period Payroll & Billings into Ledger
  const syncPeriodMutation = useMutation({
    mutationFn: async () => {
      if (!activeLabel) throw new Error('ไม่พบงวดที่เลือก')
      const itemsToInsert: any[] = []
      const today = new Date().toISOString().slice(0, 10)

      // 1. Factory Billings (Credit)
      factoryBreakdown.forEach(f => {
        if (f.billingAmount > 0) {
          const desc = `ค่าวางบิลเรียกเก็บ ${f.factoryName} (งวด ${activeLabel})`
          const alreadyExists = transactions.some((t: any) => t.description === desc)
          if (!alreadyExists) {
            itemsToInsert.push({
              transaction_date: today,
              transaction_type: 'credit',
              category: 'billing_income',
              amount: f.billingAmount,
              description: desc,
              period_label: activeLabel,
              bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
              reference_no: f.invoiceNo !== '—' ? f.invoiceNo : null,
              created_by: user?.id,
            })
          }
        }
      })

      // 2. Worker Wages (Debit)
      factories.forEach(f => {
        const cost = workerWagesByFactory[f.id] || 0
        if (cost > 0) {
          const desc = `จ่ายค่าแรงคนงาน ${f.name} (งวด ${activeLabel})`
          const alreadyExists = transactions.some((t: any) => t.description === desc)
          if (!alreadyExists) {
            itemsToInsert.push({
              transaction_date: today,
              transaction_type: 'debit',
              category: 'worker_wages',
              amount: cost,
              description: desc,
              period_label: activeLabel,
              bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
              created_by: user?.id,
            })
          }
        }
      })

      // 3. Admin Wages (Debit)
      if (totalAdminWages > 0) {
        const desc = `จ่ายเงินเดือนทีมแอดมิน & Staff (งวด ${activeLabel})`
        const alreadyExists = transactions.some((t: any) => t.description === desc)
        if (!alreadyExists) {
          itemsToInsert.push({
            transaction_date: today,
            transaction_type: 'debit',
            category: 'admin_salary',
            amount: totalAdminWages,
            description: desc,
            period_label: activeLabel,
            bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
            created_by: user?.id,
          })
        }
      }

      if (itemsToInsert.length === 0) {
        throw new Error('รายการค่าแรงและค่าวางบิลของงวดนี้มีอยู่ในสมุดบัญชีครบถ้วนแล้ว')
      }

      const { error } = await supabase.from('company_ledger_transactions').insert(itemsToInsert)
      if (error) throw error
      return itemsToInsert.length
    },
    onSuccess: (count) => {
      toast.success(`ดึงรายการค่าแรงและวางบิลเข้าสมุดบัญชีสำเร็จ (${count} รายการ)`)
      queryClient.invalidateQueries({ queryKey: ['ceo-ledger-transactions'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Export Ledger to Excel
  const handleExportLedgerExcel = () => {
    try {
      const rows = [
        ['สมุดบัญชีรายรับ-รายจ่าย (Credit / Debit Passbook Ledger) - ห้างหุ้นส่วนจำกัด วิราญกร'],
        [`ประจำงวด: ${activeLabel}`],
        [''],
        ['ลำดับ', 'วันที่', 'รายการ / คำอธิบาย', 'หมวดหมู่', 'บัญชี/ช่องทาง', 'เลขที่อ้างอิง', 'เงินเข้า (Credit +)', 'เงินออก (Debit -)', 'ยอดคงเหลือสะสม (บาท)'],
        ...filteredRows.map((r: any, idx: number) => [
          idx + 1,
          r.transaction_date,
          r.description,
          CATEGORY_MAP[r.category]?.label || r.category,
          r.bank_account_name || 'บัญชีหลัก',
          r.reference_no || '-',
          r.transaction_type === 'credit' ? Number(r.amount) : '',
          r.transaction_type === 'debit' ? Number(r.amount) : '',
          r.balance,
        ]),
        ['', '', 'รวมทั้งสิ้น', '', '', '', totalCredit, totalDebit, netLedgerBalance],
      ]

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 8 },  // ลำดับ
        { wch: 14 }, // วันที่
        { wch: 38 }, // รายการ
        { wch: 28 }, // หมวดหมู่
        { wch: 24 }, // บัญชี
        { wch: 16 }, // เลขอ้างอิง
        { wch: 18 }, // Credit
        { wch: 18 }, // Debit
        { wch: 22 }, // Balance
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'สมุดบัญชีเดบิตเครดิต')
      XLSX.writeFile(wb, `สมุดบัญชี_เดบิตเครดิต_วิราญกร_${activeLabel.replace(/\s+/g, '_')}.xlsx`)
      toast.success('ดาวน์โหลดสมุดบัญชี (Excel .xlsx) เรียบร้อยแล้ว')
    } catch (e: any) {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้: ' + e.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="บัญชี Credit / Debit & กำไร Outsource"
        breadcrumbs={['ระบบจัดการวิราญกร', 'บัญชีแยกประเภท & การเงิน']}
        onMenuClick={onMenuClick}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {distinctLabels.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--vk-paper)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--vk-rule-soft)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vk-ink-3)' }}>งวด:</span>
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
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', background: 'var(--vk-bone-2)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Navigation Tabs */}
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--vk-rule-soft)', paddingBottom: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('ledger')}
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'ledger' ? 'var(--vk-paper)' : 'transparent',
                color: activeTab === 'ledger' ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-3)',
                boxShadow: activeTab === 'ledger' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>📖 สมุดบัญชี เดบิต-เครดิต (Passbook Ledger)</span>
            </button>
            <button
              onClick={() => setActiveTab('pnl')}
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'pnl' ? 'var(--vk-paper)' : 'transparent',
                color: activeTab === 'pnl' ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-3)',
                boxShadow: activeTab === 'pnl' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>📊 สรุปโครงสร้างกำไร Outsource (P&L)</span>
            </button>
            <button
              onClick={() => setActiveTab('bank')}
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'bank' ? 'var(--vk-paper)' : 'transparent',
                color: activeTab === 'bank' ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-3)',
                boxShadow: activeTab === 'bank' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🏦 บัญชีธนาคาร & คาดการณ์กระแสเงินสด</span>
            </button>
          </div>

          {/* ── TAB 1: PASSBOOK LEDGER (MAIN VIEW AS REQUESTED) ─────────────── */}
          {activeTab === 'ledger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* 3 Passbook Headline Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                <div style={{
                  background: 'var(--vk-paper)',
                  border: '1px solid var(--vk-rule-soft)',
                  borderLeft: '4px solid var(--vk-jade)',
                  borderRadius: 8,
                  padding: '16px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-jade)', textTransform: 'uppercase' }}>
                      รวมเงินเข้า (Credit / รายรับ)
                    </span>
                    <ArrowDownLeft size={20} color="var(--vk-jade)" />
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vk-jade)', marginTop: 6, fontFamily: 'monospace' }}>
                    +฿{totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                    ค่าวางบิลโรงงานคู่สัญญา และเงินรับเข้าอื่นๆ
                  </div>
                </div>

                <div style={{
                  background: 'var(--vk-paper)',
                  border: '1px solid var(--vk-rule-soft)',
                  borderLeft: '4px solid var(--vk-crimson)',
                  borderRadius: 8,
                  padding: '16px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)', textTransform: 'uppercase' }}>
                      รวมเงินออก (Debit / รายจ่าย)
                    </span>
                    <ArrowUpRight size={20} color="var(--vk-crimson)" />
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vk-crimson)', marginTop: 6, fontFamily: 'monospace' }}>
                    -฿{totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                    ค่าแรงคนงาน, เงินเดือนแอดมิน, ปกส. และค่าใช้จ่าย
                  </div>
                </div>

                <div style={{
                  background: netLedgerBalance >= 0 ? '#F0FDF4' : '#FEF2F2',
                  border: `1.5px solid ${netLedgerBalance >= 0 ? '#86EFAC' : '#FCA5A5'}`,
                  borderRadius: 8,
                  padding: '16px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: netLedgerBalance >= 0 ? '#166534' : '#991B1B', textTransform: 'uppercase' }}>
                      ยอดคงเหลือสะสมสุทธิ (Net Balance)
                    </span>
                    <Wallet size={20} color={netLedgerBalance >= 0 ? '#15803D' : '#DC2626'} />
                  </div>
                  <div style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: netLedgerBalance >= 0 ? '#15803D' : '#DC2626',
                    marginTop: 6,
                    fontFamily: 'monospace',
                  }}>
                    {netLedgerBalance >= 0 ? '+' : ''}฿{netLedgerBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 12, color: netLedgerBalance >= 0 ? '#166534' : '#991B1B', marginTop: 2 }}>
                    ยอดดุลเงินสะสมในสมุดบัญชีประจำงวดนี้
                  </div>
                </div>
              </div>

              {/* Passbook Controls & Actions Bar */}
              <div style={{
                background: 'var(--vk-paper)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 10,
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                      สมุดบัญชีเงินฝาก-ถอน (Passbook General Ledger)
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '2px 0 0' }}>
                      บันทึกทุกรายการไอเท็มเข้า-ออก คำนวณยอดคงเหลือสะสมบรรทัดต่อบรรทัด (งวด {activeLabel})
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => syncPeriodMutation.mutate()}
                      disabled={syncPeriodMutation.isPending}
                      className="vk-btn vk-btn-secondary"
                      style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                      title="ดึงยอดวางบิลและยอดจ่ายค่าแรงประจำงวดเข้าสมุดบัญชีอัตโนมัติ"
                    >
                      <RefreshCw size={14} className={syncPeriodMutation.isPending ? 'animate-spin' : ''} />
                      <span>{syncPeriodMutation.isPending ? 'กำลังดึงข้อมูล...' : '📥 ดึงค่าแรง & วางบิลเข้าสมุดบัญชี'}</span>
                    </button>

                    <button
                      onClick={handleExportLedgerExcel}
                      className="vk-btn vk-btn-secondary"
                      style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <FileSpreadsheet size={14} color="#15803D" />
                      <span>ส่งออก Excel (.xlsx)</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingTx(null)
                        setTxForm({
                          type: 'debit',
                          category: 'operating_expense',
                          amount: '',
                          description: '',
                          date: new Date().toISOString().slice(0, 10),
                          bank_account_name: 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
                          reference_no: '',
                        })
                        setShowTxModal(true)
                      }}
                      className="vk-btn vk-btn-primary"
                      style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: '#15803D', color: '#fff' }}
                    >
                      <Plus size={16} />
                      <span>+ เพิ่มรายการใหม่</span>
                    </button>
                  </div>
                </div>

                {/* Search & Filter Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--vk-rule-soft)' }}>
                  {/* Search box */}
                  <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                    <Search size={14} color="var(--vk-ink-3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      type="text"
                      placeholder="ค้นหารายการ, คำอธิบาย, เลขอ้างอิง..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="vk-input"
                      style={{ width: '100%', padding: '6px 12px 6px 30px', fontSize: 13 }}
                    />
                  </div>

                  {/* Type Filter Pills */}
                  <div style={{ display: 'flex', background: 'var(--vk-bone)', padding: 3, borderRadius: 6, border: '1px solid var(--vk-rule-soft)' }}>
                    <button
                      onClick={() => setFilterType('all')}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: filterType === 'all' ? 'var(--vk-paper)' : 'transparent',
                        color: filterType === 'all' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                        boxShadow: filterType === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                      }}
                    >
                      ทั้งหมด ({rowsWithBalance.length})
                    </button>
                    <button
                      onClick={() => setFilterType('credit')}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: filterType === 'credit' ? '#DCFCE7' : 'transparent',
                        color: filterType === 'credit' ? '#15803D' : 'var(--vk-ink-3)',
                      }}
                    >
                      + เงินเข้า Credit
                    </button>
                    <button
                      onClick={() => setFilterType('debit')}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: filterType === 'debit' ? '#FEE2E2' : 'transparent',
                        color: filterType === 'debit' ? '#DC2626' : 'var(--vk-ink-3)',
                      }}
                    >
                      - เงินออก Debit
                    </button>
                  </div>

                  {/* Category Filter */}
                  <select
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    className="vk-input"
                    style={{ fontSize: 13, padding: '6px 10px' }}
                  >
                    <option value="all">ทุกหมวดหมู่</option>
                    {Object.entries(CATEGORY_MAP).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>

                {/* ── PASSBOOK TABLE ───────────────────────────────────────── */}
                {filteredRows.length === 0 ? (
                  <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--vk-ink-3)', background: 'var(--vk-bone)', borderRadius: 8 }}>
                    <FileText size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--vk-ink)' }}>ยังไม่มีรายการบันทึกในสมุดบัญชีสำหรับงวดนี้</div>
                    <div style={{ fontSize: 13, marginTop: 4, maxWidth: 460, margin: '4px auto 16px' }}>
                      ท่านสามารถกดปุ่ม <strong>"+ เพิ่มรายการใหม่"</strong> เพื่อบันทึกรายรับหรือรายจ่าย หรือกด <strong>"📥 ดึงค่าแรง & วางบิลเข้าสมุดบัญชี"</strong> เพื่อดึงยอดอัตโนมัติรอบเดียวได้ทันที
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                      <button
                        onClick={() => syncPeriodMutation.mutate()}
                        className="vk-btn vk-btn-secondary"
                        style={{ fontSize: 13 }}
                      >
                        📥 ดึงค่าแรง & วางบิลประจำงวด
                      </button>
                      <button
                        onClick={() => {
                          setEditingTx(null)
                          setShowTxModal(true)
                        }}
                        className="vk-btn vk-btn-primary"
                        style={{ fontSize: 13, background: '#15803D' }}
                      >
                        + เพิ่มรายการใหม่
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid var(--vk-rule-soft)', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #CBD5E1', textAlign: 'left', background: '#F8FAFC' }}>
                          <th style={{ padding: '12px 14px', fontWeight: 700, width: 100 }}>วันที่</th>
                          <th style={{ padding: '12px 14px', fontWeight: 700 }}>รายการ / รายละเอียด</th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, width: 180 }}>หมวดหมู่</th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, width: 160 }}>ช่องทาง / บัญชี</th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right', color: '#15803D', width: 140 }}>
                            เงินเข้า (Credit +)
                          </th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right', color: '#DC2626', width: 140 }}>
                            เงินออก (Debit -)
                          </th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right', color: '#1E293B', width: 150 }}>
                            ยอดคงเหลือสะสม
                          </th>
                          <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'center', width: 90 }}>
                            จัดการ
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((tx: any, idx: number) => {
                          const isCredit = tx.transaction_type === 'credit'
                          const catInfo = CATEGORY_MAP[tx.category] || { label: tx.category, color: '#6B7280' }
                          return (
                            <tr
                              key={tx.id || idx}
                              style={{
                                borderBottom: '1px solid #E2E8F0',
                                background: idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF',
                              }}
                            >
                              {/* วันที่ */}
                              <td style={{ padding: '12px 14px', color: 'var(--vk-ink-2)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                                {tx.transaction_date}
                              </td>

                              {/* รายการ / คำอธิบาย */}
                              <td style={{ padding: '12px 14px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--vk-ink)' }}>
                                  {tx.description}
                                </div>
                                {tx.reference_no && (
                                  <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2, fontFamily: 'monospace' }}>
                                    อ้างอิง: {tx.reference_no}
                                  </div>
                                )}
                              </td>

                              {/* หมวดหมู่ */}
                              <td style={{ padding: '12px 14px' }}>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 12,
                                  background: isCredit ? '#DCFCE7' : '#F3F4F6',
                                  color: catInfo.color,
                                  display: 'inline-block',
                                }}>
                                  {catInfo.label}
                                </span>
                              </td>

                              {/* บัญชี / ช่องทาง */}
                              <td style={{ padding: '12px 14px', color: 'var(--vk-ink-2)', fontSize: 12 }}>
                                {tx.bank_account_name || 'บัญชีหลัก หจก.วิราญกร'}
                              </td>

                              {/* เงินเข้า (Credit +) */}
                              <td style={{
                                padding: '12px 14px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#15803D',
                                fontFamily: 'monospace',
                                fontSize: 13,
                              }}>
                                {isCredit ? `+฿${Number(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>

                              {/* เงินออก (Debit -) */}
                              <td style={{
                                padding: '12px 14px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#DC2626',
                                fontFamily: 'monospace',
                                fontSize: 13,
                              }}>
                                {!isCredit ? `-฿${Number(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>

                              {/* ยอดคงเหลือสะสม (Balance) */}
                              <td style={{
                                padding: '12px 14px',
                                textAlign: 'right',
                                fontWeight: 800,
                                color: tx.balance >= 0 ? 'var(--vk-ink)' : '#DC2626',
                                fontFamily: 'monospace',
                                fontSize: 13,
                                background: '#F8FAFC',
                              }}>
                                ฿{Number(tx.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>

                              {/* จัดการ (Edit & Delete) */}
                              <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                  <button
                                    onClick={() => {
                                      setEditingTx(tx)
                                      setTxForm({
                                        type: tx.transaction_type,
                                        category: tx.category,
                                        amount: String(tx.amount || ''),
                                        description: tx.description || '',
                                        date: tx.transaction_date || new Date().toISOString().slice(0, 10),
                                        bank_account_name: tx.bank_account_name || 'บัญชีหลัก กสิกรไทย หจก.วิราญกร',
                                        reference_no: tx.reference_no || '',
                                      })
                                      setShowTxModal(true)
                                    }}
                                    className="vk-btn vk-btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: 11 }}
                                    title="แก้ไขรายการ"
                                  >
                                    <Edit size={12} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm(`ต้องการลบรายการ "${tx.description}" หรือไม่?`)) {
                                        deleteTxMutation.mutate(tx.id)
                                      }
                                    }}
                                    className="vk-btn vk-btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: 11, color: '#DC2626' }}
                                    title="ลบรายการ"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#F1F5F9', borderTop: '2px solid #CBD5E1', fontWeight: 800 }}>
                          <td colSpan={4} style={{ padding: '12px 14px', textAlign: 'right' }}>
                            ยอดรวมสุทธิสมุดบัญชี:
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: '#15803D', fontFamily: 'monospace' }}>
                            +฿{totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: '#DC2626', fontFamily: 'monospace' }}>
                            -฿{totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{
                            padding: '12px 14px',
                            textAlign: 'right',
                            color: netLedgerBalance >= 0 ? '#15803D' : '#DC2626',
                            fontFamily: 'monospace',
                            fontSize: 14,
                            background: '#E2E8F0',
                          }}>
                            ฿{netLedgerBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 2: P&L BREAKDOWN ─────────────────────────────────────────── */}
          {activeTab === 'pnl' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Financial Headline Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-jade)', textTransform: 'uppercase' }}>
                    1. รายรับรวมวางบิล (Credit)
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vk-jade)', marginTop: 4 }}>
                    ฿{totalBilling.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>จากโรงงานคู่สัญญา 2 แห่ง</div>
                </div>

                <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-crimson)', textTransform: 'uppercase' }}>
                    2. รายจ่ายรวมทุกด้าน (Debit)
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vk-crimson)', marginTop: 4 }}>
                    ฿{pnl.totalCost.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>ค่าแรง + แอดมิน + ปกส. + ดำเนินงาน</div>
                </div>

                <div style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                    <span>3. กำไรสุทธิของ หจก.วิราญกร</span>
                    <span style={{ background: '#DCFCE7', padding: '1px 6px', borderRadius: 4 }}>
                      {pnl.netMarginPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#15803D', marginTop: 4 }}>
                    ฿{pnl.netProfit.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: '#166534', marginTop: 2 }}>กำไรแท้จริงหลังหักค่าใช้จ่ายทั้งหมด</div>
                </div>
              </div>

              {/* Table of Factory Billings & Direct Margins */}
              <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                      ตารางเปรียบเทียบกำไรขั้นต้น แยกตามโรงงาน (Outsource Gross Margin)
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '2px 0 0' }}>
                      กดปุ่ม "แก้ไขยอดวางบิล" เพื่อระบุยอดตามใบแจ้งหนี้จริงที่เรียกเก็บโรงงาน
                    </p>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--vk-rule-soft)', textAlign: 'left', background: 'var(--vk-bone)' }}>
                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>โรงงาน</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>เลขที่ใบแจ้งหนี้</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>ยอดเรียกเก็บ (Billing)</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>จ่ายค่าแรงสุทธิ (Cost)</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>กำไรขั้นต้น (บาท)</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>Margin %</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>สถานะบิล</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {factoryBreakdown.map((f) => (
                        <tr key={f.factoryId} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                          <td style={{ padding: '12px', fontWeight: 700, color: 'var(--vk-ink)' }}>
                            {f.factoryName}
                          </td>
                          <td style={{ padding: '12px', color: 'var(--vk-ink-2)' }}>
                            {f.invoiceNo}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: 'var(--vk-jade)' }}>
                            ฿{f.billingAmount.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: 'var(--vk-crimson)' }}>
                            ฿{f.totalNet.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: '#15803D' }}>
                            ฿{f.grossMargin.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', fontWeight: 700 }}>
                            <span style={{ background: '#DCFCE7', color: '#15803D', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                              {f.marginPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: f.status === 'received' ? '#DCFCE7' : f.status === 'invoiced' ? '#FEF3C7' : 'var(--vk-bone)',
                              color: f.status === 'received' ? '#15803D' : f.status === 'invoiced' ? '#B45309' : 'var(--vk-ink-3)',
                            }}>
                              {f.status === 'received' ? 'รับเงินแล้ว' : f.status === 'invoiced' ? 'วางบิลแล้ว' : 'ร่างแบบ'}
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button
                              onClick={() => {
                                setEditingBilling(f)
                                setBillingForm({
                                  billing_amount: String(f.billingAmount || ''),
                                  invoice_number: f.invoiceNo !== 'ยังไม่ออกเลขที่บิล' ? f.invoiceNo : '',
                                  billing_status: f.status,
                                  notes: f.billingRecord?.notes || '',
                                })
                              }}
                              className="vk-btn vk-btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <Edit size={12} />
                              <span>แก้ไขบิล</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cost Structure Details */}
              <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
                <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--vk-ink)', margin: '0 0 12px' }}>
                  โครงสร้างต้นทุนและค่าใช้จ่ายของ หจก.วิราญกร ในงวดนี้
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div style={{ padding: 12, background: 'var(--vk-paper)', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>ค่าแรงพนักงาน 2 ไซต์</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)' }}>฿{totalWorkerWages.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: 12, background: 'var(--vk-paper)', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>ค่าจ้างทีมแอดมิน</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)' }}>฿{totalAdminWages.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: 12, background: 'var(--vk-paper)', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>สมทบประกันสังคมนายจ้าง (5%)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)' }}>฿{employerSocialSecurity.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: 12, background: 'var(--vk-paper)', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>ค่าใช้จ่ายดำเนินงานอื่นๆ</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)' }}>฿{otherExpenses.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* ── TAB 3: BANK BALANCE & RUNWAY ─────────────────────────────────── */}
          {activeTab === 'bank' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--vk-ink)', margin: '0 0 16px' }}>
                  บัญชีธนาคารหลัก หจก.วิราญกร
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>ชื่อบัญชี</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--vk-ink)', marginTop: 2 }}>{primaryBank.account_name}</div>
                    <div style={{ fontSize: 13, color: 'var(--vk-ink-2)', marginTop: 4 }}>
                      {primaryBank.bank_name} · เลขที่ <strong>{primaryBank.account_number}</strong>
                    </div>
                  </div>
                  <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>ยอดเงินคงเหลือในบัญชีปัจจุบัน</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vk-ink)', marginTop: 2 }}>
                      ฿{currentBankBalance.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4 }}>สถานะ: ใช้เป็นบัญชีหลักสำหรับโอนจ่าย</div>
                  </div>
                </div>
              </div>

              {/* Simulation Box */}
              <div style={{
                background: projectedBalance >= 0 ? '#F0FDF4' : '#FEF2F2',
                border: `1.5px solid ${projectedBalance >= 0 ? '#86EFAC' : '#FCA5A5'}`,
                borderRadius: 10,
                padding: 20,
              }}>
                <h4 style={{ fontSize: 15, fontWeight: 800, color: projectedBalance >= 0 ? '#166534' : '#991B1B', margin: '0 0 10px' }}>
                  การจำลองสภาพคล่องก่อนกดโอนเงินรอบนี้ (Cash Flow Simulation)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--vk-ink)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--vk-rule-soft)', paddingBottom: 6 }}>
                    <span>เงินในบัญชีปัจจุบัน:</span>
                    <strong style={{ fontSize: 15 }}>฿{currentBankBalance.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--vk-rule-soft)', paddingBottom: 6, color: 'var(--vk-crimson)' }}>
                    <span>หัก ยอดที่ต้องโอนจ่ายรอบนี้ (คนงาน 2 โรงงาน + แอดมิน):</span>
                    <strong style={{ fontSize: 15 }}>-฿{payoutNeeded.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, fontSize: 15, fontWeight: 800 }}>
                    <span>คาดการณ์ยอดคงเหลือในบัญชีหลังจ่าย (Cash Buffer):</span>
                    <span style={{ color: projectedBalance >= 0 ? '#15803D' : '#DC2626' }}>
                      ฿{projectedBalance.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── MODAL: EDIT BILLING ─────────────────────────────────────────── */}
          {editingBilling && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{
                background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', borderRadius: 10,
                maxWidth: 460, width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                  แก้ไขยอดวางบิล · {editingBilling.factoryName}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ยอดเรียกเก็บตามใบวางบิลจริง (บาท) *
                    </label>
                    <input
                      type="number"
                      value={billingForm.billing_amount}
                      onChange={e => setBillingForm({ ...billingForm, billing_amount: e.target.value })}
                      placeholder="เช่น 1200000"
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      เลขที่ใบแจ้งหนี้ / ใบวางบิล
                    </label>
                    <input
                      type="text"
                      value={billingForm.invoice_number}
                      onChange={e => setBillingForm({ ...billingForm, invoice_number: e.target.value })}
                      placeholder="เช่น INV-2026-08-01"
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      สถานะการวางบิล
                    </label>
                    <select
                      value={billingForm.billing_status}
                      onChange={e => setBillingForm({ ...billingForm, billing_status: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    >
                      <option value="draft">ร่างแบบ (ยังไม่ส่งบิล)</option>
                      <option value="invoiced">วางบิลแล้ว (รอโรงงานโอน)</option>
                      <option value="received">รับเงินเข้าบัญชีเรียบร้อย</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      หมายเหตุ
                    </label>
                    <textarea
                      value={billingForm.notes}
                      onChange={e => setBillingForm({ ...billingForm, notes: e.target.value })}
                      rows={2}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    onClick={() => setEditingBilling(null)}
                    className="vk-btn vk-btn-secondary"
                    style={{ fontSize: 13 }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={() => saveBillingMutation.mutate()}
                    disabled={saveBillingMutation.isPending}
                    className="vk-btn vk-btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    {saveBillingMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกยอดวางบิล'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── MODAL: ADD / EDIT TRANSACTION ───────────────────────────────── */}
          {showTxModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{
                background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', borderRadius: 12,
                maxWidth: 480, width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
                boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
              }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                    {editingTx ? '✏️ แก้ไขรายการสมุดบัญชี' : '➕ เพิ่มรายการในสมุดบัญชี'}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--vk-ink-3)', margin: '3px 0 0' }}>
                    บันทึกรายการเดบิต/เครดิต พร้อมอัปเดตยอดคงเหลือสะสมอัตโนมัติ
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Segmented Type Picker */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 6 }}>
                      ประเภทรายการ *
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setTxForm({ ...txForm, type: 'credit' })}
                        style={{
                          padding: '10px',
                          borderRadius: 6,
                          border: txForm.type === 'credit' ? '2px solid #16A34A' : '1px solid var(--vk-rule)',
                          background: txForm.type === 'credit' ? '#DCFCE7' : 'var(--vk-bone)',
                          color: txForm.type === 'credit' ? '#15803D' : 'var(--vk-ink-2)',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <ArrowDownLeft size={16} />
                        <span>[+] เครดิต (เงินเข้า / รับ)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTxForm({ ...txForm, type: 'debit' })}
                        style={{
                          padding: '10px',
                          borderRadius: 6,
                          border: txForm.type === 'debit' ? '2px solid #DC2626' : '1px solid var(--vk-rule)',
                          background: txForm.type === 'debit' ? '#FEE2E2' : 'var(--vk-bone)',
                          color: txForm.type === 'debit' ? '#DC2626' : 'var(--vk-ink-2)',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <ArrowUpRight size={16} />
                        <span>[-] เดบิต (เงินออก / จ่าย)</span>
                      </button>
                    </div>
                  </div>

                  {/* Date & Category in 2 columns */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                        วันที่ทำรายการ *
                      </label>
                      <input
                        type="date"
                        value={txForm.date}
                        onChange={e => setTxForm({ ...txForm, date: e.target.value })}
                        className="vk-input"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                        หมวดหมู่ *
                      </label>
                      <select
                        value={txForm.category}
                        onChange={e => setTxForm({ ...txForm, category: e.target.value })}
                        className="vk-input"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                      >
                        {Object.entries(CATEGORY_MAP).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.label} ({info.defaultType === 'credit' ? 'รับ' : 'จ่าย'})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Amount */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      จำนวนเงิน (บาท) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={txForm.amount}
                      onChange={e => setTxForm({ ...txForm, amount: e.target.value })}
                      placeholder="เช่น 15000"
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'monospace' }}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      คำอธิบายรายการ *
                    </label>
                    <input
                      type="text"
                      value={txForm.description}
                      onChange={e => setTxForm({ ...txForm, description: e.target.value })}
                      placeholder="เช่น ซื้อรองเท้าเซฟตี้ 20 คู่ ไซต์ตราเพชร, เงินโอนเพิ่มทุน"
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                    />
                  </div>

                  {/* Bank Account & Reference */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                        บัญชี / ช่องทาง
                      </label>
                      <input
                        type="text"
                        value={txForm.bank_account_name}
                        onChange={e => setTxForm({ ...txForm, bank_account_name: e.target.value })}
                        placeholder="เช่น บัญชีหลัก กสิกรไทย"
                        className="vk-input"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                        เลขที่อ้างอิง / สลิป
                      </label>
                      <input
                        type="text"
                        value={txForm.reference_no}
                        onChange={e => setTxForm({ ...txForm, reference_no: e.target.value })}
                        placeholder="เช่น REF-001 หรือ เลขสลิป"
                        className="vk-input"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--vk-rule-soft)' }}>
                  <button
                    onClick={() => {
                      setShowTxModal(false)
                      setEditingTx(null)
                    }}
                    className="vk-btn vk-btn-secondary"
                    style={{ fontSize: 13 }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={() => saveTxMutation.mutate()}
                    disabled={saveTxMutation.isPending}
                    className="vk-btn vk-btn-primary"
                    style={{
                      fontSize: 13,
                      background: txForm.type === 'credit' ? '#15803D' : 'var(--vk-primary)',
                      color: '#fff',
                    }}
                  >
                    {saveTxMutation.isPending
                      ? 'กำลังบันทึก...'
                      : (editingTx ? 'บันทึกการแก้ไข' : 'บันทึกเข้าสมุดบัญชี')}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
