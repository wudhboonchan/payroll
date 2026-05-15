import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { toast } from 'sonner'
import { Plus, CheckCircle, TrendingUp, Users, CreditCard } from 'lucide-react'
import '../../styles/v2-tokens.css'

interface PayrollPeriod { id: string; label: string; period_start: string; period_end: string; status: string; social_security_rate: number }

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseLocal(s: string) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
function formatPeriodLabel(start: string, end: string) {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const s = parseLocal(start), e = parseLocal(end)
  return `${s.getDate()} – ${e.getDate()} ${months[e.getMonth()]} ${e.getFullYear() + 543}`
}

export default function DashboardV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)

  const { data: periods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
  })

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0]
  const isApproved = activePeriod?.status === 'approved'

  const { data: stats } = useQuery({
    queryKey: ['v2-stats', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod) return null
      const [payroll, shifts, advances] = await Promise.all([
        supabase.from('payroll_entries').select('gross_pay,social_security_deduction,net_pay,advance_deduction').eq('period_id', activePeriod.id),
        supabase.from('shift_assignments').select('work_date').eq('period_id', activePeriod.id),
        supabase.from('advance_payments').select('amount').eq('period_id', activePeriod.id),
      ])
      const entries = payroll.data ?? []
      const gross = entries.reduce((s, e) => s + Number(e.gross_pay), 0)
      const ss = entries.reduce((s, e) => s + Number(e.social_security_deduction), 0)
      const net = entries.reduce((s, e) => s + Number(e.net_pay), 0)
      const adv = advances.data?.reduce((s, a) => s + Number(a.amount), 0) ?? 0
      const uniqueDays = new Set(shifts.data?.map(d => d.work_date)).size
      const start = parseLocal(activePeriod.period_start), end = parseLocal(activePeriod.period_end)
      const totalDays = Math.ceil((end.getTime()-start.getTime())/86400000)+1
      return { gross, ss, net, adv, uniqueDays, totalDays, headcount: entries.length }
    },
    enabled: !!activePeriod,
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('payroll_periods').update({ status: 'approved' }).eq('id', activePeriod!.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['periods'] }); toast.success('อนุมัติงวดเรียบร้อยแล้ว') },
    onError: (e: Error) => toast.error('อนุมัติไม่สำเร็จ', { description: e.message }),
  })

  const createNextPeriodMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id) throw new Error('ไม่พบข้อมูลโรงงาน')
      let nextStart: Date, nextEnd: Date
      if (periods.length === 0) {
        const now = new Date()
        nextStart = new Date(now.getFullYear(), now.getMonth(), 1)
        nextEnd = new Date(now.getFullYear(), now.getMonth(), 15)
      } else {
        const latestEnd = parseLocal(periods[0].period_end)
        nextStart = new Date(latestEnd.getFullYear(), latestEnd.getMonth(), latestEnd.getDate()+1)
        nextEnd = nextStart.getDate() === 1
          ? new Date(nextStart.getFullYear(), nextStart.getMonth(), 15)
          : new Date(nextStart.getFullYear(), nextStart.getMonth()+1, 0)
      }
      const startStr = fmt(nextStart), endStr = fmt(nextEnd)
      const { error } = await supabase.from('payroll_periods').insert({
        factory_id: user.factory_id, label: formatPeriodLabel(startStr, endStr),
        period_start: startStr, period_end: endStr, status: 'draft', social_security_rate: 0.05,
      })
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['periods'] }); toast.success('สร้างงวดใหม่เรียบร้อยแล้ว') },
    onError: (e: Error) => toast.error('สร้างงวดไม่สำเร็จ', { description: e.message }),
  })

  const nextPeriodLabel = (() => {
    if (periods.length === 0) {
      const now = new Date()
      return formatPeriodLabel(fmt(new Date(now.getFullYear(),now.getMonth(),1)), fmt(new Date(now.getFullYear(),now.getMonth(),15)))
    }
    const latestEnd = parseLocal(periods[0].period_end)
    const ns = new Date(latestEnd.getFullYear(), latestEnd.getMonth(), latestEnd.getDate()+1)
    const ne = ns.getDate()===1 ? new Date(ns.getFullYear(),ns.getMonth(),15) : new Date(ns.getFullYear(),ns.getMonth()+1,0)
    return formatPeriodLabel(fmt(ns), fmt(ne))
  })()

  const completionPct = stats && stats.totalDays > 0 ? Math.round((stats.uniqueDays / stats.totalDays) * 100) : 0

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="Dashboard" subtitle={activePeriod?.label} onMenuClick={onMenuClick} />

      <div style={{ padding: '32px 36px 60px', maxWidth: 1100, width: '100%', margin: '0 auto' }}>

        {/* Period selector + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 6 }}>OVERVIEW · ภาพรวมงวดปัจจุบัน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--vk-ink)', marginBottom: 4 }}>
              {activePeriod ? activePeriod.label : 'ยังไม่มีงวด'}
              {activePeriod && <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)', fontSize: 20 }}> — {isApproved ? 'อนุมัติแล้ว' : 'ฉบับร่าง'}</span>}
            </div>
            {periods.length > 1 && (
              <select onChange={e => setSelectedPeriodId(e.target.value)} value={selectedPeriodId ?? periods[0]?.id ?? ''}
                style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', outline: 'none' }}>
                {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activePeriod && !isApproved && stats && stats.headcount > 0 && (
              <button className="vk-btn vk-btn--primary" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                <CheckCircle style={{ width: 15, height: 15 }} />
                {approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติงวดนี้'}
              </button>
            )}
            {(periods.length === 0 || isApproved) && (
              <button className="vk-btn vk-btn--primary" onClick={() => createNextPeriodMutation.mutate()} disabled={createNextPeriodMutation.isPending}>
                <Plus style={{ width: 15, height: 15 }} />
                {createNextPeriodMutation.isPending ? 'กำลังสร้าง...' : periods.length === 0 ? `สร้างงวดแรก (${nextPeriodLabel})` : `สร้างงวดถัดไป (${nextPeriodLabel})`}
              </button>
            )}
          </div>
        </div>

        {periods.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', borderTop: '1px solid var(--vk-rule)' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 12 }}>ยังไม่มีงวดในระบบ</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 15, color: 'var(--vk-ink-3)' }}>กดปุ่มสร้างงวดแรกเพื่อเริ่มต้นใช้งาน</div>
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, border: '1px solid var(--vk-rule)', marginBottom: 36 }}>
              {[
                { icon: Users, eyebrow: 'พนักงาน · งวดนี้', value: stats?.headcount ?? '—', sub: 'คน', color: 'var(--vk-ink)' },
                { icon: TrendingUp, eyebrow: 'รวมรายได้', value: stats ? (stats.gross/1000).toFixed(1)+'K' : '—', sub: `฿ ${(stats?.gross ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: 'var(--vk-jade)' },
                { icon: CreditCard, eyebrow: 'ประกันสังคม', value: stats ? (stats.ss/1000).toFixed(1)+'K' : '—', sub: `฿ ${(stats?.ss ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: 'var(--vk-ink-3)' },
                { icon: TrendingUp, eyebrow: 'เงินได้สุทธิ', value: stats ? (stats.net/1000).toFixed(1)+'K' : '—', sub: `฿ ${(stats?.net ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`, color: 'var(--vk-persimmon)' },
              ].map((s, i) => (
                <div key={i} style={{ padding: '24px 28px', borderRight: i < 3 ? '1px solid var(--vk-rule)' : 'none', background: 'var(--vk-bone)' }}>
                  <div className="vk-eyebrow" style={{ marginBottom: 10 }}>{s.eyebrow}</div>
                  <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 32, letterSpacing: '-0.025em', color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginBottom: 4 }}>
                    {s.value}
                  </div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Progress + Status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36 }}>
              <div>
                <div className="vk-eyebrow" style={{ marginBottom: 8 }}>PROGRESS · ความคืบหน้าการบันทึกกะ</div>
                <hr className="vk-rule" />
                <div style={{ padding: '20px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>วันที่บันทึกแล้ว</span>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
                      {stats?.uniqueDays ?? 0} <span style={{ color: 'var(--vk-ink-3)', fontWeight: 400 }}>/ {stats?.totalDays ?? 0} วัน</span>
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--vk-paper-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ width: `${completionPct}%`, height: '100%', background: completionPct === 100 ? 'var(--vk-jade)' : 'var(--vk-persimmon)', transition: 'width 400ms ease' }} />
                  </div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>
                    {completionPct === 100 ? 'บันทึกครบทุกวันแล้ว ✓' : `เหลืออีก ${(stats?.totalDays ?? 0) - (stats?.uniqueDays ?? 0)} วัน`}
                  </div>
                </div>
                <hr className="vk-rule" />
              </div>

              <div>
                <div className="vk-eyebrow" style={{ marginBottom: 8 }}>STATUS · สถานะงวด</div>
                <hr className="vk-rule" />
                <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: 'สถานะงวด', value: <span className="vk-pill" data-tone={isApproved ? 'approved' : 'draft'}>{isApproved ? '● อนุมัติแล้ว' : '● ฉบับร่าง'}</span> },
                    { label: 'อัตราประกันสังคม', value: <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{((activePeriod?.social_security_rate ?? 0.05) * 100).toFixed(2)}%</span> },
                    { label: 'เบิกล่วงหน้ารวม', value: <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, color: 'var(--vk-crimson)', fontVariantNumeric: 'tabular-nums' }}>฿ {(stats?.adv ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span> },
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>{row.label}</span>
                      {row.value}
                    </div>
                  ))}
                </div>
                <hr className="vk-rule" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
