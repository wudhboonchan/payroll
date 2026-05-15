import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { Printer, Download } from 'lucide-react'
import '../../styles/v2-tokens.css'

export default function PaySlipV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const currentPeriod = user?.role === 'normalUser' ? periods[0] : undefined
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const activePeriod = user?.role === 'normalUser' ? currentPeriod : periods.find(p => p.id === selectedPeriodId) ?? periods[0]

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name,payment_method,bank_name,bank_account,nationality').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  const { data: entry } = useQuery<any>({
    queryKey: ['payslip-v2', activePeriod?.id, selectedEmpId],
    queryFn: async () => {
      if (!activePeriod || !selectedEmpId) return null
      const { data } = await supabase.from('payroll_entries').select('*').eq('period_id', activePeriod.id).eq('employee_id', selectedEmpId).single()
      return data
    }, enabled: !!activePeriod && !!selectedEmpId,
  })

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="สลิปเงินเดือน" subtitle={activePeriod?.label} onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>PAY SLIP · สลิปเงินเดือน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              {selectedEmp ? `สลิปของ ${selectedEmp.first_name} ${selectedEmp.last_name}` : 'เลือกพนักงาน'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {user?.role !== 'normalUser' && (
              <select className="vk-input" style={{ width: 200, height: 36, fontSize: 13 }} value={selectedPeriodId} onChange={e => setSelectedPeriodId(e.target.value)}>
                {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
            <select className="vk-input" style={{ width: 260, height: 36, fontSize: 13 }} value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}>
              <option value="">-- เลือกพนักงาน --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}</option>)}
            </select>
            {entry && (
              <>
                <button className="vk-btn" onClick={() => window.print()}><Printer style={{ width: 14, height: 14 }} /> พิมพ์</button>
              </>
            )}
          </div>
        </div>

        {entry && selectedEmp ? (
          <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule)', maxWidth: 720, padding: '40px 48px' }}>
            {/* Header */}
            <div className="vk-eyebrow" style={{ marginBottom: 6 }}>OFFICIAL · เอกสารแสดงรายได้</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', marginBottom: 2 }}>
              ห้างหุ้นส่วนจำกัด <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>วิราญกร</span>
            </div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginBottom: 20 }}>ออกเมื่อ {activePeriod?.label}</div>
            <hr className="vk-rule" style={{ marginBottom: 16 }} />

            {/* Meta grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div><div className="vk-eyebrow">EMPLOYEE</div><div style={{ marginTop: 4, fontWeight: 600, fontSize: 14 }}>{selectedEmp.first_name} {selectedEmp.last_name}</div><div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>รหัส {selectedEmp.employee_code}</div></div>
              <div><div className="vk-eyebrow">PERIOD</div><div style={{ marginTop: 4, fontWeight: 600, fontSize: 14 }}>{activePeriod?.label}</div></div>
              <div><div className="vk-eyebrow">วิธีรับเงิน</div><div style={{ marginTop: 4, fontWeight: 600, fontSize: 14 }}>{selectedEmp.payment_method === 'bank' ? 'โอนธนาคาร' : 'เงินสด'}</div>{selectedEmp.payment_method === 'bank' && <div className="vk-small" style={{ color: 'var(--vk-ink-3)', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{selectedEmp.bank_name} · {selectedEmp.bank_account}</div>}</div>
            </div>

            {/* Ledger */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', border: '1px solid var(--vk-rule)' }}>
              <div style={{ padding: '16px 20px' }}>
                <div className="vk-eyebrow" style={{ color: 'var(--vk-jade)', marginBottom: 12 }}>INCOME · รายได้</div>
                {[
                  { label: 'ค่าจ้างปกติ', value: entry.normal_pay },
                  { label: 'OT วันหยุด', value: entry.holiday_ot_pay },
                  { label: 'OT ชั่วโมงล่วงเวลา', value: entry.overtime_pay },
                  { label: 'โบนัส / อื่นๆ', value: entry.bonus },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)', fontSize: 14 }}>
                    <span>{r.label}</span>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontVariantNumeric: 'tabular-nums' }}>{Number(r.value||0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--vk-rule)', width: 1 }} />
              <div style={{ padding: '16px 20px' }}>
                <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 12 }}>DEDUCT · รายการหัก</div>
                {[
                  { label: 'ประกันสังคม 5%', value: entry.social_security_deduction },
                  { label: 'เบิกล่วงหน้า', value: entry.advance_deduction },
                  { label: 'หักอื่นๆ', value: entry.other_deductions },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px dashed var(--vk-rule-soft)', fontSize: 14 }}>
                    <span>{r.label}</span>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontVariantNumeric: 'tabular-nums' }}>{Number(r.value||0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Subtotals */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--vk-rule)', borderLeft: '1px solid var(--vk-rule)', borderRight: '1px solid var(--vk-rule)' }}>
              <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRight: '1px solid var(--vk-rule)' }}>
                <div className="vk-eyebrow">รวมรายได้</div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 16, color: 'var(--vk-jade)', fontVariantNumeric: 'tabular-nums' }}>+ {Number(entry.gross_pay||0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>
              <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="vk-eyebrow">รวมรายการหัก</div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 16, color: 'var(--vk-crimson)', fontVariantNumeric: 'tabular-nums' }}>– {Number(entry.total_deductions||0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>
            </div>

            {/* Net hero */}
            <div style={{ borderTop: '2px solid var(--vk-rule)', borderBottom: '2px solid var(--vk-rule)', padding: '20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <div className="vk-eyebrow">NET PAY · เงินได้สุทธิ</div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 42, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                {Math.floor(Number(entry.net_pay||0)).toLocaleString()}
                <span style={{ fontWeight: 500, fontSize: 20, color: 'var(--vk-ink-3)' }}>.{(Number(entry.net_pay||0) % 1).toFixed(2).slice(2)}</span>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, color: 'var(--vk-ink-3)', marginLeft: 8 }}>บาท</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--vk-rule)', padding: '60px 0', textAlign: 'center' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>เลือกพนักงานเพื่อดูสลิป</div>
          </div>
        )}
      </div>
    </div>
  )
}
