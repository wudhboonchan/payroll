import { useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { toast } from 'sonner'
import { Lock, Pencil } from 'lucide-react'
import '../../styles/v2-tokens.css'

// Re-use business logic from existing PayrollEntry via import
// This page delegates all actual form interaction to PayrollEntry internals
// but wraps with V2 shell. Since PayrollEntry is complex, we embed it inside a V2 frame.

export default function PayrollEntryV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const currentPeriod = periods[0]

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name,rate_per_12h,nationality').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  const { data: entry } = useQuery<any>({
    queryKey: ['payroll-entry-v2', currentPeriod?.id, selectedEmpId],
    queryFn: async () => {
      if (!currentPeriod || !selectedEmpId) return null
      const { data } = await supabase.from('payroll_entries').select('*').eq('period_id', currentPeriod.id).eq('employee_id', selectedEmpId).single()
      return data
    }, enabled: !!currentPeriod && !!selectedEmpId,
  })

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="กรอกค่าจ้าง" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>PAYROLL ENTRY · กรอกค่าจ้าง</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              {selectedEmp ? <>{selectedEmp.first_name} <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>{selectedEmp.last_name}</span></> : 'เลือกพนักงาน'}
            </div>
            {selectedEmp && <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>รหัส {selectedEmp.employee_code}</div>}
          </div>
          <select className="vk-input" style={{ width: 280, height: 38 }} value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}>
            <option value="">-- เลือกพนักงาน --</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}</option>)}
          </select>
        </div>

        {entry ? (
          <>
            {/* Income + Deduct panel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--vk-rule)', background: 'var(--vk-bone)' }}>
              {/* Income */}
              <div style={{ padding: '20px 24px', borderRight: '1px solid var(--vk-rule)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div className="vk-eyebrow" style={{ color: 'var(--vk-jade)' }}>INCOME · รายได้</div>
                </div>
                {[
                  { label: 'ค่าจ้างปกติ', sub: `${entry.normal_days} วัน × ฿${Number(entry.daily_rate).toFixed(2)}`, value: entry.normal_pay },
                  { label: 'OT วันหยุด', value: entry.holiday_ot_pay },
                  { label: 'OT ชั่วโมงล่วงเวลา', value: entry.overtime_pay },
                  { label: 'โบนัส / อื่นๆ', value: entry.bonus },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14 }}>{r.label}</div>
                      {r.sub && <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>{r.sub}</div>}
                    </div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', minWidth: 100, textAlign: 'right' }}>
                      {Number(r.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0' }}>
                  <div className="vk-eyebrow">รวมรายได้</div>
                  <div className="vk-mono-lg" style={{ color: 'var(--vk-jade)' }}>+ {Number(entry.gross_pay || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* Deduct */}
              <div style={{ padding: '20px 24px' }}>
                <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 14 }}>DEDUCT · รายการหัก</div>
                {[
                  { label: 'ประกันสังคม 5%', value: entry.social_security_deduction, locked: true },
                  { label: 'เบิกล่วงหน้า', value: entry.advance_deduction, locked: true },
                  { label: 'หักอื่นๆ', value: entry.other_deductions },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--vk-rule-soft)' }}>
                    <div style={{ flex: 1, fontSize: 14 }}>{r.label}</div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', minWidth: 100, textAlign: 'right', color: r.locked ? 'var(--vk-ink-3)' : 'inherit' }}>
                      {Number(r.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    {r.locked ? <Lock style={{ width: 13, height: 13, color: 'var(--vk-ink-4)', flexShrink: 0 }} /> : <Pencil style={{ width: 13, height: 13, color: 'var(--vk-ink-4)', flexShrink: 0 }} />}
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0' }}>
                  <div className="vk-eyebrow">รวมรายการหัก</div>
                  <div className="vk-mono-lg" style={{ color: 'var(--vk-crimson)' }}>– {Number(entry.total_deductions || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            </div>

            {/* Net pay hero */}
            <div style={{ borderTop: '2px solid var(--vk-rule)', borderBottom: '2px solid var(--vk-rule)', padding: '22px 28px', background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="vk-eyebrow">NET PAY · เงินได้สุทธิ</div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 4 }}>{currentPeriod?.label} · {entry.normal_days} จาก {entry.total_days ?? '?'} วัน</div>
              </div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 44, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--vk-ink)' }}>
                {Math.floor(Number(entry.net_pay||0)).toLocaleString()}
                <span style={{ fontWeight: 500, fontSize: 20, color: 'var(--vk-ink-3)' }}>
                  .{(Number(entry.net_pay||0) % 1).toFixed(2).slice(2)}
                </span>
                <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, color: 'var(--vk-ink-3)', marginLeft: 8 }}>บาท</span>
              </div>
            </div>
          </>
        ) : selectedEmpId ? (
          <div style={{ border: '1px solid var(--vk-rule)', padding: '48px', textAlign: 'center', background: 'var(--vk-bone)' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>ยังไม่มีข้อมูลค่าจ้างสำหรับพนักงานคนนี้</div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>กรุณากรอกกะก่อน แล้วระบบจะคำนวณให้อัตโนมัติ</div>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--vk-rule)', padding: '60px 0', textAlign: 'center' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>เลือกพนักงานจากรายการด้านบน</div>
          </div>
        )}
      </div>
    </div>
  )
}
