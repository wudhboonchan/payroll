import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { Copy, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/v2-tokens.css'

const STATUS_MAP: Record<string, { tone: string; label: string }> = {
  pending:   { tone: 'accent',   label: 'รอยืนยัน' },
  confirmed: { tone: 'approved', label: 'ยืนยันแล้ว' },
  disputed:  { tone: 'danger',   label: 'ข้อโต้แย้ง' },
  auto:      { tone: 'auto',     label: 'ยืนยันอัตโนมัติ' },
}

export default function ShareLinksV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState<string | null>(null)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0]

  const { data: tokens = [] } = useQuery<any[]>({
    queryKey: ['tokens-v2', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod) return []
      const { data, error } = await supabase.from('payslip_tokens')
        .select('id,token,status,expires_at,employee:employees(employee_code,first_name,last_name)')
        .eq('period_id', activePeriod.id).order('created_at')
      if (error) throw error; return data
    }, enabled: !!activePeriod, refetchInterval: 8000,
  })

  const counts = { confirmed: 0, pending: 0, disputed: 0, auto: 0 }
  tokens.forEach(t => { if (t.status in counts) (counts as any)[t.status]++ })

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/slip/${token}`)
    setCopied(token); setTimeout(() => setCopied(null), 1200)
    toast.success('คัดลอกลิงก์แล้ว')
  }

  const resetMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const newExpiry = new Date(Date.now() + 30*24*60*60*1000).toISOString()
      const { error } = await supabase.from('payslip_tokens').update({ status: 'pending', dispute_reason: null, expires_at: newExpiry }).eq('id', tokenId)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tokens-v2'] }); toast.success('รีเซ็ตลิงก์แล้ว') },
  })

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="ลิงก์สลิป (LINE)" subtitle={activePeriod?.label} onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>SHARE LINKS · ลิงก์สลิปสำหรับพนักงาน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              สลิป<span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>ส่งผ่าน LINE</span>
            </div>
          </div>
          {user?.role !== 'normalUser' && periods.length > 1 && (
            <select className="vk-input" style={{ width: 220, height: 36, fontSize: 13 }} value={selectedPeriodId} onChange={e => setSelectedPeriodId(e.target.value)}>
              {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0, border: '1px solid var(--vk-rule)', marginBottom: 32 }}>
          {[
            { label: 'ยืนยันแล้ว', count: counts.confirmed, color: 'var(--vk-jade)' },
            { label: 'รอยืนยัน',  count: counts.pending,   color: 'var(--vk-persimmon-ink)' },
            { label: 'ข้อโต้แย้ง',count: counts.disputed,  color: 'var(--vk-crimson)' },
            { label: 'อัตโนมัติ', count: counts.auto,      color: 'var(--vk-auto)' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '20px 24px', borderRight: i < 3 ? '1px solid var(--vk-rule)' : 'none', background: 'var(--vk-bone)' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 36, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.count}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="vk-eyebrow" style={{ marginBottom: 8 }}>LINKS · รายชื่อพนักงาน</div>
        <hr className="vk-rule" />
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['รหัส','ชื่อ–นามสกุล','ลิงก์','สถานะ',''].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)', padding: '12px 14px', borderBottom: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map(t => {
              const emp = t.employee as any
              const status = STATUS_MAP[t.status] ?? { tone: 'draft', label: t.status }
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{emp?.employee_code}</td>
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14 }}>{emp?.first_name} {emp?.last_name}</td>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)' }}>{window.location.origin}/slip/{t.token.slice(0,12)}…</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <span className="vk-pill" data-tone={status.tone}>● {status.label}</span>
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {t.status === 'disputed' && (
                        <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={() => resetMutation.mutate(t.id)} title="รีเซ็ต">
                          <RefreshCw style={{ width: 13, height: 13 }} />
                        </button>
                      )}
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={() => copyLink(t.token)}>
                        {copied === t.token ? <Check style={{ width: 13, height: 13, color: 'var(--vk-jade)' }} /> : <Copy style={{ width: 13, height: 13 }} />}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {tokens.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีลิงก์สำหรับงวดนี้</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
