import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import { Plus, CheckCircle, XCircle, Pencil, Check, X, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import '../styles/tokens.css'

interface PayrollPeriod { id: string; label: string; period_start: string; period_end: string; status: string; social_security_rate: number; approved_by: string | null; approver?: { full_name: string | null } | null }

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseLocal(s: string) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
function formatPeriodLabel(start: string, end: string) {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const s = parseLocal(start), e = parseLocal(end)
  return `${s.getDate()} – ${e.getDate()} ${months[e.getMonth()]} ${e.getFullYear() + 543}`
}

export default function Dashboard() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showDeletePeriodConfirm, setShowDeletePeriodConfirm] = useState(false)
  const [showCarryOverModal, setShowCarryOverModal] = useState(false)
  const [editingSSRate, setEditingSSRate] = useState(false)
  const [ssRateDraft, setSSRateDraft] = useState('')
  const [channelSort, setChannelSort] = useState<{ key: 'channel' | 'count' | 'total'; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })

  const { data: periods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods')
        .select('*, approver:profiles!payroll_periods_approved_by_fkey(full_name)')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0]
  const isApproved = activePeriod?.status === 'approved'

  const { data: activeEmployeeCount = 0 } = useQuery<number>({
    queryKey: ['active-employee-count', user?.factory_id],
    queryFn: async () => {
      const { count, error } = await supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('factory_id', user?.factory_id ?? '').eq('status', 'active')
      if (error) throw error
      return count ?? 0
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  const { data: pendingProfileCount = 0 } = useQuery<number>({
    queryKey: ['pending-profile-count', user?.factory_id],
    queryFn: async () => {
      const { count, error } = await supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('factory_id', user?.factory_id ?? '').eq('status', 'active').eq('data_complete', false)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  const { data: paymentChannelStats } = useQuery({
    queryKey: ['payment-channel-stats', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod) return []
      const { data, error } = await supabase
        .from('payroll_entries')
        .select('amount_normal,amount_shift,amount_ot,amount_wood_excess,amount_film,amount_special,amount_diligence,amount_position,deduct_social_security,deduct_advance,deduct_safety_equipment,deduct_uniform,override_special,employee:employees(payment_method,bank_name)')
        .eq('period_id', activePeriod.id)
        .limit(10000)
      if (error) throw error
      const map = new Map<string, { count: number; total: number }>()
      for (const e of data ?? []) {
        const emp = (e as any).employee
        const method: string = emp?.payment_method ?? 'bank_transfer'
        const bank: string | null = emp?.bank_name ?? null
        const key = method === 'cash' ? 'เงินสด' : (bank || 'ไม่ระบุธนาคาร')
        const income = Number(e.amount_normal||0) + Number(e.amount_shift||0) + Number(e.amount_ot||0)
          + Number(e.amount_wood_excess||0) + Number(e.amount_film||0)
          + Number((e as any).override_special ?? e.amount_special ?? 0)
          + Number(e.amount_diligence||0) + Number(e.amount_position||0)
        const deduct = Number(e.deduct_social_security||0) + Number(e.deduct_advance||0) + Number(e.deduct_safety_equipment||0) + Number(e.deduct_uniform||0)
        const net = Math.max(0, income - deduct)
        const prev = map.get(key) ?? { count: 0, total: 0 }
        map.set(key, { count: prev.count + 1, total: prev.total + net })
      }
      return Array.from(map.entries())
        .map(([channel, v]) => ({ channel, ...v }))
        .sort((a, b) => b.total - a.total)
    },
    enabled: !!activePeriod,
    staleTime: 0,
    refetchInterval: 30_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['v2-stats', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod) return null
      const [payroll, shifts, advances] = await Promise.all([
        supabase.from('payroll_entries').select('employee_id,amount_normal,amount_shift,amount_ot,amount_wood_excess,amount_film,amount_special,amount_diligence,amount_position,deduct_social_security,deduct_advance,deduct_safety_equipment,deduct_uniform,override_special,employee:employees(employee_code,first_name,last_name)').eq('period_id', activePeriod.id).limit(10000),
        supabase.from('shift_assignments').select('work_date').eq('period_id', activePeriod.id).limit(10000),
        supabase.from('advance_payments').select('amount').eq('period_id', activePeriod.id),
      ])
      const entries = payroll.data ?? []
      const gross = entries.reduce((s, e) => {
        const income = Number(e.amount_normal||0) + Number(e.amount_shift||0) + Number(e.amount_ot||0)
          + Number(e.amount_wood_excess||0) + Number(e.amount_film||0)
          + Number(e.override_special ?? e.amount_special ?? 0)
          + Number(e.amount_diligence||0) + Number(e.amount_position||0)
        return s + income
      }, 0)
      const ss = entries.reduce((s, e) => s + Number(e.deduct_social_security||0), 0)
      const ssCount = entries.filter(e => Number(e.deduct_social_security||0) > 0).length
      const totalDeduct = entries.reduce((s, e) => s + Number(e.deduct_social_security||0) + Number(e.deduct_advance||0) + Number(e.deduct_safety_equipment||0) + Number(e.deduct_uniform||0), 0)
      const rawNet = gross - totalDeduct
      // Per-employee clamped net: negative entries become 0, deficit carries to next period
      let net = 0, carryOver = 0
      const carryOverDetails: { employee_code: string; first_name: string; last_name: string; deficit: number }[] = []
      for (const e of entries) {
        const income = Number(e.amount_normal||0) + Number(e.amount_shift||0) + Number(e.amount_ot||0)
          + Number(e.amount_wood_excess||0) + Number(e.amount_film||0)
          + Number(e.override_special ?? e.amount_special ?? 0)
          + Number(e.amount_diligence||0) + Number(e.amount_position||0)
        const deduct = Number(e.deduct_social_security||0) + Number(e.deduct_advance||0) + Number(e.deduct_safety_equipment||0) + Number(e.deduct_uniform||0)
        const entryNet = income - deduct
        if (entryNet < 0) {
          carryOver += Math.abs(entryNet)
          const emp = (e as any).employee
          carryOverDetails.push({ employee_code: emp?.employee_code ?? '—', first_name: emp?.first_name ?? '', last_name: emp?.last_name ?? '', deficit: Math.abs(entryNet) })
        } else net += entryNet
      }
      void rawNet
      const adv = advances.data?.reduce((s, a) => s + Number(a.amount), 0) ?? 0
      const advCount = advances.data?.length ?? 0
      const uniqueDays = new Set(shifts.data?.map(d => d.work_date)).size
      const start = parseLocal(activePeriod.period_start), end = parseLocal(activePeriod.period_end)
      const totalDays = Math.ceil((end.getTime()-start.getTime())/86400000)+1
      return { gross, ss, ssCount, net, carryOver, carryOverDetails, adv, advCount, uniqueDays, totalDays }
    },
    enabled: !!activePeriod,
    staleTime: 0,
    refetchInterval: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('payroll_periods').update({ status: 'approved', approved_by: user?.id ?? null }).eq('id', activePeriod!.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['periods'] }); toast.success('อนุมัติงวดเรียบร้อยแล้ว') },
    onError: (e: Error) => toast.error('อนุมัติไม่สำเร็จ', { description: e.message }),
  })

  const cancelApproveMutation = useMutation({
    mutationFn: async () => {
      const periodId = activePeriod!.id

      // 1. Revert period to draft
      const { error: periodErr } = await supabase.from('payroll_periods')
        .update({ status: 'draft' }).eq('id', periodId)
      if (periodErr) throw periodErr

      // 2. Expire all share-link tokens for this period immediately
      //    Set expires_at to now so any in-flight link checks fail instantly
      const { error: tokenErr } = await supabase.from('payslip_tokens')
        .update({ expires_at: new Date().toISOString() })
        .eq('period_id', periodId)
      if (tokenErr) throw tokenErr

      // 3. Delete all tokens so the share-link page resets to clean state
      const { error: deleteErr } = await supabase.from('payslip_tokens')
        .delete().eq('period_id', periodId)
      if (deleteErr) throw deleteErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      queryClient.invalidateQueries({ queryKey: ['payslip_tokens'] })
      toast.success('ยกเลิกการอนุมัติแล้ว — ลิงก์สลิปทั้งหมดถูกยกเลิกแล้ว', { duration: 5000 })
    },
    onError: (e: Error) => toast.error('ยกเลิกไม่สำเร็จ', { description: e.message }),
  })

  const updateSSRateMutation = useMutation({
    mutationFn: async (rate: number) => {
      const { error } = await supabase.from('payroll_periods').update({ social_security_rate: rate }).eq('id', activePeriod!.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['periods'] }); toast.success('อัปเดตอัตราประกันสังคมแล้ว') },
    onError: (e: Error) => toast.error('อัปเดตไม่สำเร็จ', { description: e.message }),
  })

  const deletePeriodMutation = useMutation({
    mutationFn: async () => {
      if (!activePeriod) throw new Error('ไม่พบงวด')
      // Delete all related data first, then the period itself
      await supabase.from('shift_assignments').delete().eq('period_id', activePeriod.id)
      await supabase.from('payroll_entries').delete().eq('period_id', activePeriod.id)
      await supabase.from('advance_payments').delete().eq('period_id', activePeriod.id)
      await supabase.from('payslip_tokens').delete().eq('period_id', activePeriod.id)
      const { error } = await supabase.from('payroll_periods').delete().eq('id', activePeriod.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      setSelectedPeriodId(null)
      setShowDeletePeriodConfirm(false)
      toast.success('ลบงวดเรียบร้อยแล้ว')
    },
    onError: (e: Error) => toast.error('ลบงวดไม่สำเร็จ', { description: e.message }),
  })

  const createNextPeriodMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id) throw new Error('ไม่พบข้อมูลโรงงาน')
      let nextStart: Date, nextEnd: Date
      if (periods.length === 0) {
        const now = new Date()
        if (now.getDate() <= 15) {
          nextStart = new Date(now.getFullYear(), now.getMonth(), 1)
          nextEnd   = new Date(now.getFullYear(), now.getMonth(), 15)
        } else {
          nextStart = new Date(now.getFullYear(), now.getMonth(), 16)
          nextEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0) // last day of month
        }
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
      if (now.getDate() <= 15) {
        return formatPeriodLabel(fmt(new Date(now.getFullYear(),now.getMonth(),1)), fmt(new Date(now.getFullYear(),now.getMonth(),15)))
      } else {
        return formatPeriodLabel(fmt(new Date(now.getFullYear(),now.getMonth(),16)), fmt(new Date(now.getFullYear(),now.getMonth()+1,0)))
      }
    }
    const latestEnd = parseLocal(periods[0].period_end)
    const ns = new Date(latestEnd.getFullYear(), latestEnd.getMonth(), latestEnd.getDate()+1)
    const ne = ns.getDate()===1 ? new Date(ns.getFullYear(),ns.getMonth(),15) : new Date(ns.getFullYear(),ns.getMonth()+1,0)
    return formatPeriodLabel(fmt(ns), fmt(ne))
  })()

  const completionPct = stats && stats.totalDays > 0 ? Math.round((stats.uniqueDays / stats.totalDays) * 100) : 0

  return (
    <>
      <TopBar title="Dashboard" subtitle={activePeriod?.label} onMenuClick={onMenuClick} />

      <div className="vk-page">

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
            {activePeriod && !isApproved && (activeEmployeeCount > 0 || (stats?.gross ?? 0) > 0) && (
              <button className="vk-btn vk-btn--primary" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                <CheckCircle style={{ width: 15, height: 15 }} />
                {approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติงวดนี้'}
              </button>
            )}
            {activePeriod && isApproved && (
              <button className="vk-btn" onClick={() => setShowCancelConfirm(true)} disabled={cancelApproveMutation.isPending}
                style={{ borderColor: 'var(--vk-rule)', color: 'var(--vk-ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <XCircle style={{ width: 15, height: 15 }} />
                {cancelApproveMutation.isPending ? 'กำลังยกเลิก...' : 'ยกเลิกอนุมัติ'}
              </button>
            )}
            {(periods.length === 0 || isApproved) && (
              <button className="vk-btn vk-btn--primary" onClick={() => createNextPeriodMutation.mutate()} disabled={createNextPeriodMutation.isPending}>
                <Plus style={{ width: 15, height: 15 }} />
                {createNextPeriodMutation.isPending ? 'กำลังสร้าง...' : periods.length === 0 ? `สร้างงวดแรก (${nextPeriodLabel})` : `สร้างงวดถัดไป (${nextPeriodLabel})`}
              </button>
            )}
            {/* Delete button — only for draft periods with no data (wait for stats to load) */}
            {activePeriod && !isApproved && stats !== undefined && stats.gross === 0 && stats.uniqueDays === 0 && (
              <button className="vk-btn" onClick={() => setShowDeletePeriodConfirm(true)}
                style={{ color: 'var(--vk-crimson)', borderColor: 'var(--vk-crimson)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trash2 style={{ width: 14, height: 14 }} />
                ลบงวดนี้
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: (stats?.carryOver ?? 0) > 0 ? 0 : 36 }}>
              {[
                { eyebrow: 'พนักงานทั้งหมด', value: String(activeEmployeeCount), sub: 'คน (สถานะปกติ)', color: 'var(--vk-ink)' },
                { eyebrow: 'ยอดจ่ายรวม',    value: (stats?.gross ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }), sub: 'บาท', color: 'var(--vk-jade)' },
                { eyebrow: 'ประกันสังคม',    value: (stats?.ss   ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }), sub: 'บาท', color: 'var(--vk-ink-3)' },
                { eyebrow: 'ยอดจ่ายสุทธิ',  value: (stats?.net  ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }), sub: 'บาท', color: 'var(--vk-persimmon)' },
              ].map((s, i) => (
                <div key={i} style={{ padding: '18px 20px', background: 'var(--vk-bone)', borderRight: i < 3 ? '1px solid var(--vk-rule)' : undefined }}>
                  <div className="vk-eyebrow" style={{ marginBottom: 10 }}>{s.eyebrow}</div>
                  <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 28, letterSpacing: '-0.025em', color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginBottom: 4 }}>
                    {s.value}
                  </div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Carry-over card — only shown when there are negative net entries */}
            {(stats?.carryOver ?? 0) > 0 && (
              <div onClick={() => setShowCarryOverModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 20px', background: 'var(--vk-crimson-tint)', border: '1px solid var(--vk-crimson)', borderTop: 'none', marginBottom: 36, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fde0dc')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--vk-crimson-tint)')}>
                <div style={{ flex: 1 }}>
                  <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 4 }}>ยอดยกไปงวดหน้า — คลิกเพื่อดูรายละเอียด</div>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-crimson)', opacity: 0.8 }}>
                    พนักงาน {stats?.carryOverDetails?.length ?? 0} ราย มียอดเบิกล่วงหน้าเกินค่าจ้างงวดนี้ — จ่ายจริง ฿0 และยอดส่วนเกินจะถูกหักในงวดถัดไป
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 22, color: 'var(--vk-crimson)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                    − {(stats?.carryOver ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="vk-small" style={{ color: 'var(--vk-crimson)', opacity: 0.7 }}>บาท</div>
                </div>
              </div>
            )}

            {/* Progress + Status */}
            <div className="vk-grid-2">
              <div>
                <div className="vk-eyebrow" style={{ marginBottom: 8 }}>PROGRESS · ความคืบหน้าการบันทึกกะ</div>
                <hr className="vk-rule" />
                <div style={{ padding: '20px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>วันที่บันทึกแล้ว</span>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 16 }}>
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
                  {/* Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>สถานะงวด</span>
                    <span className="vk-pill" data-tone={isApproved ? 'approved' : 'draft'}>{isApproved ? '● อนุมัติแล้ว' : '● ฉบับร่าง'}</span>
                  </div>

                  {/* Approver */}
                  {isApproved && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>อนุมัติโดย</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-jade)' }}>
                        {(activePeriod as any)?.approver?.full_name || 'ไม่ระบุ'}
                      </span>
                    </div>
                  )}

                  {/* SS Rate — editable */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>อัตราประกันสังคม</span>
                    {editingSSRate ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number" step="0.01" min="0" max="100"
                          value={ssRateDraft}
                          onChange={e => setSSRateDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const v = parseFloat(ssRateDraft)
                              if (!isNaN(v) && v >= 0 && v <= 100) { updateSSRateMutation.mutate(v / 100); setEditingSSRate(false) }
                            }
                            if (e.key === 'Escape') setEditingSSRate(false)
                          }}
                          autoFocus
                          style={{ width: 64, fontFamily: 'var(--vk-mono)', fontSize: 13, border: '1px solid var(--vk-rule)', padding: '2px 6px', background: 'var(--vk-paper)', textAlign: 'right', outline: 'none' }}
                        />
                        <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, color: 'var(--vk-ink-3)' }}>%</span>
                        <button onClick={() => { const v = parseFloat(ssRateDraft); if (!isNaN(v) && v >= 0 && v <= 100) { updateSSRateMutation.mutate(v / 100); setEditingSSRate(false) } }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-jade)', padding: 2, display: 'flex' }}>
                          <Check style={{ width: 14, height: 14 }} />
                        </button>
                        <button onClick={() => setEditingSSRate(false)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', padding: 2, display: 'flex' }}>
                          <X style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{((activePeriod?.social_security_rate ?? 0.05) * 100).toFixed(2)}%</span>
                        <button onClick={() => { setSSRateDraft((((activePeriod?.social_security_rate ?? 0.05) * 100).toFixed(2))); setEditingSSRate(true) }}
                          title="แก้ไขอัตราประกันสังคม"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', padding: 2, display: 'flex', opacity: 0.5 }}>
                          <Pencil style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* SS deduction summary */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>
                      หักประกันสังคม{stats?.ssCount ? <span style={{ color: 'var(--vk-ink-3)', fontSize: 12 }}> ({stats.ssCount} คน)</span> : ''}
                    </span>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, color: 'var(--vk-ink-3)', fontVariantNumeric: 'tabular-nums' }}>฿ {(stats?.ss ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>

                  {/* Advance */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, color: 'var(--vk-ink-2)' }}>
                      เบิกล่วงหน้ารวม{(stats?.advCount ?? 0) > 0 ? <span style={{ color: 'var(--vk-ink-3)', fontSize: 12 }}> ({stats!.advCount} รายการ)</span> : ''}
                    </span>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 14, color: 'var(--vk-crimson)', fontVariantNumeric: 'tabular-nums' }}>฿ {(stats?.adv ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>

                  {/* Pending profile alert */}
                  {pendingProfileCount > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--vk-marigold-tint)', border: '1px solid var(--vk-marigold)', padding: '10px 14px', marginTop: 4 }}>
                      <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#7a5c00' }}>ข้อมูลพนักงานไม่ครบ</div>
                        <div style={{ fontSize: 12, color: '#9a7500', marginTop: 2 }}>มีพนักงาน <strong>{pendingProfileCount} คน</strong> ที่ยังกรอกข้อมูลไม่ครบถ้วน กรุณาตรวจสอบที่หน้าพนักงาน</div>
                      </div>
                    </div>
                  )}
                </div>
                <hr className="vk-rule" />
              </div>
            </div>

            {/* Payment channel breakdown */}
            {(paymentChannelStats ?? []).length > 0 && (() => {
              const sorted = [...(paymentChannelStats ?? [])].sort((a, b) => {
                const mul = channelSort.dir === 'asc' ? 1 : -1
                if (channelSort.key === 'channel') return mul * a.channel.localeCompare(b.channel, 'th')
                if (channelSort.key === 'count') return mul * (a.count - b.count)
                return mul * (a.total - b.total)
              })
              const toggleSort = (key: typeof channelSort.key) =>
                setChannelSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'channel' ? 'asc' : 'desc' })
              const SortIcon = ({ k }: { k: typeof channelSort.key }) => {
                if (channelSort.key !== k) return <ArrowUpDown style={{ width: 11, height: 11, opacity: 0.35 }} />
                return channelSort.dir === 'asc' ? <ArrowUp style={{ width: 11, height: 11, color: 'var(--vk-persimmon)' }} /> : <ArrowDown style={{ width: 11, height: 11, color: 'var(--vk-persimmon)' }} />
              }
              return (
                <div style={{ marginTop: 36 }}>
                  <div className="vk-eyebrow" style={{ marginBottom: 8 }}>PAYMENT CHANNELS · สรุปยอดแยกตามช่องทางจ่ายเงิน</div>
                  <hr className="vk-rule" />
                  <div style={{ marginTop: 0 }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 160px', background: 'var(--vk-bone)', borderBottom: '1px solid var(--vk-rule)' }}>
                      {([
                        { label: 'ช่องทาง', key: 'channel' as const, align: 'left' },
                        { label: 'จำนวน', key: 'count' as const, align: 'center' },
                        { label: 'ยอดสุทธิ (บาท)', key: 'total' as const, align: 'right' },
                      ]).map(col => (
                        <button key={col.key} onClick={() => toggleSort(col.key)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: channelSort.key === col.key ? 'var(--vk-persimmon)' : 'var(--vk-ink-3)', fontFamily: 'var(--vk-sans)' }}>
                          {col.label}
                          <SortIcon k={col.key} />
                        </button>
                      ))}
                    </div>
                    {sorted.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 160px', padding: '12px 16px', borderBottom: '1px solid var(--vk-rule-soft)', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {row.channel === 'เงินสด'
                            ? <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--vk-jade-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>💴</span>
                            : <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--vk-persimmon-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>💳</span>
                          }
                          <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 14, fontWeight: 600, color: 'var(--vk-ink)' }}>{row.channel}</span>
                        </div>
                        <div style={{ textAlign: 'center', fontFamily: 'var(--vk-mono)', fontSize: 13, color: 'var(--vk-ink-2)' }}>
                          {row.count} <span style={{ color: 'var(--vk-ink-3)', fontSize: 11 }}>คน</span>
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 15, fontWeight: 700, color: 'var(--vk-persimmon)', fontVariantNumeric: 'tabular-nums' }}>
                          {row.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}
                    {/* Total row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 160px', padding: '12px 16px', background: 'var(--vk-bone)', borderTop: '2px solid var(--vk-rule)', alignItems: 'center' }}>
                      <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>รวมทั้งหมด</div>
                      <div style={{ textAlign: 'center', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>
                        {(paymentChannelStats ?? []).reduce((s, r) => s + r.count, 0)} <span style={{ color: 'var(--vk-ink-3)', fontSize: 11, fontWeight: 400 }}>คน</span>
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 16, fontWeight: 800, color: 'var(--vk-persimmon)', fontVariantNumeric: 'tabular-nums' }}>
                        {(paymentChannelStats ?? []).reduce((s, r) => s + r.total, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>

      {/* Custom cancel-approval confirm dialog */}
      {showCancelConfirm && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCancelConfirm(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยืนยันการยกเลิกอนุมัติ</div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>งวด {activePeriod?.label}</div>
            </div>
            <div style={{ padding: '20px', fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.6, background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>การยกเลิกอนุมัติจะเปลี่ยนสถานะงวดกลับเป็น <strong>ฉบับร่าง</strong> และจะสามารถแก้ไขข้อมูลได้อีกครั้ง</div>
              <div style={{ padding: '10px 12px', background: 'var(--vk-crimson-tint)', border: '1px solid var(--vk-crimson)', fontSize: 13, color: 'var(--vk-crimson)', lineHeight: 1.5 }}>
                ⚠️ <strong>ลิงก์สลิปพนักงานทั้งหมดของงวดนี้จะถูกยกเลิกและลบทันที</strong> พนักงานจะไม่สามารถเข้าถึงสลิปผ่านลิงก์เดิมได้อีก และต้องสร้างลิงก์ใหม่เมื่ออนุมัติอีกครั้ง
              </div>
              <div>คุณต้องการดำเนินการต่อหรือไม่?</div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }}
                disabled={cancelApproveMutation.isPending}
                onClick={() => { cancelApproveMutation.mutate(); setShowCancelConfirm(false) }}>
                {cancelApproveMutation.isPending ? 'กำลังยกเลิก...' : 'ยืนยัน ยกเลิกอนุมัติ'}
              </button>
              <button className="vk-btn" onClick={() => setShowCancelConfirm(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete period confirm modal */}
      {/* Carry-over detail modal */}
      {showCarryOverModal && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCarryOverModal(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 480, overflow: 'hidden', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: 'var(--vk-crimson)', color: '#fff', padding: '16px 20px', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยอดยกไปงวดหน้า</div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>งวด {activePeriod?.label} · {stats?.carryOverDetails?.length ?? 0} รายการ</div>
            </div>
            {/* Table */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {/* thead */}
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px', padding: '8px 20px', background: 'var(--vk-bone)', borderBottom: '1px solid var(--vk-rule)', position: 'sticky', top: 0 }}>
                {['รหัส', 'ชื่อ-นามสกุล', 'ยอดยกไป'].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--vk-ink-3)', textAlign: i === 2 ? 'right' : 'left' }}>{h}</div>
                ))}
              </div>
              {/* rows */}
              {(stats?.carryOverDetails ?? []).map((d, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px', padding: '11px 20px', borderBottom: '1px solid var(--vk-rule-soft)', alignItems: 'center' }}>
                  <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)' }}>{d.employee_code}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)' }}>{d.first_name} {d.last_name}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-crimson)' }}>
                    − {d.deficit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
            {/* Footer total */}
            <div style={{ padding: '12px 20px', borderTop: '2px solid var(--vk-rule)', background: 'var(--vk-bone)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 13 }}>รวมยอดยกไปทั้งหมด</span>
              <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 800, fontSize: 18, color: 'var(--vk-crimson)' }}>
                − {(stats?.carryOver ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
              </span>
            </div>
            <div style={{ padding: '10px 20px', background: 'var(--vk-paper)', borderTop: '1px solid var(--vk-rule)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="vk-btn" onClick={() => setShowCarryOverModal(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {showDeletePeriodConfirm && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowDeletePeriodConfirm(false)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--vk-crimson)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Trash2 style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>ลบงวดนี้ออกจากระบบ</div>
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>งวด {activePeriod?.label}</div>
              </div>
            </div>
            <div style={{ padding: '20px', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.6, margin: 0 }}>
                งวดนี้จะถูก<strong>ลบออกจากระบบถาวร</strong> และระบบจะพร้อมให้คุณสร้างงวดใหม่ได้ทันที
              </p>
              <div style={{ padding: '10px 14px', background: 'var(--vk-crimson-tint)', border: '1px solid var(--vk-crimson)', fontSize: 12, color: 'var(--vk-crimson)', lineHeight: 1.5 }}>
                ⚠️ การดำเนินการนี้<strong>ไม่สามารถเรียกคืนได้</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
              <button className="vk-btn" onClick={() => setShowDeletePeriodConfirm(false)} style={{ flex: 1 }}>ยกเลิก</button>
              <button
                onClick={() => deletePeriodMutation.mutate()}
                disabled={deletePeriodMutation.isPending}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'var(--vk-crimson)', color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 13, padding: '0 16px', height: 36,
                  opacity: deletePeriodMutation.isPending ? 0.6 : 1,
                }}>
                <Trash2 style={{ width: 14, height: 14 }} />
                {deletePeriodMutation.isPending ? 'กำลังลบ...' : 'ยืนยัน ลบงวด'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
