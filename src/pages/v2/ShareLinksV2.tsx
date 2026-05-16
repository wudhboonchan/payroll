import { useState, useEffect, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { toast } from 'sonner'
import { Copy, Check, RefreshCw, Link2, Search, FileDown, RotateCcw, AlertCircle } from 'lucide-react'
import '../../styles/v2-tokens.css'

type SlipStatus = 'pending' | 'confirmed' | 'disputed' | 'auto_confirmed'
type FilterStatus = 'all' | SlipStatus

interface TokenRow {
  id: string
  token: string
  expires_at: string
  employee_status: SlipStatus
  dispute_reason: string | null
  created_at?: string
  employees: {
    employee_code: string
    first_name: string
    last_name: string
    nationality?: string
  }
}

const STATUS_MAP: Record<SlipStatus, { tone: string; label: string }> = {
  pending:        { tone: 'accent',   label: 'รอยืนยัน' },
  confirmed:      { tone: 'approved', label: 'ยืนยันแล้ว' },
  disputed:       { tone: 'danger',   label: 'ทักท้วง' },
  auto_confirmed: { tone: 'info',     label: 'ยืนยันอัตโนมัติ' },
}

function CopyButton({ text, label, icon }: { text: string; label: string; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={handle} className="vk-btn vk-btn--ghost" style={{ height: 28, padding: '0 10px', fontSize: 11, gap: 4, display: 'inline-flex', alignItems: 'center' }}>
      {copied
        ? <><Check style={{ width: 11, height: 11, color: 'var(--vk-jade)' }} />คัดลอกแล้ว</>
        : <>{icon ?? <Copy style={{ width: 11, height: 11 }} />}{label}</>
      }
    </button>
  )
}

export default function ShareLinksV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'status'>('code')
  const [showResetConfirm, setShowResetConfirm] = useState<string | null>(null) // tokenId

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*')
        .eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id, staleTime: 0,
  })

  // Auto-select most recent approved period, then latest
  const hasInit = useRef(false)
  useEffect(() => {
    if (!hasInit.current && periods.length > 0) {
      const approved = periods.find(p => p.status === 'approved')
      setSelectedPeriodId(approved?.id ?? periods[0].id)
      hasInit.current = true
    }
  }, [periods])

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0]
  const isApproved = activePeriod?.status === 'approved'

  const { data: tokens = [] } = useQuery<TokenRow[]>({
    queryKey: ['payslip_tokens', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod) return []
      const { data, error } = await supabase.from('payslip_tokens')
        .select('id,token,expires_at,employee_status,dispute_reason,created_at,employees(employee_code,first_name,last_name,nationality)')
        .eq('period_id', activePeriod.id).order('created_at')
      if (error) throw error
      // Derive auto_confirmed client-side (same as V1)
      return (data as unknown as TokenRow[]).map(t => {
        if (t.employee_status === 'pending' && t.expires_at) {
          const sentAt = new Date(t.expires_at).getTime() - 30 * 24 * 60 * 60 * 1000
          if ((Date.now() - sentAt) / (1000 * 60 * 60) >= 24) {
            return { ...t, employee_status: 'auto_confirmed' as SlipStatus }
          }
        }
        return t
      })
    },
    enabled: !!activePeriod,
    staleTime: 0,
    refetchInterval: 8000,
  })

  // Realtime subscription
  useEffect(() => {
    if (!activePeriod?.id) return
    const channel = supabase.channel(`tokens-v2-${activePeriod.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payslip_tokens', filter: `period_id=eq.${activePeriod.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['payslip_tokens', activePeriod.id] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activePeriod?.id, queryClient])

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!activePeriod?.id || !user?.factory_id) throw new Error('ไม่พบงวด')
      const { data: employees, error: empErr } = await supabase.from('employees')
        .select('id').eq('factory_id', user.factory_id).eq('status', 'active')
      if (empErr) throw empErr

      const { data: existing, error: exErr } = await supabase.from('payslip_tokens')
        .select('employee_id').eq('period_id', activePeriod.id)
      if (exErr) throw exErr

      const existingIds = new Set(existing?.map(t => t.employee_id) ?? [])
      const newEmps = (employees ?? []).filter(e => !existingIds.has(e.id))
      if (newEmps.length === 0) { toast.info('ทุกคนมีลิงก์แล้ว'); return }

      const rows = newEmps.map(e => ({
        period_id: activePeriod.id,
        employee_id: e.id,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        employee_status: 'pending',
      }))
      const { error } = await supabase.from('payslip_tokens').insert(rows)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payslip_tokens', activePeriod?.id] }); toast.success('สร้างลิงก์เรียบร้อยแล้ว') },
    onError: (e: Error) => toast.error('สร้างลิงก์ไม่สำเร็จ', { description: e.message }),
  })

  const regenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase.from('payslip_tokens').update({
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        employee_status: 'pending',
        dispute_reason: null,
      }).eq('id', tokenId)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payslip_tokens', activePeriod?.id] }); toast.success('รีเซ็ตลิงก์แล้ว') },
    onError: (e: Error) => toast.error('รีเซ็ตไม่สำเร็จ', { description: e.message }),
  })

  const counts = useMemo(() => ({
    total:          tokens.length,
    confirmed:      tokens.filter(t => t.employee_status === 'confirmed' || t.employee_status === 'auto_confirmed').length,
    pending:        tokens.filter(t => t.employee_status === 'pending').length,
    disputed:       tokens.filter(t => t.employee_status === 'disputed').length,
    auto_confirmed: tokens.filter(t => t.employee_status === 'auto_confirmed').length,
  }), [tokens])

  const filtered = useMemo(() => {
    let list = [...tokens]
    if (filterStatus !== 'all') list = list.filter(t => t.employee_status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.employees?.employee_code?.toLowerCase().includes(q) ||
        t.employees?.first_name?.toLowerCase().includes(q) ||
        t.employees?.last_name?.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => {
      if (sortBy === 'code') return (a.employees?.employee_code ?? '').localeCompare(b.employees?.employee_code ?? '')
      if (sortBy === 'name') return (a.employees?.first_name ?? '').localeCompare(b.employees?.first_name ?? '')
      return a.employee_status.localeCompare(b.employee_status)
    })
  }, [tokens, filterStatus, search, sortBy])

  const buildLinksText = () => {
    const lines = filtered.map(t => {
      const emp = t.employees
      const name = `${emp?.employee_code} ${emp?.first_name} ${emp?.last_name}`.trim()
      const url = `${window.location.origin}/slip/${t.token}`
      return `${name}\n${url}`
    })
    return [
      `ใบแจ้งค่าแรง ${activePeriod?.label ?? ''} — ${user?.factory_id ?? ''}`,
      '',
      ...lines.flatMap(l => [l, '']),
      '*กรุณาตรวจสอบและยืนยันภายใน 24 ชม.*',
      'หากพ้นกำหนด ระบบจะถือว่าท่านตรวจสอบความถูกต้องแล้วโดยอัตโนมัติค่ะ',
    ].join('\n')
  }

  const handleCopyAll = () => {
    navigator.clipboard.writeText(buildLinksText())
    toast.success('คัดลอกลิงก์ทั้งหมดแล้ว')
  }

  const handleExportTxt = () => {
    const blob = new Blob([buildLinksText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `payslip_links_${activePeriod?.label?.replace(/\s+/g, '_') ?? 'export'}.txt`
    a.click(); URL.revokeObjectURL(url)
  }

  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'superUser'

  return (
    <>
      <TopBarV2 title="ลิงก์สลิปพนักงาน" subtitle={activePeriod?.label} onMenuClick={onMenuClick} />

      <div className="vk-page vk-page--wide">

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 6 }}>SHARE LINKS · ลิงก์สลิปสำหรับพนักงาน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>
              {activePeriod?.label ?? 'ยังไม่มีงวด'}
              {activePeriod && <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)', fontSize: 18 }}> — {isApproved ? 'อนุมัติแล้ว' : 'ฉบับร่าง'}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {periods.length > 1 && (
              <select value={selectedPeriodId ?? ''} onChange={e => setSelectedPeriodId(e.target.value)}
                style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, height: 36, border: '1px solid var(--vk-rule)', padding: '0 10px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
                {periods.map(p => <option key={p.id} value={p.id}>{p.label}{p.status === 'approved' ? ' ✓' : ' (ร่าง)'}</option>)}
              </select>
            )}
            {isAdminOrSuper && (
              <button className="vk-btn vk-btn--primary" onClick={() => generateMutation.mutate()}
                disabled={!isApproved || generateMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw style={{ width: 13, height: 13 }} className={generateMutation.isPending ? 'animate-spin' : ''} />
                {generateMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง / อัปเดตลิงก์'}
              </button>
            )}
          </div>
        </div>

        {!isApproved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb', border: '1px solid #fbbf24', padding: '10px 14px', marginBottom: 24, fontSize: 13, color: '#92400e' }}>
            <AlertCircle style={{ width: 15, height: 15, flexShrink: 0 }} />
            งวดนี้ยังไม่ได้อนุมัติ — ต้องอนุมัติงวดก่อนจึงจะสร้างลิงก์ได้
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, border: '1px solid var(--vk-rule)', marginBottom: 32 }}>
          {[
            { label: 'ทั้งหมด',          value: counts.total,          color: 'var(--vk-ink)' },
            { label: 'ยืนยันแล้ว',        value: counts.confirmed,      color: 'var(--vk-jade)' },
            { label: 'รอยืนยัน',          value: counts.pending,        color: 'var(--vk-persimmon)' },
            { label: 'ทักท้วง',           value: counts.disputed,       color: 'var(--vk-crimson)' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '20px 24px', borderRight: i < 3 ? '1px solid var(--vk-rule)' : 'none', background: 'var(--vk-bone)' }}>
              <div className="vk-eyebrow" style={{ marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, fontSize: 32, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Filter tabs */}
            <div style={{ display: 'flex', border: '1px solid var(--vk-rule)', overflow: 'hidden' }}>
              {(['all', 'pending', 'confirmed', 'disputed', 'auto_confirmed'] as FilterStatus[]).map((s, i, arr) => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  style={{ padding: '5px 12px', fontSize: 12, fontFamily: 'var(--vk-sans)', fontWeight: filterStatus === s ? 700 : 400, border: 'none', borderRight: i < arr.length - 1 ? '1px solid var(--vk-rule)' : 'none', cursor: 'pointer', background: filterStatus === s ? 'var(--vk-ink)' : 'var(--vk-paper)', color: filterStatus === s ? 'var(--vk-bone)' : 'var(--vk-ink-3)', transition: 'all 0.15s' }}>
                  {{ all: 'ทั้งหมด', pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', disputed: 'ทักท้วง', auto_confirmed: 'อัตโนมัติ' }[s]}
                </button>
              ))}
            </div>
            {/* Sort */}
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, height: 30, border: '1px solid var(--vk-rule)', padding: '0 8px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none' }}>
              <option value="code">เรียงตามรหัส</option>
              <option value="name">เรียงตามชื่อ</option>
              <option value="status">เรียงตามสถานะ</option>
            </select>
            {/* Search */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search style={{ position: 'absolute', left: 8, width: 12, height: 12, color: 'var(--vk-ink-3)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา..."
                style={{ paddingLeft: 26, paddingRight: 8, height: 30, fontSize: 12, fontFamily: 'var(--vk-sans)', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', width: 160 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="vk-btn vk-btn--ghost" onClick={handleExportTxt} disabled={filtered.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, height: 30, padding: '0 12px' }}>
              <FileDown style={{ width: 12, height: 12 }} />Export .txt
            </button>
            <button className="vk-btn vk-btn--primary" onClick={handleCopyAll} disabled={filtered.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, height: 30, padding: '0 12px' }}>
              <Copy style={{ width: 12, height: 12 }} />คัดลอกลิงก์ทั้งหมด
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="vk-eyebrow" style={{ marginBottom: 8 }}>LINKS · รายชื่อพนักงาน ({filtered.length} คน)</div>
        <hr className="vk-rule" />

        {filtered.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Link2 style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.2 }} />
            <div className="vk-eyebrow">ยังไม่มีลิงก์ในงวดนี้</div>
            <div style={{ fontSize: 13, color: 'var(--vk-ink-3)', marginTop: 6 }}>
              {isApproved ? 'กดปุ่ม "สร้าง / อัปเดตลิงก์" เพื่อเริ่มต้น' : 'ต้องอนุมัติงวดก่อน'}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['รหัส', 'ชื่อ – ลิงก์', 'สถานะ', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 2 ? 'right' : 'left', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-ink-3)', padding: '10px 14px', borderBottom: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const emp = t.employees
                const slipUrl = `${window.location.origin}/slip/${t.token}`
                const isExpired = new Date(t.expires_at) < new Date()
                const s = STATUS_MAP[t.employee_status] ?? { tone: 'draft', label: t.employee_status }
                const messageText = `ใบแจ้งค่าแรง: ${emp?.first_name} ${emp?.last_name}\nคลิกเพื่อดูสลิป: ${slipUrl}\n\n*กรุณาตรวจสอบและยืนยันภายใน 24 ชม.*\n(หากพ้นกำหนด ระบบจะยืนยันความถูกต้องให้อัตโนมัติค่ะ)`
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                    <td style={{ padding: '12px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12, color: 'var(--vk-ink-2)', verticalAlign: 'top', paddingTop: 16 }}>
                      {emp?.employee_code}
                    </td>
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--vk-ink)', marginBottom: 3 }}>
                        {emp?.first_name} {emp?.last_name}
                      </div>
                      <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={slipUrl}>
                        {slipUrl}
                      </div>
                      {t.employee_status === 'disputed' && t.dispute_reason && (
                        <div style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, background: '#fef2f2', border: '1px solid #fecaca', padding: '6px 10px', marginTop: 6, fontSize: 12, color: '#b91c1c', maxWidth: 380 }}>
                          <AlertCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
                          <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.dispute_reason}</span>
                        </div>
                      )}
                      {isExpired && <div style={{ fontSize: 11, color: 'var(--vk-persimmon)', marginTop: 4 }}>⏰ ลิงก์หมดอายุแล้ว</div>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', verticalAlign: 'top', paddingTop: 15 }}>
                      <span className="vk-pill" data-tone={s.tone}>● {s.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', verticalAlign: 'top', paddingTop: 13 }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <CopyButton text={slipUrl} label="ลิงก์" icon={<Link2 style={{ width: 11, height: 11 }} />} />
                        <CopyButton text={messageText} label="ข้อความ" />
                        {isAdminOrSuper && (
                          <button className="vk-btn vk-btn--ghost" onClick={() => setShowResetConfirm(t.id)}
                            style={{ height: 28, padding: '0 10px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title="สร้างลิงก์ใหม่ (ลิงก์เก่าจะถูกยกเลิก)">
                            <RotateCcw style={{ width: 11, height: 11 }} />รีเซ็ต
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset confirm dialog */}
      {showResetConfirm && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowResetConfirm(null)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 360 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยืนยันการรีเซ็ตลิงก์</div>
            </div>
            <div style={{ padding: '20px', fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.6, background: 'var(--vk-bone)' }}>
              ลิงก์เก่าจะถูกยกเลิกทันทีและพนักงานจะไม่สามารถเข้าดูสลิปจากลิงก์เดิมได้อีก
              <br />คุณต้องการดำเนินการต่อหรือไม่?
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }}
                disabled={regenMutation.isPending}
                onClick={() => { regenMutation.mutate(showResetConfirm!); setShowResetConfirm(null) }}>
                ยืนยัน รีเซ็ตลิงก์
              </button>
              <button className="vk-btn" onClick={() => setShowResetConfirm(null)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
