import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import {
  Plus, FileText, Printer, Shield, UserPlus
} from 'lucide-react'
import { VKSlipDocument, type SlipIncomeRow, type SlipDeductRow } from '../components/VKSlipDocument'
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
  return 'สำนักงานใหญ่ / ส่วนกลาง'
}

function getNextAdminCode(admins: any[]): string {
  let maxNum = 0
  admins.forEach(a => {
    if (!a?.employee_code) return
    const match = String(a.employee_code).match(/ADM[-_]?(\d+)/i)
    if (match) {
      const num = parseInt(match[1], 10)
      if (!isNaN(num) && num > maxNum) {
        maxNum = num
      }
    }
  })
  const nextNum = maxNum + 1
  return `ADM-${String(nextNum).padStart(3, '0')}`
}

export default function AdminPayroll() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const isSuperUser = String(user?.role || '').toLowerCase() === 'superuser'

  const [activeTab, setActiveTab] = useState<'payroll' | 'directory'>('payroll')
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('')

  // Modals
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [editingAdmin, setEditingAdmin] = useState<any | null>(null)
  const [adminForm, setAdminForm] = useState({
    employee_code: '',
    first_name: '',
    last_name: '',
    nickname: '',
    phone: '',
    role_title: 'Admin ประจำไซต์',
    factory_id: '',
    bank_name: 'ธนาคารกสิกรไทย',
    bank_account: '',
    base_salary: '18000',
    has_social_security: true,
  })

  // Payslip Preview Modal
  const [previewSlip, setPreviewSlip] = useState<any | null>(null)

  // 1. Fetch factories
  const { data: factories = [] } = useQuery({
    queryKey: ['admin-payroll-factories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('id, name').order('name')
      if (error) throw error
      return data || []
    },
    enabled: isSuperUser,
  })

  // 2. Fetch period labels
  const { data: allPeriods = [] } = useQuery({
    queryKey: ['admin-payroll-periods'],
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

  const activeLabel = selectedPeriodLabel || distinctLabels[0] || '16-31 ส.ค. 2569'

  // 3. Fetch admin employees directory
  const { data: adminEmployees = [] } = useQuery({
    queryKey: ['admin-employees-list'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('admin_employees')
          .select('*, factory:factories(name)')
          .order('employee_code')
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: isSuperUser,
  })

  // 4. Fetch admin payroll entries for selected period
  const { data: payrollEntries = [] } = useQuery({
    queryKey: ['admin-payroll-entries', activeLabel],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('admin_payroll_entries')
          .select('*, admin:admin_employees(*, factory:factories(name))')
          .eq('period_label', activeLabel)
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: isSuperUser && !!activeLabel,
  })

  // Seed default admins if empty (for seamless initial use)
  const effectiveAdmins = useMemo(() => {
    const list = adminEmployees.length > 0 ? [...adminEmployees] : [
      {
        id: 'mock-1',
        employee_code: 'ADM-001',
        first_name: 'สุวรรณา',
        last_name: 'มัส',
        nickname: 'มัส',
        role_title: 'Admin ประจำไซต์ตราเพชร',
        factory_id: factories[0]?.id || null,
        factory: { name: 'โรงงานตราเพชร' },
        bank_name: 'ธนาคารกสิกรไทย',
        bank_account: '045-8-12345-6',
        base_salary: 17500,
        has_social_security: true,
        status: 'active',
      },
      {
        id: 'mock-2',
        employee_code: 'ADM-002',
        first_name: 'นันทนา',
        last_name: 'ใจดี',
        nickname: 'นัน',
        role_title: 'Admin ประจำไซต์ TPI',
        factory_id: factories[1]?.id || null,
        factory: { name: 'โรงงานทีพีไอ' },
        bank_name: 'ธนาคารไทยพาณิชย์',
        bank_account: '234-2-98765-1',
        base_salary: 17500,
        has_social_security: true,
        status: 'active',
      },
    ]
    return list.sort((a: any, b: any) =>
      (a.employee_code || '').localeCompare(b.employee_code || '', undefined, { numeric: true })
    )
  }, [adminEmployees, factories])

  // Map payroll data
  const rows = useMemo(() => {
    return effectiveAdmins.map((adm: any) => {
      const entry = payrollEntries.find((p: any) => p.admin_employee_id === adm.id)
      const base = entry ? Number(entry.base_salary) : Number(adm.base_salary || 0)
      const travel = entry ? Number(entry.allowance_travel) : 1000
      const site = entry ? Number(entry.allowance_site) : 1500
      const bonus = entry ? Number(entry.bonus_incentive) : 1000
      const ss = entry ? Number(entry.deduct_social_security) : (adm.has_social_security ? 750 : 0)
      const tax = entry ? Number(entry.deduct_tax) : 0
      const advance = entry ? Number(entry.deduct_advance) : 0
      const net = entry ? Number(entry.net_pay) : (base + travel + site + bonus - ss - tax - advance)

      return {
        admin: adm,
        entry,
        base,
        travel,
        site,
        bonus,
        ss,
        tax,
        advance,
        net,
        status: entry?.payment_status || 'pending',
      }
    })
  }, [effectiveAdmins, payrollEntries])

  const totalAdminNet = rows.reduce((s, r) => s + r.net, 0)

  const slipPrintRef = useRef<HTMLDivElement>(null)

  const handlePrintAdminSlip = () => {
    const el = slipPrintRef.current
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); return }
    const empName = previewSlip ? `${previewSlip.admin.first_name}_${previewSlip.admin.last_name}` : 'admin_slip'
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

  const slipIncome: SlipIncomeRow[] = useMemo(() => {
    if (!previewSlip) return []
    return [
      {
        label: 'เงินเดือนประจำ',
        value: previewSlip.base,
        subs: [],
      },
      ...(previewSlip.travel > 0 ? [{
        label: 'ค่าเดินทาง',
        value: previewSlip.travel,
        subs: [],
      }] : []),
      ...(previewSlip.site > 0 ? [{
        label: 'เบี้ยเลี้ยงไซต์งาน',
        value: previewSlip.site,
        subs: [],
      }] : []),
      ...(previewSlip.bonus > 0 ? [{
        label: 'เงินพิเศษ / Incentive',
        value: previewSlip.bonus,
        subs: [],
      }] : []),
    ]
  }, [previewSlip])

  const slipDeductions: SlipDeductRow[] = useMemo(() => {
    if (!previewSlip) return []
    return [
      ...(previewSlip.ss > 0 ? [{
        label: 'ประกันสังคม (5%)',
        value: previewSlip.ss,
        subs: [],
      }] : []),
      ...(previewSlip.tax > 0 ? [{
        label: 'ภาษีหัก ณ ที่จ่าย',
        value: previewSlip.tax,
        subs: [],
      }] : []),
    ]
  }, [previewSlip])

  // ── MUTATIONS ───────────────────────────────────────────────────────────────
  const saveAdminMutation = useMutation({
    mutationFn: async () => {
      const trimmedCode = adminForm.employee_code.trim().toUpperCase()
      if (!trimmedCode) {
        throw new Error('กรุณาระบุรหัสประจำตัวพนักงาน (เช่น ADM-001)')
      }
      if (!adminForm.first_name.trim() || !adminForm.last_name.trim()) {
        throw new Error('กรุณาระบุชื่อจริงและนามสกุล')
      }

      // ตรวจสอบรหัสซ้ำกับพนักงานท่านอื่น
      const isDuplicate = effectiveAdmins.some(
        (a: any) => a.id !== editingAdmin?.id && String(a.employee_code || '').trim().toUpperCase() === trimmedCode
      )
      if (isDuplicate) {
        throw new Error(`รหัสพนักงาน "${trimmedCode}" ซ้ำกับพนักงานท่านอื่นในระบบ กรุณาระบุรหัสอื่น`)
      }

      const payload = {
        employee_code: trimmedCode,
        first_name: adminForm.first_name.trim(),
        last_name: adminForm.last_name.trim(),
        nickname: adminForm.nickname.trim(),
        phone: adminForm.phone.trim(),
        role_title: adminForm.role_title,
        factory_id: adminForm.factory_id || null,
        bank_name: adminForm.bank_name,
        bank_account: adminForm.bank_account.trim(),
        base_salary: parseFloat(adminForm.base_salary) || 0,
        has_social_security: adminForm.has_social_security,
        status: 'active',
      }

      if (editingAdmin?.id && !editingAdmin.id.startsWith('mock-')) {
        const { error } = await supabase.from('admin_employees').update(payload).eq('id', editingAdmin.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('admin_employees').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('บันทึกข้อมูลพนักงานแอดมินเรียบร้อย')
      setShowAdminModal(false)
      setEditingAdmin(null)
      queryClient.invalidateQueries({ queryKey: ['admin-employees-list'] })
    },
    onError: (err: any) => toast.error('บันทึกไม่สำเร็จ: ' + err.message),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="ค่าจ้างทีมแอดมิน & Staff หลังบ้าน"
        breadcrumbs={['ระบบจัดการวิราญกร', 'ค่าตอบแทนผู้บริหาร & แอดมิน (CEO Confidential)']}
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

          {/* Privacy Alert Banner */}
          <div style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Shield size={18} color="#1D4ED8" />
              <div style={{ fontSize: 13, color: '#1E40AF' }}>
                <strong>ระบบรักษาความลับเฉพาะ CEO:</strong> ข้อมูลเงินเดือนของทีมแอดมินจะถูกซ่อนจากการเข้าถึงของบุคคลอื่น และไม่ปะปนกับระบบกะแรงงานทั่วไป
              </div>
            </div>
            <button
              onClick={() => {
                setEditingAdmin(null)
                setAdminForm({
                  employee_code: getNextAdminCode(effectiveAdmins),
                  first_name: '',
                  last_name: '',
                  nickname: '',
                  phone: '',
                  role_title: 'Admin ประจำไซต์',
                  factory_id: factories[0]?.id || '',
                  bank_name: 'ธนาคารกสิกรไทย',
                  bank_account: '',
                  base_salary: '18000',
                  has_social_security: true,
                })
                setShowAdminModal(true)
              }}
              className="vk-btn vk-btn-primary"
              style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <UserPlus size={16} />
              <span>+ เพิ่มพนักงานแอดมิน</span>
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--vk-rule-soft)', paddingBottom: 8 }}>
            <button
              onClick={() => setActiveTab('payroll')}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'payroll' ? 'var(--vk-paper)' : 'transparent',
                color: activeTab === 'payroll' ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-3)',
                boxShadow: activeTab === 'payroll' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              💵 การจ่ายเงินเดือนประจำงวด ({activeLabel})
            </button>
            <button
              onClick={() => setActiveTab('directory')}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'directory' ? 'var(--vk-paper)' : 'transparent',
                color: activeTab === 'directory' ? 'var(--vk-persimmon-ink)' : 'var(--vk-ink-3)',
                boxShadow: activeTab === 'directory' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              👥 ทะเบียนรายชื่อแอดมิน & ฐานเงินเดือน
            </button>
          </div>

          {/* ── TAB 1: PAYROLL ENTRIES ────────────────────────────────────────── */}
          {activeTab === 'payroll' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Summary card */}
              <div style={{
                background: 'var(--vk-paper)',
                border: '1px solid var(--vk-rule-soft)',
                borderRadius: 10,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>ยอดจ่ายสุทธิทีมแอดมินทั้งหมดในงวดนี้</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vk-ink)', marginTop: 2 }}>
                    ฿{totalAdminNet.toLocaleString()} บาท
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--vk-ink-3)' }}>
                  จำนวน {rows.length} ท่าน · พร้อมนำไปรวมในไฟล์จ่ายเงินธนาคาร
                </div>
              </div>

              {/* Table */}
              <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--vk-rule-soft)', textAlign: 'left', background: 'var(--vk-bone)' }}>
                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>รหัส / ชื่อ-นามสกุล</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>ตำแหน่ง / ไซต์งาน</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>ฐานเงินเดือน</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>เบี้ยเลี้ยง/เดินทาง</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>Incentive</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>หัก ปกส. (5%)</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>รับสุทธิ (บาท)</th>
                        <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>สลิป</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--vk-ink)' }}>
                              {r.admin.first_name} {r.admin.last_name} {r.admin.nickname ? `(${r.admin.nickname})` : ''}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>{r.admin.employee_code}</div>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--vk-ink)' }}>{r.admin.role_title}</div>
                            <div style={{ fontSize: 11, color: 'var(--vk-persimmon-ink)' }}>
                              {r.admin.factory?.name || 'ส่วนกลาง'}
                            </div>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>
                            ฿{r.base.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', color: 'var(--vk-jade)' }}>
                            +฿{(r.travel + r.site).toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', color: 'var(--vk-jade)' }}>
                            +฿{r.bonus.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', color: 'var(--vk-crimson)' }}>
                            -฿{r.ss.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800, fontSize: 14, color: 'var(--vk-ink)' }}>
                            ฿{r.net.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button
                              onClick={() => setPreviewSlip(r)}
                              className="vk-btn vk-btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <FileText size={12} />
                              <span>ดูสลิป</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 2: DIRECTORY ──────────────────────────────────────────────── */}
          {activeTab === 'directory' && (
            <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--vk-ink)', margin: '0 0 16px' }}>
                รายชื่อทีมงานแอดมินและพนักงานออฟฟิศ
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--vk-rule-soft)', textAlign: 'left', background: 'var(--vk-bone)' }}>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>รหัส</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>ชื่อ-นามสกุล</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>ตำแหน่ง</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>โรงงานที่รับผิดชอบ</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>ธนาคาร & เลขบัญชี</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>ฐานเงินเดือน</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveAdmins.map((adm: any) => (
                      <tr key={adm.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{adm.employee_code}</td>
                        <td style={{ padding: '12px', fontWeight: 700 }}>
                          {adm.first_name} {adm.last_name} {adm.nickname ? `(${adm.nickname})` : ''}
                        </td>
                        <td style={{ padding: '12px' }}>{adm.role_title}</td>
                        <td style={{ padding: '12px', color: 'var(--vk-persimmon-ink)' }}>
                          {adm.factory?.name || 'ส่วนกลาง'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div>{adm.bank_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>{adm.bank_account}</div>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>
                          ฿{Number(adm.base_salary || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            onClick={() => {
                              setEditingAdmin(adm)
                              setAdminForm({
                                employee_code: adm.employee_code,
                                first_name: adm.first_name,
                                last_name: adm.last_name,
                                nickname: adm.nickname || '',
                                phone: adm.phone || '',
                                role_title: adm.role_title,
                                factory_id: adm.factory_id || '',
                                bank_name: adm.bank_name || 'ธนาคารกสิกรไทย',
                                bank_account: adm.bank_account || '',
                                base_salary: String(adm.base_salary || ''),
                                has_social_security: adm.has_social_security ?? true,
                              })
                              setShowAdminModal(true)
                            }}
                            className="vk-btn vk-btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                          >
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── MODAL: ADD/EDIT ADMIN ───────────────────────────────────────── */}
          {showAdminModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{
                background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', borderRadius: 10,
                maxWidth: 500, width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                  {editingAdmin ? 'แก้ไขข้อมูลพนักงานแอดมิน' : 'เพิ่มพนักงานแอดมินใหม่'}
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      รหัสประจำตัวพนักงาน (Employee Code) *
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={adminForm.employee_code}
                        onChange={e => setAdminForm({ ...adminForm, employee_code: e.target.value.toUpperCase() })}
                        placeholder="เช่น ADM-001"
                        className="vk-input"
                        style={{ flex: 1, padding: '8px 12px', fontSize: 14, fontFamily: 'monospace', fontWeight: 700 }}
                      />
                      {!editingAdmin && (
                        <button
                          type="button"
                          onClick={() => setAdminForm({ ...adminForm, employee_code: getNextAdminCode(effectiveAdmins) })}
                          className="vk-btn vk-btn-secondary"
                          style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
                        >
                          รันเลขถัดไป
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4, display: 'block' }}>
                      ระบบคำนวณรหัสถัดไปให้อัตโนมัติ (เช่น ADM-001, ADM-002, ...) หรือท่านสามารถแก้ไขกำหนดรหัสเองได้
                    </span>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ชื่อจริง *
                    </label>
                    <input
                      type="text"
                      value={adminForm.first_name}
                      onChange={e => setAdminForm({ ...adminForm, first_name: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      นามสกุล *
                    </label>
                    <input
                      type="text"
                      value={adminForm.last_name}
                      onChange={e => setAdminForm({ ...adminForm, last_name: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ชื่อเล่น
                    </label>
                    <input
                      type="text"
                      value={adminForm.nickname}
                      onChange={e => setAdminForm({ ...adminForm, nickname: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ตำแหน่ง
                    </label>
                    <input
                      type="text"
                      value={adminForm.role_title}
                      onChange={e => setAdminForm({ ...adminForm, role_title: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      โรงงานที่รับผิดชอบ
                    </label>
                    <select
                      value={adminForm.factory_id}
                      onChange={e => setAdminForm({ ...adminForm, factory_id: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    >
                      <option value="">ส่วนกลาง / ไม่ระบุโรงงาน</option>
                      {factories.map((f: any) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ธนาคาร
                    </label>
                    <select
                      value={adminForm.bank_name}
                      onChange={e => setAdminForm({ ...adminForm, bank_name: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    >
                      <option value="ธนาคารกสิกรไทย">ธนาคารกสิกรไทย</option>
                      <option value="ธนาคารไทยพาณิชย์">ธนาคารไทยพาณิชย์</option>
                      <option value="ธนาคารกรุงเทพ">ธนาคารกรุงเทพ</option>
                      <option value="ธนาคารกรุงไทย">ธนาคารกรุงไทย</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      เลขที่บัญชี
                    </label>
                    <input
                      type="text"
                      value={adminForm.bank_account}
                      onChange={e => setAdminForm({ ...adminForm, bank_account: e.target.value })}
                      placeholder="000-0-00000-0"
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)', display: 'block', marginBottom: 4 }}>
                      ฐานเงินเดือน (บาท) *
                    </label>
                    <input
                      type="number"
                      value={adminForm.base_salary}
                      onChange={e => setAdminForm({ ...adminForm, base_salary: e.target.value })}
                      className="vk-input"
                      style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button onClick={() => setShowAdminModal(false)} className="vk-btn vk-btn-secondary" style={{ fontSize: 13 }}>
                    ยกเลิก
                  </button>
                  <button onClick={() => saveAdminMutation.mutate()} disabled={saveAdminMutation.isPending} className="vk-btn vk-btn-primary" style={{ fontSize: 13 }}>
                    {saveAdminMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── MODAL: PREVIEW ADMIN PAYSLIP (VKSlipDocument Canonical) ──────── */}
          {previewSlip && (
            <div
              style={{
                position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(4px)', zIndex: 120,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
              }}
              onClick={() => setPreviewSlip(null)}
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
                        {previewSlip.admin.first_name} {previewSlip.admin.last_name} ({previewSlip.admin.employee_code}) · งวด {activeLabel}
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
                      onClick={() => setPreviewSlip(null)}
                      className="vk-btn vk-btn-secondary"
                      style={{ fontSize: 12, padding: '6px 12px' }}
                    >
                      ปิด
                    </button>
                  </div>
                </div>

                {/* Slip Body (Scrollable & Centered) */}
                <div style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '24px 16px',
                  display: 'flex',
                  justifyContent: 'center',
                  background: '#F1F5F9',
                }}>
                  <div ref={slipPrintRef} id="admin-slip-print" style={{ width: 680, minWidth: 680 }}>
                    <VKSlipDocument
                      companyName="ห้างหุ้นส่วนจำกัด วิราญกร"
                      companyAddress="เลขที่ 64 หมู่ 1 ตำบลบ้านธาตุ อำเภอแก่งคอย จังหวัดสระบุรี 18110"
                      logoSrc="/logo.png"
                      employeeName={`${previewSlip.admin.first_name} ${previewSlip.admin.last_name}`}
                      employeeCode={previewSlip.admin.employee_code}
                      positionLabel={`ประจำไซต์งาน: ${getAdminSiteName(previewSlip.admin, factories)}`}
                      periodLabel={activeLabel}
                      paymentMethod="bank_transfer"
                      bankName={previewSlip.admin.bank_name}
                      bankAccount={maskBank(previewSlip.admin.bank_account)}
                      income={slipIncome}
                      deductions={slipDeductions}
                      totalIncome={previewSlip.base + previewSlip.travel + previewSlip.site + previewSlip.bonus}
                      totalDeduct={previewSlip.ss + previewSlip.tax}
                      netPay={previewSlip.net}
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
