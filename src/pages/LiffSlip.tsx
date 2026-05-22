import { useState, useEffect, useMemo } from 'react'
import { isWeekend } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { getLiffProfile } from '../lib/liff'
import { VKSlipDocument } from '../components/v2/VKSlipDocument'
import type { SlipIncomeRow, SlipDeductRow } from '../components/v2/VKSlipDocument'
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

    const { data: emp } = await supabase
      .from('employees')
      .select('id, national_id, line_uid')
      .eq('employee_code', empCode.trim().toUpperCase())
      .single()

    if (!emp) {
      setError('ไม่พบรหัสพนักงานนี้ในระบบ')
      setLoading(false)
      return
    }

    if (emp.line_uid && emp.line_uid !== lineUid) {
      setError('รหัสพนักงานนี้ถูกเชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อผู้ดูแลระบบ')
      setLoading(false)
      return
    }

    const last4 = (emp.national_id || '').replace(/[-\s]/g, '').slice(-4)
    if (last4 !== nationalId.trim()) {
      setError('เลขบัตรประชาชน 4 ตัวท้ายไม่ถูกต้อง')
      setLoading(false)
      return
    }

    const { error: updateError } = await supabase
      .from('employees')
      .update({ line_uid: lineUid })
      .eq('id', emp.id)

    if (updateError) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setLoading(false)
      return
    }

    setDone(true)
    setTimeout(() => onLinked(), 1200)
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

        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('line_uid', profile.userId)
          .single()

        if (!emp) {
          setPageState('link')
          return
        }

        // หา payroll entry ล่าสุด
        const { data: entry } = await supabase
          .from('payroll_entries')
          .select('id, period_id')
          .eq('employee_id', emp.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (!entry) {
          setEmployeeId(emp.id)
          setPageState('no_slip')
          return
        }

        setEmployeeId(emp.id)
        setPeriodId(entry.period_id)
        setPageState('slip')
      } catch (e: any) {
        setErrorMsg(e?.message || 'เกิดข้อผิดพลาด')
        setPageState('error')
      }
    })()
  }, [])

  // ── Payroll entry data ───────────────────────────────────────────────────────
  const { data: entryData } = useQuery({
    queryKey: ['liff-entry', employeeId, periodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          *,
          employee:employees(id, employee_code, first_name, last_name, position, rate_per_12h, payment_method, bank_name, bank_account, national_id),
          period:payroll_periods(period_start, period_end)
        `)
        .eq('employee_id', employeeId)
        .eq('period_id', periodId)
        .single()
      if (error) throw error
      return data
    },
    enabled: pageState === 'slip' && !!employeeId && !!periodId,
  })

  const { data: factoryData } = useQuery({
    queryKey: ['liff-factory', entryData?.employee?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('factories')
        .select('name')
        .single()
      return data
    },
    enabled: !!entryData,
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['liff-shifts', employeeId, periodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_assignments' as any)
        .select('work_date, is_holiday_ot, is_holiday_ot_exempt, is_half_shift, actual_hours, ot_hours')
        .eq('employee_id', employeeId)
        .eq('period_id', periodId)
      if (error) throw error
      return data as any[]
    },
    enabled: pageState === 'slip' && !!employeeId && !!periodId,
  })

  // ── Slip computation (mirrors EmployeeSlip) ──────────────────────────────────
  const slipProps = useMemo(() => {
    if (!entryData) return null
    const emp    = entryData.employee as any
    const period = entryData.period   as any
    const entry  = entryData          as any
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
    const baseNormal = 357
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
      <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--vk-paper)', gap: 16, padding: 24 }}>
        <AlertCircle style={{ width: 40, height: 40, color: 'var(--vk-ink-3)' }} />
        <p style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, color: 'var(--vk-ink)' }}>ยังไม่มีสลิปในระบบ</p>
        <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)', textAlign: 'center', lineHeight: 1.7 }}>
          สลิปจะแสดงเมื่อแอดมินออกค่าจ้างงวดนั้นเสร็จแล้ว
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
  if (!slipProps) return <LoadingScreen text="กำลังโหลดสลิป..." />

  return (
    <>
      <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <VKSlipDocument {...slipProps} />
        </div>
      </div>

      {/* Privacy warning */}
      {!accepted && <PrivacyWarning onAccept={() => setAccepted(true)} />}
    </>
  )
}
