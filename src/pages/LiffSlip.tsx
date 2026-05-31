import { useState, useEffect, useMemo } from 'react'
import { isWeekend } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { getLiffProfile } from '../lib/liff'
import type { SlipIncomeRow, SlipDeductRow } from '../components/VKSlipDocument'
import { ShieldAlert, Eye, Loader2, AlertCircle, Link2, CheckCircle2 } from 'lucide-react'
import '../styles/v2-tokens.css'

// ── types ─────────────────────────────────────────────────────────────────────
type PageState = 'loading' | 'link' | 'slip' | 'no_slip' | 'error'

const POSITIONS: Record<string, string> = {
  worker: 'พนักงานทั่วไป', clerk: 'เสมียน',
  foreman: 'โฟร์แมน', office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ',
}
const MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function maskBank(a?: string | null) {
  if (!a) return undefined
  const s = a.replace(/[-\s]/g, '')
  if (s.length <= 6) return s
  return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
}

// ── Loading screen ─────────────────────────────────────────────────────────────
function LoadingScreen({ text = 'กำลังโหลด...' }: { text?: string }) {
  return (
    <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16 }}>
      <Loader2 style={{ width: 32, height: 32, color: 'var(--vk-persimmon)', animation: 'spin 0.75s linear infinite' }} />
      <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, fontWeight: 600, color: 'var(--vk-ink-3)', letterSpacing: '0.04em' }}>{text}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Linking Form ───────────────────────────────────────────────────────────────
function LinkingForm({ lineUid, onLinked }: { lineUid: string; onLinked: () => void }) {
  const [empCode,    setEmpCode]    = useState('')
  const [nationalId, setNationalId] = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [done,       setDone]       = useState(false)

  const handleLink = async () => {
    if (!empCode.trim() || !nationalId.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบ')
      return
    }
    setLoading(true)
    setError('')

    const { data, error: rpcError } = await supabase.rpc('liff_link_employee', {
      p_employee_code:     empCode.trim(),
      p_national_id_last4: nationalId.trim(),
      p_line_uid:          lineUid,
    })

    if (rpcError) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setLoading(false)
      return
    }

    const result = data as { success?: boolean; error?: string }
    if (result?.error === 'not_found') {
      setError('ไม่พบรหัสพนักงานนี้ในระบบ')
    } else if (result?.error === 'inactive') {
      setError('บัญชีพนักงานนี้ถูกระงับการใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ')
    } else if (result?.error === 'already_linked') {
      setError('รหัสพนักงานนี้ถูกเชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อผู้ดูแลระบบ')
    } else if (result?.error === 'wrong_national_id') {
      setError('เลขบัตรประชาชน 4 ตัวท้ายไม่ถูกต้อง')
    } else if (result?.success) {
      setDone(true)
      setTimeout(() => onLinked(), 1200)
    } else {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16, padding: 24 }}>
        <CheckCircle2 style={{ width: 48, height: 48, color: 'var(--vk-jade)' }} />
        <p style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, color: 'var(--vk-ink)' }}>เชื่อม LINE สำเร็จ!</p>
        <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)' }}>กำลังโหลดสลิป...</p>
      </div>
    )
  }

  return (
    <div className="vk-root" style={{ minHeight: '100vh', background: 'var(--vk-bone)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', overflow: 'hidden' }}>

        {/* header */}
        <div style={{ background: 'var(--vk-persimmon)', padding: '28px 24px 24px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, background: 'rgba(255,255,255,0.15)', marginBottom: 14 }}>
            <Link2 style={{ width: 24, height: 24, color: '#fff' }} />
          </div>
          <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: '-0.01em' }}>เชื่อม LINE กับบัญชีพนักงาน</div>
          <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 6, lineHeight: 1.6 }}>
            ทำครั้งเดียว ครั้งถัดไปเปิดสลิปได้เลยโดยไม่ต้องกรอก
          </div>
        </div>

        {/* body */}
        <div style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <label style={{ fontFamily: 'var(--vk-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--vk-ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              รหัสพนักงาน
            </label>
            <input
              value={empCode}
              onChange={e => setEmpCode(e.target.value)}
              placeholder="เช่น EMP001"
              style={{ width: '100%', height: 44, fontFamily: 'var(--vk-sans)', fontSize: 14, border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontFamily: 'var(--vk-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--vk-ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              เลขบัตรประชาชน 4 ตัวท้าย
            </label>
            <input
              value={nationalId}
              onChange={e => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="เช่น 1234"
              maxLength={4}
              inputMode="numeric"
              style={{ width: '100%', height: 44, fontFamily: 'var(--vk-mono)', fontSize: 18, letterSpacing: '0.2em', border: '1px solid var(--vk-rule)', padding: '0 12px', background: 'var(--vk-paper)', color: 'var(--vk-ink)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 12px' }}>
              <AlertCircle style={{ width: 14, height: 14, color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: '#b91c1c' }}>{error}</span>
            </div>
          )}

          <button
            onClick={handleLink}
            disabled={loading}
            style={{ height: 48, background: loading ? 'var(--vk-ink-3)' : 'var(--vk-persimmon)', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 15, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.15s', marginTop: 4 }}
          >
            {loading
              ? <><Loader2 style={{ width: 16, height: 16, animation: 'spin 0.75s linear infinite' }} />กำลังตรวจสอบ...</>
              : 'ยืนยัน'}
          </button>

          <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 11, color: 'var(--vk-ink-3)', textAlign: 'center', lineHeight: 1.6, marginTop: 4 }}>
            ข้อมูลถูกใช้เพื่อยืนยันตัวตนเท่านั้น<br />ไม่มีการเก็บรหัสบัตรประชาชนในระบบ
          </p>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Mobile Slip View ──────────────────────────────────────────────────────────
interface MobileSlipProps {
  branchName: string
  employeeName: string
  employeeCode: string
  positionLabel?: string
  periodLabel: string
  paymentMethod: string
  bankName?: string
  bankAccount?: string
  income: SlipIncomeRow[]
  deductions: SlipDeductRow[]
  totalIncome: number
  totalDeduct: number
  netPay: number
  workingDays?: number
}

const mono = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })
const F = 'Sarabun, "Noto Sans Thai", sans-serif'

function MobileSlipView(p: MobileSlipProps) {
  return (
    <div style={{ fontFamily: F, color: '#1a1a1a', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 24px rgba(0,0,0,0.10)' }}>

      {/* ── Header ── */}
      <div style={{ background: 'var(--vk-persimmon)', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <img src="/logo.png" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 3, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.3 }}>ห้างหุ้นส่วนจำกัด วิราญกร</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>ใบสลิปเงินเดือน</div>
          </div>
        </div>
        {/* period badge */}
        <div style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>งวดจ่ายเงิน</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{p.periodLabel}</span>
        </div>
      </div>

      {/* ── Employee Info ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#aaa', textTransform: 'uppercase', marginBottom: 6 }}>พนักงาน</div>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#1a1a1a' }}>{p.employeeName}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
          <span style={{ fontFamily: 'monospace' }}>{p.employeeCode}</span>
          {p.positionLabel ? ` · ${p.positionLabel}` : ''}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>วิธีรับเงิน</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.paymentMethod === 'bank_transfer' ? 'โอนธนาคาร' : 'เงินสด'}</div>
            {p.bankName && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{p.bankName}{p.bankAccount ? ` · ${p.bankAccount}` : ''}</div>}
          </div>
          {p.workingDays ? (
            <div style={{ flex: 1, background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>วันทำงาน</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vk-persimmon)' }}>{p.workingDays}<span style={{ fontSize: 12, fontWeight: 400, color: '#aaa', marginLeft: 4 }}>วัน</span></div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Income ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#aaa', textTransform: 'uppercase', marginBottom: 10 }}>รายได้</div>
        {p.income.map((r, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{mono(r.value)}</span>
            </div>
            {r.detail && <div style={{ fontSize: 11, color: 'var(--vk-persimmon)', marginTop: 2, fontFamily: 'monospace' }}>{r.detail}</div>}
            {r.subs?.map((s, j) => <div key={j} style={{ fontSize: 11, color: '#aaa', marginTop: 1, paddingLeft: 8 }}>· {s}</div>)}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9f9f9', borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#555' }}>รวมรายได้</span>
          <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#1a7a3c' }}>{mono(p.totalIncome)}</span>
        </div>
      </div>

      {/* ── Deductions ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#aaa', textTransform: 'uppercase', marginBottom: 10 }}>รายการหัก</div>
        {p.deductions.length === 0
          ? <div style={{ fontSize: 13, color: '#ccc', padding: '4px 0' }}>ไม่มีรายการหัก</div>
          : p.deductions.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#c0392b' }}>{mono(r.value)}</span>
            </div>
          ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff5f5', borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#555' }}>รวมรายการหัก</span>
          <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#c0392b' }}>{mono(p.totalDeduct)}</span>
        </div>
      </div>

      {/* ── Net Pay ── */}
      <div style={{ padding: '20px 20px', background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: 8 }}>เงินได้สุทธิ · NET PAY</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 38, fontWeight: 900, fontFamily: 'monospace', color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>{mono(p.netPay)}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', paddingBottom: 4 }}>บาท</div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ padding: '10px 20px', background: '#f7f7f7', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#ccc' }}>เอกสารแสดงรายได้อย่างเป็นทางการ · ห้างหุ้นส่วนจำกัด วิราญกร</div>
      </div>
    </div>
  )
}

// ── Privacy Warning ────────────────────────────────────────────────────────────
function PrivacyWarning({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(22,19,17,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380, overflow: 'hidden' }}>
        <div style={{ background: 'var(--vk-ink)', padding: '22px 28px 20px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, background: 'rgba(255,255,255,0.08)', marginBottom: 14 }}>
            <ShieldAlert style={{ width: 26, height: 26, color: 'var(--vk-marigold, #f59e0b)' }} />
          </div>
          <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, color: 'var(--vk-bone)', letterSpacing: '-0.01em' }}>แจ้งเตือนความเป็นส่วนตัว</div>
          <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6, lineHeight: 1.5 }}>
            ระบบกำลังจะแสดงผลข้อมูลสลิปเงินเดือน<br />และข้อมูลส่วนบุคคลของท่าน
          </div>
        </div>
        <div style={{ padding: '20px 28px', background: 'var(--vk-bone)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '14px 16px' }}>
            <Eye style={{ width: 16, height: 16, color: 'var(--vk-ink-3)', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-2)', lineHeight: 1.65, margin: 0 }}>
              ข้อมูลนี้เป็นข้อมูลส่วนตัวและมีความสำคัญ โปรดระมัดระวังการเปิดอ่านในที่สาธารณะ
            </p>
          </div>
        </div>
        <div style={{ padding: '0 28px 24px', background: 'var(--vk-bone)' }}>
          <button
            onClick={onAccept}
            style={{ width: '100%', height: 48, background: 'var(--vk-jade)', border: 'none', cursor: 'pointer', fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 15, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            ยืนยันเพื่อดูข้อมูล
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function LiffSlip() {
  const [pageState,   setPageState]   = useState<PageState>('loading')
  const [lineUid,     setLineUid]     = useState('')
  const [employeeId,  setEmployeeId]  = useState('')
  const [periodId,    setPeriodId]    = useState('')
  const [accepted,    setAccepted]    = useState(false)
  const [errorMsg,    setErrorMsg]    = useState('')

  // ── LIFF init + employee lookup ──────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const profile = await getLiffProfile()
        if (!profile) return // กำลัง redirect ไป LINE Login

        setLineUid(profile.userId)

        const { data: info, error: rpcError } = await supabase.rpc('liff_get_slip_info', {
          p_line_uid: profile.userId,
        })

        if (rpcError) throw rpcError

        const result = info as { status: string; employee_id?: string; period_id?: string }

        if (result.status === 'not_linked') {
          setPageState('link')
          return
        }

        if (result.status === 'inactive') {
          setErrorMsg('บัญชีพนักงานนี้ถูกระงับการใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ')
          setPageState('error')
          return
        }

        if (result.status === 'no_approved_slip') {
          // บัญชีผูกแล้ว แต่ยังไม่มีงวดที่อนุมัติ
          setEmployeeId(result.employee_id ?? '')
          setPageState('no_slip')
          return
        }

        // status === 'ok'
        setEmployeeId(result.employee_id!)
        setPeriodId(result.period_id!)
        setPageState('slip')
      } catch (e: any) {
        setErrorMsg(e?.message || 'เกิดข้อผิดพลาด')
        setPageState('error')
      }
    })()
  }, [])

  // ── Payroll entry data (single RPC to bypass RLS) ───────────────────────────
  const { data: rpcData, error: rpcDataError } = useQuery({
    queryKey: ['liff-entry', employeeId, periodId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('liff_get_entry_data', {
        p_employee_id: employeeId,
        p_period_id:   periodId,
      })
      if (error) throw error
      if (!data) throw new Error('ไม่พบข้อมูลสลิปในระบบ')
      return data as { entry: any; factory: any; shifts: any[] }
    },
    enabled: pageState === 'slip' && !!employeeId && !!periodId,
    retry: false,
  })

  const entryData  = rpcData?.entry   ?? null
  const factoryData = rpcData?.factory ?? null
  const shifts      = rpcData?.shifts  ?? []

  // ── Slip computation (mirrors EmployeeSlip) ──────────────────────────────────
  const slipProps = useMemo(() => {
    if (!entryData) return null
    const emp    = entryData.employee as any
    const period = entryData.period   as any
    const entry  = entryData as any
    const isClerk = emp.position === 'clerk'

    // shift counts
    const normShifts   = shifts.filter(s => !s.is_holiday_ot || s.is_holiday_ot_exempt)
    const days_normal  = normShifts.length
    const days_shift   = normShifts.filter(s => !s.is_half_shift && !s.actual_hours).length
    const clerkOt1_5xH = shifts.filter(s => !isWeekend(new Date(s.work_date))).reduce((a, s) => a + Number(s.ot_hours || 0), 0)
    const clerkOt1xH   = shifts.filter(s =>  isWeekend(new Date(s.work_date))).reduce((a, s) => a + Number(s.ot_hours || 0), 0)

    const clerkMonthly = Number(emp.rate_per_12h || 0)
    const clerkHourly  = (clerkMonthly / 30) / 8
    const computed_ot_1x = isClerk ? clerkHourly * clerkOt1xH : 0
    const amtOt     = isClerk ? Math.max(0, (entry.amount_ot || 0) - computed_ot_1x) : Number(entry.amount_ot || 0)
    const amtOt1x   = isClerk ? computed_ot_1x : 0

    // formula details (same as EmployeeSlip)
    const baseNormal = Number(emp.rate_per_12h) === 0 ? 0 : 357
    const dnDays = days_normal
    const dsDays = isClerk ? shifts.filter(s => isWeekend(new Date(s.work_date)) && !s.is_holiday_ot).length : days_shift
    const dn = dnDays > 0 ? Number(entry.amount_normal || 0) / dnDays : 0
    const ds = dsDays > 0 ? Number(entry.amount_shift  || 0) / dsDays : 0
    const otHrs  = isClerk && clerkHourly > 0 ? Math.round(amtOt   / (clerkHourly * 1.5)) : 0
    const ot1Hrs = isClerk && clerkHourly > 0 ? Math.round(amtOt1x / clerkHourly)         : 0
    const otDays = !isClerk && (baseNormal + ds) > 0 ? Math.round(amtOt / ((baseNormal + ds) * 2)) : 0

    const detailNormal = dnDays > 0 ? (isClerk ? `฿${Math.round(dn)} × ${dnDays} วัน` : `฿${baseNormal} × ${dnDays} วัน`) : null
    const detailShift  = !isClerk && dsDays > 0 && ds > 0 ? `฿${Math.round(ds)} × ${dsDays} วัน` : null
    const detailOt     = isClerk && otHrs  > 0 ? `฿${clerkHourly.toFixed(2)} × 1.5 × ${otHrs} ชม.`
                       : !isClerk && otDays > 0 ? `฿${Math.round(baseNormal + ds)} × 2 × ${otDays} วัน` : null
    const detailOt1x   = isClerk && ot1Hrs > 0 ? `฿${clerkHourly.toFixed(2)} × 1.0 × ${ot1Hrs} ชม.` : null

    const specialSubs = (entry.special_note as string || '').split(',').map((s: string) => s.trim()).filter(Boolean)

    const amtNormal  = Number(entry.amount_normal     || 0)
    const amtShift   = isClerk ? 0 : Number(entry.amount_shift || 0)
    const amtWood    = Number(entry.amount_wood_excess || 0)
    const amtFilm    = Number(entry.amount_film        || 0)
    const amtSpecial = Number(entry.amount_special     || 0)
    const amtDilig   = Number(entry.amount_diligence   || 0)
    const amtPos     = Number(entry.amount_position    || 0)
    const dSS        = Number(entry.deduct_social_security    || 0)
    const dAdv       = Number(entry.deduct_advance            || 0)
    const dSafe      = Number(entry.deduct_safety_equipment   || 0)
    const dUni       = Number(entry.deduct_uniform            || 0)

    const income: SlipIncomeRow[] = [
      { label: isClerk ? 'ค่าจ้างปกติ (วันธรรมดา)' : 'ค่าจ้างปกติ (8 ชม.)', value: amtNormal, detail: detailNormal, subs: [] },
      { label: 'ค่ากะ (4 ชม.)',                                                 value: amtShift,  detail: detailShift,  subs: [] },
      { label: isClerk ? 'OT ล่วงเวลา (×1.5)' : 'OT วันหยุดนักขัตฤกษ์ (×2)', value: amtOt,    detail: detailOt,     subs: [] },
      { label: 'OT วันหยุดสัปดาห์ (×1)',                                        value: isClerk ? amtOt1x : 0, detail: detailOt1x, subs: [] },
      { label: 'ค่าไม้ส่วนเกิน',  value: amtWood,    detail: null, subs: [] },
      { label: 'ค่าฟิล์ม',        value: amtFilm,    detail: null, subs: [] },
      { label: 'เงินพิเศษ',       value: amtSpecial, detail: null, subs: specialSubs },
      { label: 'เบี้ยขยัน',       value: amtDilig,   detail: null, subs: [] },
      { label: 'ค่าตำแหน่ง',      value: amtPos,     detail: null, subs: [] },
    ].filter(r => r.value > 0 && r.label !== '') as SlipIncomeRow[]

    const deductions: SlipDeductRow[] = [
      { label: 'ประกันสังคม',            value: dSS   },
      { label: 'เบิกล่วงหน้า',           value: dAdv  },
      { label: 'ค่าอุปกรณ์ความปลอดภัย', value: dSafe },
      { label: 'ค่าเสื้อพนักงาน',        value: dUni  },
    ].filter(r => r.value > 0)

    const totalIncome = income.reduce((s, r) => s + r.value, 0)
    const totalDeduct = deductions.reduce((s, r) => s + r.value, 0)

    const s = new Date(period.period_start), e = new Date(period.period_end)
    const periodLabel = `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear() + 543}`
    const workingDays = isClerk ? (dnDays + dsDays) : dnDays

    const COMPANY_FULL: Record<string, string> = {
      'ผลิตภัณฑ์ตราเพชร': 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
      'ทีพีไอ โพลีน': 'บริษัท ทีพีไอ โพลีน จำกัด (มหาชน)',
    }
    let branchName = factoryData?.name || ''
    for (const [key, full] of Object.entries(COMPANY_FULL)) {
      if (branchName.includes(key)) { branchName = full; break }
    }

    return {
      branchName,
      employeeName:  `${emp.first_name} ${emp.last_name}`,
      employeeCode:  emp.employee_code,
      positionLabel: POSITIONS[emp.position] || emp.position || '',
      periodLabel,
      paymentMethod: emp.payment_method || 'cash',
      bankName:      emp.bank_name,
      bankAccount:   maskBank(emp.bank_account),
      income,
      deductions,
      totalIncome,
      totalDeduct,
      netPay:        totalIncome - totalDeduct,
      workingDays:   workingDays > 0 ? workingDays : undefined,
    }
  }, [entryData, shifts, factoryData])

  // ── Render ───────────────────────────────────────────────────────────────────

  if (pageState === 'loading') return <LoadingScreen text="กำลังเชื่อมต่อ LINE..." />

  if (pageState === 'link') {
    return <LinkingForm lineUid={lineUid} onLinked={() => { setPageState('loading'); window.location.reload() }} />
  }

  if (pageState === 'no_slip') {
    return (
      <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16, padding: 24, textAlign: 'center' }}>
        <AlertCircle style={{ width: 40, height: 40, color: 'var(--vk-ink-3)' }} />
        <p style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, color: 'var(--vk-ink)' }}>ยังไม่มีสลิปที่เปิดดูได้</p>
        <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)', lineHeight: 1.8, maxWidth: 280 }}>
          สลิปจะแสดงเมื่อแอดมิน<strong>อนุมัติงวด</strong>เรียบร้อยแล้ว<br />
          กรุณารอการแจ้งจากผู้ดูแลระบบค่ะ
        </p>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16, padding: 24 }}>
        <AlertCircle style={{ width: 40, height: 40, color: 'var(--vk-crimson)' }} />
        <p style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, color: 'var(--vk-ink)' }}>เกิดข้อผิดพลาด</p>
        <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)' }}>{errorMsg}</p>
      </div>
    )
  }

  // slip state
  if (rpcDataError) return (
    <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16, padding: 24 }}>
      <AlertCircle style={{ width: 40, height: 40, color: 'var(--vk-crimson)' }} />
      <p style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, color: 'var(--vk-ink)' }}>โหลดสลิปไม่สำเร็จ</p>
      <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, color: 'var(--vk-ink-3)', textAlign: 'center' }}>{(rpcDataError as any)?.message}</p>
    </div>
  )
  if (!slipProps) return <LoadingScreen text="กำลังโหลดสลิป..." />

  return (
    <>
      <div className="vk-root" style={{ minHeight: '100vh', background: 'var(--vk-bone)', padding: '20px 16px 40px' }}>
        <MobileSlipView {...slipProps} />
      </div>

      {/* Privacy warning */}
      {!accepted && <PrivacyWarning onAccept={() => setAccepted(true)} />}
    </>
  )
}
