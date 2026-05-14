import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

import { PaySlipPreview } from '../components/payroll/PaySlipPreview'
import type { PaySlipData } from '../components/payroll/PaySlipPreview'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'

import { CheckCircle2, AlertCircle, Clock, Loader2, ShieldAlert, Eye, Lock } from 'lucide-react'

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
        .select('is_holiday_ot, is_half_shift, ot_hours')
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
  const days_ot = isClerkSlip
    ? slipShifts.reduce((sum: number, s: ShiftAssignment) => sum + Number(s.ot_hours || 0), 0)
    : slipShifts.filter((s: ShiftAssignment) => s.is_holiday_ot).length

  const slipData = useMemo(() => {
    if (!rawData) return null
    
    let parsedData = rawData
    try {
      if (typeof rawData === 'string') parsedData = JSON.parse(rawData)
    } catch (err) {
      console.error('Failed to parse RPC data', err)
      return null
    }

    const e = parsedData.employee
    const p = parsedData.period
    const entry = parsedData.entry || {}

    if (!e || !p) return null

    const totalIncome = 
      (entry.amount_normal || 0) + (entry.amount_shift || 0) + (entry.amount_ot || 0) + 
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
      amount_ot: entry.amount_ot || 0,
      amount_wood_excess: entry.amount_wood_excess || 0,
      amount_film: entry.amount_film || 0,
      amount_special: entry.amount_special || 0,
      amount_diligence: entry.amount_diligence || 0,
      amount_position: entry.amount_position || 0,
      days_normal: slipShifts.length > 0 ? days_normal : undefined,
      days_shift: slipShifts.length > 0 ? days_shift : undefined,
      days_ot: slipShifts.length > 0 && days_ot > 0 ? days_ot : undefined,
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
  }, [rawData, slipShifts, days_normal, days_shift, days_ot, empPosition])

  const currentStatus = useMemo(() => {
    if (manuallyUpdatedStatus) return manuallyUpdatedStatus
    
    if (tokenData?.employee_status) {
      let statusToSet = tokenData.employee_status as string
      if (statusToSet === 'pending') {
        const createdTime = tokenData.created_at 
          ? new Date(tokenData.created_at).getTime()
          : (tokenData.expires_at ? new Date(tokenData.expires_at).getTime() - (30 * 24 * 60 * 60 * 1000) : Date.now())
        
        const hoursPassed = (Date.now() - createdTime) / (1000 * 60 * 60)
        if (hoursPassed >= 24) {
          statusToSet = 'auto_confirmed'
        }
      }
      return statusToSet
    }
    return ''
  }, [tokenData, manuallyUpdatedStatus])

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

      <div className="w-full max-w-[600px] shadow-lg rounded-xl overflow-x-auto bg-white">
        <PaySlipPreview data={slipData} />
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
    
    {/* Privacy Warning Modal */}
    {!hasAcceptedWarning && (
      <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 text-center space-y-6 overflow-hidden relative animate-in fade-in zoom-in-95 duration-500">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-[#1D9E75] to-blue-500" />
          
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center relative">
              <ShieldAlert className="w-10 h-10 text-amber-500" />
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm">
                <Lock className="w-5 h-5 text-slate-400" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900">แจ้งเตือนความเป็นส่วนตัว</h2>
            <p className="text-slate-500">
              ระบบกำลังจะแสดงผลข้อมูลสลิปเงินเดือนและข้อมูลส่วนบุคคลของท่าน
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl text-left border border-slate-100">
            <div className="flex items-start gap-3">
              <Eye className="w-5 h-5 text-slate-400 mt-0.5" />
              <p className="text-xs text-slate-600 leading-relaxed">
                ข้อมูลนี้เป็นข้อมูลส่วนตัวและมีความสำคัญ โปรดระมัดระวังการเปิดอ่านในที่สาธารณะ หรือในที่ที่มีผู้อื่นอาจมองเห็นหน้าจอของท่านได้
              </p>
            </div>
          </div>

          <Button 
            onClick={() => setHasAcceptedWarning(true)}
            className="w-full h-14 text-lg bg-[#1D9E75] hover:bg-[#157a5a] rounded-2xl shadow-lg shadow-[#1D9E75]/20 font-bold"
          >
            ยืนยันเพื่อดูข้อมูล
          </Button>
        </div>
      </div>
    )}
  </>
  )
}
