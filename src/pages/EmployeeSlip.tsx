import { useState, useEffect, useMemo } from 'react'
import { isWeekend } from 'date-fns'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

import { VKSlipDocument } from '../components/VKSlipDocument'
import type { SlipIncomeRow, SlipDeductRow } from '../components/VKSlipDocument'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'

import { CheckCircle2, AlertCircle, Clock, Loader2, ShieldAlert, Eye } from 'lucide-react'
import '../styles/tokens.css'

interface PayslipRPCResponse {
  token_data: {
    employee_id: string
    period_id: string
    employee_status: string
    created_at: string
    expires_at: string
  }
  employee: {
    employee_code: string
    first_name: string
    last_name: string
    payment_method: string
    bank_name: string
    bank_account_no: string
    bank_account: string
  }
  period: {
    period_start: string
    period_end: string
  }
  entry: {
    amount_normal: number
    amount_shift: number
    amount_ot: number
    amount_wood_excess: number
    amount_film: number
    amount_special: number
    amount_diligence: number
    amount_position: number
    deduct_social_security: number
    deduct_advance: number
    deduct_safety_equipment: number
    deduct_uniform: number
  }
  factory: {
    name: string
  }
}

interface ShiftAssignment {
  is_holiday_ot: boolean
  is_half_shift: boolean
  ot_hours: number
  work_date: string
}

export default function EmployeeSlip() {
  const { token } = useParams<{ token: string }>()
  const [manuallyUpdatedStatus, setManuallyUpdatedStatus] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [hasAcceptedWarning, setHasAcceptedWarning] = useState(false)

  const { data: rawData, isLoading: isLoadingToken, error: errorToken } = useQuery<PayslipRPCResponse | string>({
    queryKey: ['slip_token_data', token],
    queryFn: async () => {
      if (!token) throw new Error('No token provided')
      const { data, error } = await supabase.rpc('get_payslip_data', { p_token: token })
      
      if (error) {
        console.error('RPC Error:', error)
        throw new Error('ไม่สามารถดึงข้อมูลได้ (โปรดตรวจสอบการตั้งค่าฐานข้อมูล)')
      }
      if (!data) throw new Error('ไม่พบข้อมูลสลิป (Token ไม่ถูกต้อง หรือหมดอายุ)')
      
      return data as PayslipRPCResponse | string
    },
    enabled: !!token,
    retry: false
  })

  // Extract the structured data
  const tokenData = useMemo(() => {
    if (!rawData) return null
    return typeof rawData === 'string' ? JSON.parse(rawData)?.token_data : rawData?.token_data
  }, [rawData])

  // Fetch shifts for day counts
  const { data: slipShifts = [] } = useQuery<ShiftAssignment[]>({
    queryKey: ['shifts-for-slip-public', tokenData?.employee_id, tokenData?.period_id],
    queryFn: async () => {
      if (!tokenData?.employee_id || !tokenData?.period_id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('is_holiday_ot, is_half_shift, ot_hours, work_date')
        .eq('employee_id', tokenData.employee_id)
        .eq('period_id', tokenData.period_id)
      if (error) throw error
      return data as ShiftAssignment[]
    },
    enabled: !!tokenData?.employee_id && !!tokenData?.period_id
  })

  // Fetch position just to be safe if RPC didn't include it
  const { data: empPosition = 'worker' } = useQuery({
    queryKey: ['emp-pos', tokenData?.employee_id],
    queryFn: async () => {
      if (!tokenData?.employee_id) return 'worker'
      const { data } = await supabase.from('employees').select('position').eq('id', tokenData.employee_id).single()
      return data?.position || 'worker'
    },
    enabled: !!tokenData?.employee_id
  })

  const isClerkSlip = empPosition === 'clerk'
  const normalShiftsForSlip = slipShifts.filter((s: ShiftAssignment) => !s.is_holiday_ot)
  const days_normal = normalShiftsForSlip.length
  const days_shift = normalShiftsForSlip.filter((s: ShiftAssignment) => !s.is_half_shift).length
  const autoClerkOt1_5x = slipShifts.filter((s: ShiftAssignment) => !isWeekend(new Date(s.work_date))).reduce((sum: number, s: ShiftAssignment) => sum + Number(s.ot_hours || 0), 0)
  const autoClerkOt1x = slipShifts.filter((s: ShiftAssignment) => isWeekend(new Date(s.work_date))).reduce((sum: number, s: ShiftAssignment) => sum + Number(s.ot_hours || 0), 0)

  const days_ot = isClerkSlip
    ? autoClerkOt1_5x
    : slipShifts.filter((s: ShiftAssignment) => s.is_holiday_ot).reduce((sum, s) => {
        const base = s.is_half_shift ? 8 : 12
        return sum + base + Number(s.ot_hours || 0)
      }, 0)
  const days_ot_1x = isClerkSlip ? autoClerkOt1x : 0

  const slipData = useMemo(() => {
    if (!rawData) return null

    interface ParsedData {
      employee: any
      period: any
      entry: any
      factory?: { name: string }
    }

    let parsedData: ParsedData
    try {
      parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData
    } catch (err) {
      console.error('Failed to parse RPC data', err)
      return null
    }

    const e = parsedData.employee
    const p = parsedData.period
    const entry = parsedData.entry || {}

    if (!e || !p) return null

    const clerkMonthly = e?.rate_per_12h || 0
    const clerkHourly = (clerkMonthly / 30) / 8
    const computed_ot_1x = isClerkSlip ? clerkHourly * 1.0 * autoClerkOt1x : 0
    const amount_ot_1_5x = isClerkSlip ? Math.max(0, (entry.amount_ot || 0) - computed_ot_1x) : (entry.amount_ot || 0)

    const totalIncome = 
      (entry.amount_normal || 0) + (entry.amount_shift || 0) + amount_ot_1_5x + computed_ot_1x + 
      (entry.amount_wood_excess || 0) + (entry.amount_film || 0) + (entry.amount_special || 0) + 
      (entry.amount_diligence || 0) + (entry.amount_position || 0)

    const totalDeduct = 
      (entry.deduct_social_security || 0) + (entry.deduct_advance || 0) + 
      (entry.deduct_safety_equipment || 0) + (entry.deduct_uniform || 0)

    return {
      employee_code: e.employee_code,
      first_name: e.first_name,
      last_name: e.last_name,
      factory_name: parsedData.factory?.name || 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
      period_start: p.period_start,
      period_end: p.period_end,
      amount_normal: entry.amount_normal || 0,
      amount_shift: entry.amount_shift || 0,
      amount_ot: amount_ot_1_5x,
      amount_ot_1x: computed_ot_1x,
      amount_wood_excess: entry.amount_wood_excess || 0,
      amount_film: entry.amount_film || 0,
      amount_special: entry.amount_special || 0,
      special_note: entry.special_note || undefined,
      amount_diligence: entry.amount_diligence || 0,
      amount_position: entry.amount_position || 0,
      days_normal: slipShifts.length > 0 ? days_normal : undefined,
      days_shift: slipShifts.length > 0 ? days_shift : undefined,
      days_ot: slipShifts.length > 0 && days_ot > 0 ? days_ot : undefined,
      days_ot_1x: slipShifts.length > 0 && days_ot_1x > 0 ? days_ot_1x : undefined,
      position: empPosition,
      deduct_social_security: entry.deduct_social_security || 0,
      deduct_advance: entry.deduct_advance || 0,
      deduct_safety_equipment: entry.deduct_safety_equipment || 0,
      deduct_uniform: entry.deduct_uniform || 0,
      total_income: totalIncome,
      total_deductions: totalDeduct,
      net_pay: totalIncome - totalDeduct,
      payment_method: e.payment_method || 'bank_transfer',
      bank_name: e.bank_name,
      bank_account: e.bank_account_no || e.bank_account, 
    } as PaySlipData
  }, [rawData, slipShifts, days_normal, days_shift, days_ot, days_ot_1x, empPosition])

  // ── Slip rows (mirrors PaySlipV2 logic so formula strings are identical) ──
  const POSITIONS: Record<string, string> = { worker: 'พนักงานทั่วไป', clerk: 'เสมียน', foreman: 'โฟร์แมน', office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ' }
  const MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

  const slipRows = useMemo(() => {
    if (!slipData) return { income: [] as SlipIncomeRow[], deductions: [] as SlipDeductRow[], workingDays: 0, periodLabel: '', posLabel: '' }

    // Rates — derive from amounts same as PaySlipV2
    const parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData
    const rate = Number(parsedData?.employee?.rate_per_12h) || 0
    const baseNormal = rate === 0 ? 0 : 357
    // For clerks, rate_per_12h is in the RPC employee object. We approximate from amounts if needed.
    // We use days counts from slipData (populated from shift queries).
    const dn = slipData.days_normal ?? 0
    const ds = slipData.days_shift  ?? 0   // for clerk = weekend days, for worker = full-shift days
    const clerkDaily  = dn > 0 ? slipData.amount_normal / dn : 0
    const clerkHourly = clerkDaily / 8
    const baseShift   = ds > 0 ? slipData.amount_shift / ds : 0

    const amtNormal = slipData.amount_normal
    const amtShift  = isClerkSlip ? 0 : slipData.amount_shift
    const amtOt     = slipData.amount_ot       // 1.5x for clerk / 2x for worker
    const amtOt1x   = slipData.amount_ot_1x ?? 0

    // Day/hour counts for formula strings
    const dnDays = dn  // from shift data
    const dsDays = isClerkSlip ? ds : ds  // weekend days (clerk) / full-shift days (worker)
    const otHrs  = isClerkSlip && clerkHourly > 0 ? Math.round(amtOt   / (clerkHourly * 1.5)) : 0
    const ot1Hrs = isClerkSlip && clerkHourly > 0 ? Math.round(amtOt1x / clerkHourly)          : 0
    const empRate = isClerkSlip ? clerkDaily * 30 : (baseNormal + baseShift) * 1  // approx for worker
    const workerRate = ds > 0 ? baseNormal + baseShift : baseNormal  // base+shift combined
    const otDays = !isClerkSlip && workerRate > 0 ? Math.round(amtOt / (workerRate * 2)) : 0

    // Working days = normal workdays (not weekends for clerk)
    const workingDays = isClerkSlip ? (dnDays + dsDays) : dnDays

    // Formula detail strings
    const detailNormal = dnDays > 0
      ? (isClerkSlip ? `฿${Math.round(clerkDaily)} × ${dnDays} วัน` : `฿${baseNormal} × ${dnDays} วัน`)
      : null
    const detailShift = !isClerkSlip && dsDays > 0 && baseShift > 0
      ? `฿${Math.round(baseShift)} × ${dsDays} วัน`
      : null
    const detailOt = isClerkSlip && otHrs > 0
      ? `฿${clerkHourly.toFixed(2)} × 1.5 × ${otHrs} ชม.`
      : (!isClerkSlip && otDays > 0 ? `฿${workerRate} × 2 × ${otDays} วัน` : null)
    const detailOt1x = isClerkSlip && ot1Hrs > 0
      ? `฿${clerkHourly.toFixed(2)} × 1.0 × ${ot1Hrs} ชม.`
      : null

    const specialSubs = slipData.special_note
      ? slipData.special_note.split(',').map(s => s.trim()).filter(Boolean)
      : []

    const income: SlipIncomeRow[] = [
      { label: isClerkSlip ? 'ค่าจ้างปกติ (วันธรรมดา)' : 'ค่าจ้างปกติ (8 ชม.)', value: amtNormal, detail: detailNormal, subs: [] },
      { label: 'ค่ากะ (4 ชม.)',                                                     value: amtShift,  detail: detailShift,  subs: [] },
      { label: isClerkSlip ? 'OT ล่วงเวลา (×1.5)' : 'OT วันหยุดนักขัตฤกษ์ (×2)', value: amtOt,    detail: detailOt,     subs: [] },
      { label: 'OT วันหยุดสัปดาห์ (×1)',                                            value: isClerkSlip ? amtOt1x : 0, detail: detailOt1x, subs: [] },
      { label: 'ค่าไม้ส่วนเกิน',  value: slipData.amount_wood_excess, detail: null, subs: [] },
      { label: 'ค่าฟิล์ม',        value: slipData.amount_film,        detail: null, subs: [] },
      { label: 'เงินพิเศษ',       value: slipData.amount_special,     detail: null, subs: specialSubs },
      { label: 'เบี้ยขยัน',       value: slipData.amount_diligence,   detail: null, subs: [] },
      { label: 'ค่าตำแหน่ง',      value: slipData.amount_position,    detail: null, subs: [] },
    ].filter(r => r.value > 0 && r.label !== '') as SlipIncomeRow[]

    const deductions: SlipDeductRow[] = [
      { label: 'ประกันสังคม',            value: slipData.deduct_social_security },
      { label: 'เบิกล่วงหน้า',           value: slipData.deduct_advance },
      { label: 'ค่าอุปกรณ์ความปลอดภัย', value: slipData.deduct_safety_equipment },
      { label: 'ค่าเสื้อพนักงาน',        value: slipData.deduct_uniform },
    ].filter(r => r.value > 0)

    const s = new Date(slipData.period_start), e = new Date(slipData.period_end)
    const periodLabel = `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear() + 543}`

    return { income, deductions, workingDays, periodLabel, posLabel: POSITIONS[slipData.position ?? ''] ?? '' }
  }, [slipData, isClerkSlip])

  const maskBank = (a?: string | null) => {
    if (!a) return undefined
    const s = a.replace(/[-\s]/g, '')
    if (s.length <= 6) return s
    return `${s.slice(0, 3)}-${'X'.repeat(s.length - 6)}-${s.slice(-3)}`
  }

  const [autoStatus, setAutoStatus] = useState<string>('')

  useEffect(() => {
    if (tokenData?.employee_status) {
      let statusToSet = tokenData.employee_status as string
      if (statusToSet === 'pending') {
        const now = Date.now()
        const createdTime = tokenData.created_at 
          ? new Date(tokenData.created_at).getTime()
          : (tokenData.expires_at ? new Date(tokenData.expires_at).getTime() - (30 * 24 * 60 * 60 * 1000) : now)
        
        const hoursPassed = (now - createdTime) / (1000 * 60 * 60)
        if (hoursPassed >= 24) {
          statusToSet = 'auto_confirmed'
        }
      }
      const frame = requestAnimationFrame(() => {
        setAutoStatus(statusToSet)
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [tokenData])

  const currentStatus = manuallyUpdatedStatus || autoStatus

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_payslip_status', { p_token: token, p_status: 'confirmed' })
      if (error) throw error
    },
    onSuccess: () => setManuallyUpdatedStatus('confirmed')
  })

  const disputeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_payslip_status', { p_token: token, p_status: 'disputed', p_reason: disputeReason })
      if (error) throw error
    },
    onSuccess: () => setManuallyUpdatedStatus('disputed')
  })

  const handleConfirm = () => confirmMutation.mutate()
  const handleDispute = () => {
    if (!disputeReason.trim()) return
    disputeMutation.mutate()
  }


  if (isLoadingToken) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center py-8 px-4">
        <Loader2 className="w-8 h-8 text-[#1D9E75] animate-spin" />
        <p className="mt-4 text-slate-500 font-medium">กำลังโหลดข้อมูล...</p>
      </div>
    )
  }

  if (errorToken) {
    const errMsg = (errorToken as Error)?.message || 'Unknown error'
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center py-8 px-4">
        <AlertCircle className="w-12 h-12 text-rose-500" />
        <h3 className="mt-4 text-lg font-bold text-slate-700">เกิดข้อผิดพลาดในการดึงข้อมูล</h3>
        <p className="text-slate-500 mt-1 max-w-md text-center">{errMsg}</p>
      </div>
    )
  }

  if (!slipData) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center py-8 px-4">
        <AlertCircle className="w-12 h-12 text-slate-400" />
        <h3 className="mt-4 text-lg font-bold text-slate-700">ไม่พบข้อมูลสลิปเงินเดือน</h3>
        <p className="text-slate-500 mt-1">ลิงก์อาจหมดอายุ หรือคุณกรอก URL ไม่ถูกต้อง</p>
      </div>
    )
  }

  return (
    <>
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-8 px-4">
      
      {currentStatus === 'pending' && (
        <div className="w-full max-w-[600px] bg-blue-50 border border-blue-200 text-blue-800 px-6 py-4 rounded-xl flex items-start gap-4 mb-6 shadow-sm">
          <Clock className="w-6 h-6 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold">โปรดตรวจสอบและยืนยันภายใน 24 ชม.</h3>
            <p className="text-sm mt-1">กรุณาตรวจสอบความถูกต้องของสลิปเงินเดือนให้เรียบร้อย หากพ้นกำหนดเวลา ระบบจะถือว่าท่านตรวจสอบความถูกต้องแล้วโดยอัตโนมัติค่ะ</p>
          </div>
        </div>
      )}

      {(currentStatus === 'confirmed' || currentStatus === 'auto_confirmed') && (
        <div className="w-full max-w-[600px] bg-green-50 border border-green-200 text-green-800 px-6 py-4 rounded-xl flex items-start gap-4 mb-6 shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-8 h-8 text-green-500 flex-shrink-0" />
          <div className="flex flex-col">
            <h3 className="font-bold text-lg">
              {currentStatus === 'auto_confirmed' 
                ? 'ระบบยืนยันรับทราบข้อมูลให้อัตโนมัติ ขอบคุณค่ะ' 
                : 'ยืนยันรับทราบข้อมูลเรียบร้อย ขอบคุณค่ะ'}
            </h3>
            <p className="text-sm mt-1 text-green-700">
              {currentStatus === 'auto_confirmed' 
                ? '* เนื่องจากท่านไม่ได้ตรวจสอบและยืนยันภายใน 24 ชั่วโมง ระบบจึงถือว่าข้อมูลถูกต้องและทำการยืนยันให้อัตโนมัติ หากมีข้อสงสัย กรุณาติดต่อบริษัทผ่านช่องทางแชทนะคะ'
                : '* ปุ่มยืนยันถูกปิดการใช้งานแล้ว หากต้องการทักท้วงหรือแก้ไขข้อมูล กรุณาติดต่อกลับหาบริษัทตามช่องทางแชทที่ได้รับข้อความแจ้งไปนะคะ'}
            </p>
          </div>
        </div>
      )}

      {currentStatus === 'disputed' && (
        <div className="w-full max-w-[600px] bg-rose-50 border border-rose-200 text-rose-800 px-6 py-4 rounded-xl flex items-start gap-4 mb-6 shadow-sm animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-6 h-6 text-rose-500 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-bold text-lg">ส่งเรื่องแจ้งปัญหาเรียบร้อย</h3>
            <p className="text-sm mt-1">แอดมินได้รับข้อมูลแล้ว จะทำการตรวจสอบและติดต่อกลับโดยเร็วที่สุดค่ะ<br/>
              * หากมีข้อมูลเพิ่มเติม กรุณาติดต่อบริษัทผ่านช่องทางแชทนะคะ
            </p>
          </div>
        </div>
      )}

      <div className="w-full max-w-[680px]">
        {slipData && (
          <VKSlipDocument
            branchName={slipData.factory_name}
            employeeName={`${slipData.first_name} ${slipData.last_name}`}
            employeeCode={slipData.employee_code}
            positionLabel={slipRows.posLabel || undefined}
            periodLabel={slipRows.periodLabel}
            paymentMethod={slipData.payment_method}
            bankName={slipData.bank_name}
            bankAccount={maskBank(slipData.bank_account)}
            income={slipRows.income}
            deductions={slipRows.deductions}
            totalIncome={slipData.total_income}
            totalDeduct={slipData.total_deductions}
            netPay={slipData.net_pay}
            workingDays={slipRows.workingDays > 0 ? slipRows.workingDays : undefined}
          />
        )}
      </div>

      {currentStatus === 'pending' && (
        <div className="w-full max-w-[600px] mt-6 space-y-6">
          <Button 
            className="w-full h-14 text-lg bg-[#1D9E75] hover:bg-[#157a5a]"
            onClick={handleConfirm}
            disabled={confirmMutation.isPending}
          >
            {confirmMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
            ข้อมูลถูกต้อง (ยืนยัน)
          </Button>

          <Card className="border-rose-100 shadow-sm">
            <CardHeader className="pb-3 bg-rose-50/50">
              <CardTitle className="text-rose-700 flex items-center text-lg">
                <AlertCircle className="w-5 h-5 mr-2" />
                แจ้งปัญหา (ตัวเลขไม่ถูกต้อง)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label>อธิบายจุดที่ไม่ถูกต้อง *</Label>
                <textarea 
                  placeholder="เช่น ขาดโอทีวันที่..." 
                  value={disputeReason}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDisputeReason(e.target.value)}
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={handleDispute}
                disabled={!disputeReason.trim() || disputeMutation.isPending}
              >
                {disputeMutation.isPending ? 'กำลังส่งข้อมูล...' : 'ส่งเรื่องให้แอดมินตรวจสอบ'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
    
    {/* Privacy Warning Modal — VK theme */}
    {!hasAcceptedWarning && (
      <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(22,19,17,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 400, overflow: 'hidden' }}>

          {/* Header bar */}
          <div style={{ background: 'var(--vk-ink)', padding: '22px 28px 20px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, background: 'rgba(255,255,255,0.08)', marginBottom: 14 }}>
              <ShieldAlert style={{ width: 26, height: 26, color: 'var(--vk-marigold, #f59e0b)' }} />
            </div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, color: 'var(--vk-bone)', letterSpacing: '-0.01em' }}>
              แจ้งเตือนความเป็นส่วนตัว
            </div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6, lineHeight: 1.5 }}>
              ระบบกำลังจะแสดงผลข้อมูลสลิปเงินเดือน<br />และข้อมูลส่วนบุคคลของท่าน
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 28px', background: 'var(--vk-bone)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '14px 16px' }}>
              <Eye style={{ width: 16, height: 16, color: 'var(--vk-ink-3)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-2)', lineHeight: 1.65, margin: 0 }}>
                ข้อมูลนี้เป็นข้อมูลส่วนตัวและมีความสำคัญ โปรดระมัดระวังการเปิดอ่านในที่สาธารณะ หรือในที่ที่มีผู้อื่นอาจมองเห็นหน้าจอของท่านได้
              </p>
            </div>
          </div>

          {/* Action */}
          <div style={{ padding: '0 28px 24px', background: 'var(--vk-bone)' }}>
            <button
              onClick={() => setHasAcceptedWarning(true)}
              style={{ width: '100%', height: 48, background: 'var(--vk-jade)', border: 'none', cursor: 'pointer', fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: '0.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              ยืนยันเพื่อดูข้อมูล
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
