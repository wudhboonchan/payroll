import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import {
  CreditCard, Download, CheckCircle2, AlertTriangle, Search, FileSpreadsheet
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { generateBankBatchCSV, type BankPayoutRecord } from '../features/ceo/ceoCalculations'
import '../styles/tokens.css'

export default function BankPayout() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const isSuperUser = String(user?.role || '').toLowerCase() === 'superuser'

  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'ตราเพชร' | 'TPI' | 'แอดมิน'>('all')

  // 1. Fetch periods
  const { data: allPeriods = [] } = useQuery({
    queryKey: ['bank-payout-periods'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*, factories(name)').order('period_start', { ascending: false })
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

  // Matching periods for this label
  const activePeriods = useMemo(() => allPeriods.filter(p => p.label === activeLabel), [allPeriods, activeLabel])
  const activePeriodIds = useMemo(() => activePeriods.map(p => p.id), [activePeriods])

  // 2. Fetch worker payroll entries for active periods
  const { data: workerEntries = [] } = useQuery({
    queryKey: ['bank-payout-workers', activePeriodIds],
    queryFn: async () => {
      if (activePeriodIds.length === 0) return []
      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          id, period_id,
          amount_normal, override_normal,
          amount_shift, override_shift,
          amount_ot, override_ot,
          amount_special, override_special,
          amount_wood_excess, amount_film,
          amount_diligence, amount_position,
          deduct_social_security, deduct_advance,
          deduct_safety_equipment, deduct_uniform,
          employee:employees(
            id, employee_code, first_name, last_name,
            national_id, payment_method, bank_name, bank_account, factory_id
          )
        `)
        .in('period_id', activePeriodIds)
      if (error) throw error
      return data || []
    },
    enabled: activePeriodIds.length > 0,
  })

  // 3. Fetch admin staff
  const { data: adminEmployees = [] } = useQuery({
    queryKey: ['bank-payout-admins'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('admin_employees').select('*')
        if (error) return []
        return data || []
      } catch {
        return []
      }
    },
    enabled: isSuperUser,
  })

  // 4. Fetch admin payrolls
  const { data: adminPayrolls = [] } = useQuery({
    queryKey: ['bank-payout-admin-payrolls', activeLabel],
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

  // ── CONSOLIDATE ALL RECIPIENTS ──────────────────────────────────────────────
  const allPayoutRecords = useMemo<BankPayoutRecord[]>(() => {
    const list: BankPayoutRecord[] = []

    // 1. Workers from Tra Phet and TPI
    for (const e of workerEntries) {
      const normal = e.override_normal != null ? Number(e.override_normal) : Number(e.amount_normal || 0)
      const shift = e.override_shift != null ? Number(e.override_shift) : Number(e.amount_shift || 0)
      const ot = e.override_ot != null ? Number(e.override_ot) : Number(e.amount_ot || 0)
      const special = e.override_special != null ? Number(e.override_special) : Number(e.amount_special || 0)
      const income = normal + shift + ot + special + Number(e.amount_wood_excess || 0) + Number(e.amount_film || 0) + Number(e.amount_diligence || 0) + Number(e.amount_position || 0)
      const deduct = Number(e.deduct_social_security || 0) + Number(e.deduct_advance || 0) + Number(e.deduct_safety_equipment || 0) + Number(e.deduct_uniform || 0)
      const net = Math.max(0, income - deduct)

      if (net > 0) {
        const emp = e.employee as any
        const period = activePeriods.find(p => p.id === e.period_id)
        const factoryName = period?.factories?.name || ''
        const isTpi = /ทีพีไอ|tpi/i.test(factoryName)

        list.push({
          category: isTpi ? 'คนงาน TPI' : 'คนงานตราเพชร',
          employeeCode: emp?.employee_code || '-',
          fullName: emp ? `${emp.first_name} ${emp.last_name}` : 'พนักงาน',
          nationalId: emp?.national_id || '',
          bankName: emp?.payment_method === 'cash' ? 'เงินสด' : (emp?.bank_name || 'ธนาคารกสิกรไทย'),
          bankAccount: emp?.payment_method === 'cash' ? 'รับเงินสด' : (emp?.bank_account || ''),
          netAmount: net,
        })
      }
    }

    // 2. Admin Staff
    const admins = adminEmployees.length > 0 ? adminEmployees : [
      { employee_code: 'ADM-001', first_name: 'สุวรรณา', last_name: 'มัส', bank_name: 'ธนาคารกสิกรไทย', bank_account: '045-8-12345-6', base_salary: 17500 },
      { employee_code: 'ADM-002', first_name: 'นันทนา', last_name: 'ใจดี', bank_name: 'ธนาคารไทยพาณิชย์', bank_account: '234-2-98765-1', base_salary: 17500 },
    ]

    for (const adm of admins) {
      const pay = adminPayrolls.find((p: any) => p.admin_employee_id === (adm as any).id)
      const net = pay ? Number(pay.net_pay) : (Number(adm.base_salary || 17500) + 2000 - 750)
      list.push({
        category: 'แอดมิน / ทีมงาน',
        employeeCode: adm.employee_code,
        fullName: `${adm.first_name} ${adm.last_name}`,
        nationalId: (adm as any).national_id || '',
        bankName: adm.bank_name || 'ธนาคารกสิกรไทย',
        bankAccount: adm.bank_account || '',
        netAmount: net,
      })
    }

    return list
  }, [workerEntries, activePeriods, adminEmployees, adminPayrolls])

  // Filtered
  const filteredRecords = useMemo(() => {
    return allPayoutRecords.filter(r => {
      const matchSearch = !search.trim() ||
        r.fullName.toLowerCase().includes(search.toLowerCase()) ||
        r.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
        r.bankAccount.includes(search)
      const matchCat = categoryFilter === 'all' || r.category.includes(categoryFilter)
      return matchSearch && matchCat
    })
  }, [allPayoutRecords, search, categoryFilter])

  const totalDisbursement = allPayoutRecords.reduce((s, r) => s + r.netAmount, 0)
  const totalRecipients = allPayoutRecords.length

  // Check invalid accounts
  const missingAccountCount = allPayoutRecords.filter(r => r.bankAccount !== 'รับเงินสด' && (!r.bankAccount || r.bankAccount.trim().length < 5)).length

  // Excel Export Handler
  const handleExportExcel = () => {
    try {
      const rows = [
        ['ลำดับ', 'กลุ่ม/สังกัด', 'รหัสพนักงาน', 'ชื่อ - นามสกุล', 'วิธีรับเงิน', 'ธนาคาร', 'เลขที่บัญชี', 'ยอดโอนสุทธิ (บาท)', 'เลขประจำตัวประชาชน'],
        ...filteredRecords.map((r, idx) => [
          idx + 1,
          r.category,
          r.employeeCode,
          r.fullName,
          r.paymentMethod === 'cash' ? 'รับเงินสด' : 'โอนธนาคาร',
          r.bankName || '-',
          r.bankAccount || '-',
          r.netAmount,
          r.nationalId || '-',
        ]),
        ['', '', '', 'รวมทั้งสิ้น', '', '', '', filteredRecords.reduce((sum, r) => sum + r.netAmount, 0), ''],
      ]

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 8 },  // ลำดับ
        { wch: 14 }, // กลุ่ม/สังกัด
        { wch: 14 }, // รหัส
        { wch: 26 }, // ชื่อ-นามสกุล
        { wch: 14 }, // วิธีรับเงิน
        { wch: 18 }, // ธนาคาร
        { wch: 20 }, // เลขที่บัญชี
        { wch: 18 }, // ยอดโอนสุทธิ
        { wch: 22 }, // เลขบัตร
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'ยอดโอนเงินเดือน')
      XLSX.writeFile(wb, `รายงานยอดโอนเงินเดือน_หจก.วิราญกร_${activeLabel.replace(/\s+/g, '_')}.xlsx`)
      toast.success('ดาวน์โหลดรายงานยอดโอนเงินเดือน (Excel .xlsx) เรียบร้อยแล้ว')
    } catch (e: any) {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้: ' + e.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="ระบบรวมจ่ายเงินธนาคาร (Bank Batch Payout Hub)"
        breadcrumbs={['ระบบจัดการวิราญกร', 'ศูนย์ควบคุมการเบิกจ่ายธนาคาร']}
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

          {/* Headline Stats Banner */}
          <div style={{
            background: 'var(--vk-paper)',
            border: '1px solid var(--vk-rule-soft)',
            borderRadius: 10,
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--vk-ink-3)', fontWeight: 600 }}>
                ยอดจ่ายสุทธิรวมทุกกลุ่มพนักงาน (งวด {activeLabel})
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--vk-ink)', marginTop: 2 }}>
                ฿{totalDisbursement.toLocaleString()} บาท
              </div>
              <div style={{ fontSize: 13, color: 'var(--vk-ink-2)', marginTop: 4 }}>
                รวมทั้งสิ้น <strong>{totalRecipients} ท่าน</strong> (ตราเพชร + TPI + แอดมิน)
              </div>
            </div>

            {/* Single Clean Excel Export Button */}
            <div>
              <button
                onClick={handleExportExcel}
                className="vk-btn vk-btn-primary"
                style={{
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#15803D',
                  color: '#fff',
                  padding: '10px 18px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
              >
                <FileSpreadsheet size={16} />
                <span>ดาวน์โหลดรายงานยอดโอน (Excel .xlsx)</span>
              </button>
            </div>
          </div>

          {/* Account check alert if any missing */}
          {missingAccountCount > 0 && (
            <div style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: '#92400E',
            }}>
              <AlertTriangle size={18} />
              <div>
                <strong>พบข้อมูลเลขบัญชีไม่สมบูรณ์ {missingAccountCount} รายการ:</strong> กรุณาตรวจสอบก่อนนำไฟล์ส่งธนาคารเพื่อป้องกันเงินตีกลับ
              </div>
            </div>
          )}

          {/* Filter and Search Bar */}
          <div style={{
            background: 'var(--vk-paper)',
            border: '1px solid var(--vk-rule-soft)',
            borderRadius: 10,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 260 }}>
              <Search size={16} color="var(--vk-ink-3)" />
              <input
                type="text"
                placeholder="ค้นหาชื่อพนักงาน, รหัส, หรือเลขบัญชี..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="vk-input"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-3)' }}>กลุ่ม:</span>
              {(['all', 'ตราเพชร', 'TPI', 'แอดมิน'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    border: '1px solid var(--vk-rule-soft)',
                    cursor: 'pointer',
                    background: categoryFilter === cat ? 'var(--vk-persimmon)' : 'transparent',
                    color: categoryFilter === cat ? '#FFFFFF' : 'var(--vk-ink)',
                  }}
                >
                  {cat === 'all' ? 'ทั้งหมด' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Disbursement Table */}
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 10, padding: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--vk-rule-soft)', textAlign: 'left', background: 'var(--vk-bone)' }}>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>ลำดับ</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>กลุ่มสังกัด</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>รหัส</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>ชื่อ - นามสกุล</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>ธนาคารปลายทาง</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>เลขที่บัญชี</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>ยอดจ่ายสุทธิ (บาท)</th>
                    <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>ความพร้อม</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r, idx) => {
                    const isCash = r.bankAccount === 'รับเงินสด'
                    const isValidAccount = isCash || (r.bankAccount && r.bankAccount.trim().length >= 5)

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                        <td style={{ padding: '12px', color: 'var(--vk-ink-3)' }}>{idx + 1}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: r.category.includes('ตราเพชร') ? '#EFF6FF' : r.category.includes('TPI') ? '#FDF2F8' : '#F0FDF4',
                            color: r.category.includes('ตราเพชร') ? '#1E40AF' : r.category.includes('TPI') ? '#9D174D' : '#15803D',
                          }}>
                            {r.category}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{r.employeeCode}</td>
                        <td style={{ padding: '12px', fontWeight: 700, color: 'var(--vk-ink)' }}>{r.fullName}</td>
                        <td style={{ padding: '12px' }}>{r.bankName}</td>
                        <td style={{ padding: '12px', fontFamily: 'var(--vk-mono)', color: isCash ? 'var(--vk-ink-3)' : 'var(--vk-ink)' }}>
                          {r.bankAccount || <span style={{ color: 'var(--vk-crimson)' }}>ไม่มีเลขบัญชี</span>}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800, fontSize: 14 }}>
                          ฿{r.netAmount.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {isValidAccount ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16A34A', fontSize: 12, fontWeight: 600 }}>
                              <CheckCircle2 size={14} /> พร้อมโอน
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#DC2626', fontSize: 12, fontWeight: 700 }}>
                              <AlertTriangle size={14} /> ตรวจสอบ
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
