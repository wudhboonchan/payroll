import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

import { PaySlipPreview } from '../components/payroll/PaySlipPreview'
import type { PaySlipData } from '../components/payroll/PaySlipPreview'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'

import { CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react'

export default function EmployeeSlip() {
  const { token } = useParams<{ token: string }>()
  const [localStatus, setLocalStatus] = useState<string>('')
  const [disputeReason, setDisputeReason] = useState('')

  const { data: rawData, isLoading: isLoadingToken, error: errorToken } = useQuery<any>({
    queryKey: ['slip_token_data', token],
    queryFn: async () => {
      if (!token) throw new Error('No token provided')
      // @ts-ignore
      const { data, error } = await supabase.rpc('get_payslip_data', { p_token: token })
      
      if (error) {
        console.error('RPC Error:', error)
        throw new Error('ไม่สามารถดึงข้อมูลได้ (โปรดตรวจสอบการตั้งค่าฐานข้อมูล)')
      }
      if (!data) throw new Error('ไม่พบข้อมูลสลิป (Token ไม่ถูกต้อง หรือหมดอายุ)')
      
      return data
    },
    enabled: !!token,
    retry: false
  })

  // Extract the structured data
  const tokenData = typeof rawData === 'string' ? JSON.parse(rawData)?.token_data : rawData?.token_data

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
  }, [rawData])

  // Sync local status when data loads
  useEffect(() => {
    if (tokenData?.employee_status) {
      setLocalStatus(tokenData.employee_status as any)
    }
  }, [tokenData?.employee_status])

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // @ts-ignore
      const { error } = await supabase.rpc('update_payslip_status', { p_token: token, p_status: 'confirmed' })
      if (error) throw error
    },
    onSuccess: () => setLocalStatus('confirmed')
  })

  const disputeMutation = useMutation({
    mutationFn: async () => {
      // @ts-ignore
      const { error } = await supabase.rpc('update_payslip_status', { p_token: token, p_status: 'disputed', p_reason: disputeReason })
      if (error) throw error
    },
    onSuccess: () => setLocalStatus('disputed')
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
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-8 px-4">
      
      {localStatus === 'pending' && (
        <div className="w-full max-w-[600px] bg-blue-50 border border-blue-200 text-blue-800 px-6 py-4 rounded-xl flex items-start gap-4 mb-6 shadow-sm">
          <Clock className="w-6 h-6 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold">โปรดตรวจสอบและยืนยัน</h3>
            <p className="text-sm mt-1">กรุณาตรวจสอบความถูกต้องของสลิปเงินเดือน หากมีข้อสงสัยสามารถแจ้งปัญหาผ่านระบบด้านล่าง</p>
          </div>
        </div>
      )}

      {localStatus === 'confirmed' && (
        <div className="w-full max-w-[600px] bg-green-50 border border-green-200 text-green-800 px-6 py-4 rounded-xl flex items-start gap-4 mb-6 shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-8 h-8 text-green-500 flex-shrink-0" />
          <div className="flex flex-col">
            <h3 className="font-bold text-lg">ยืนยันรับทราบข้อมูลเรียบร้อย ขอบคุณค่ะ</h3>
            <p className="text-sm mt-1 text-green-700">
              * ปุ่มยืนยันถูกปิดการใช้งานแล้ว หากต้องการทักท้วงหรือแก้ไขข้อมูล กรุณาติดต่อกลับหาบริษัทตามช่องทางแชทที่ได้รับข้อความแจ้งไปนะคะ
            </p>
          </div>
        </div>
      )}

      {localStatus === 'disputed' && (
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

      <div className="w-full max-w-[600px] shadow-lg rounded-xl overflow-hidden bg-white">
        <PaySlipPreview data={slipData} />
      </div>

      {localStatus === 'pending' && (
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
                  onChange={(e: any) => setDisputeReason(e.target.value)}
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
  )
}
