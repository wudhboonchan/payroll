import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { toast } from 'sonner'
import { UserPlus, X, AlertTriangle } from 'lucide-react'
import { NATIONALITIES } from '@/lib/constants'
import '../../styles/v2-tokens.css'

const employeeSchema = z
  .object({
    employee_code: z.string().min(1, 'กรุณาระบุรหัสพนักงาน'),
    prefix: z.string().optional(),
    first_name: z.string().min(1, 'กรุณาระบุชื่อ'),
    last_name: z.string().optional(),
    national_id: z.string().optional(),
    nationality: z.string().default('ไทย'),
    position: z.enum(['worker', 'clerk']).default('worker'),
    job_title: z.string().optional(),
    wage_type: z.enum(['daily', 'monthly']).default('daily'),
    payment_method: z.enum(['cash', 'bank_transfer']),
    bank_name: z.string().optional(),
    bank_account: z.string().optional(),
    rate_per_12h: z.coerce.number().min(0, 'ค่าแรงต้องไม่น้อยกว่า 0'),
    status: z.enum(['active', 'inactive']).default('active'),
    notes: z.string().optional(),
    data_complete: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.nationality === 'ไทย' && !data.last_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'กรุณาระบุนามสกุล (บังคับสำหรับพนักงานสัญชาติไทย)',
        path: ['last_name'],
      })
    }
    if (data.payment_method === 'bank_transfer') {
      if (!data.bank_name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'กรุณาระบุธนาคาร', path: ['bank_name'] })
      }
      if (!data.bank_account) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'กรุณาระบุเลขบัญชี', path: ['bank_account'] })
      }
    }
  })

type EmployeeFormValues = z.infer<typeof employeeSchema>

interface Props {
  isOpen: boolean
  onClose: () => void
  employeeId: string | null
  onSuccess?: () => void
}

interface Employee {
  id: string; employee_code: string; prefix: string | null; first_name: string
  last_name: string | null; national_id: string | null; nationality: string | null
  position: 'worker' | 'clerk'; job_title: string | null; wage_type: 'daily' | 'monthly'
  payment_method: 'cash' | 'bank_transfer'; bank_name: string | null; bank_account: string | null
  rate_per_12h: number; status: 'active' | 'inactive'; notes: string | null; data_complete: boolean
}

const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
}

const errorStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--vk-crimson)', marginTop: 2,
}

export default function EmployeeFormModalV2({ isOpen, onClose, employeeId, onSuccess }: Props) {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [inactiveConfirm, setInactiveConfirm] = useState<{ shiftCount: number; pendingValues: EmployeeFormValues } | null>(null)

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema) as any,
    defaultValues: { payment_method: 'bank_transfer', status: 'active', nationality: 'ไทย', data_complete: false },
  })

  const paymentMethod = watch('payment_method')
  const nationality = watch('nationality')
  const dataComplete = watch('data_complete')
  const wageType = watch('wage_type')
  const position = watch('position')
  const currentRate = watch('rate_per_12h') || 0
  const isThai = !nationality || nationality === 'ไทย'

  const { data: employeeData } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: async () => {
      if (!employeeId) return null
      const { data, error } = await supabase.from('employees').select('*').eq('id', employeeId).single()
      if (error) throw error
      return data as Employee
    },
    enabled: !!employeeId && isOpen,
  })

  // Pre-fetch shift count so handleSave can check synchronously (no async freeze)
  const { data: employeeShiftCount = 0 } = useQuery({
    queryKey: ['employee-shift-count', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_assignments' as any)
        .select('id')
        .eq('employee_id', employeeId!)
      if (error) return 0
      return (data as any[])?.length ?? 0
    },
    enabled: !!employeeId && isOpen,
    staleTime: 0,
  })

  useEffect(() => {
    if (position === 'clerk') setValue('wage_type', 'monthly')
    else if (position === 'worker') setValue('wage_type', 'daily')
  }, [position, setValue])

  useEffect(() => {
    if (employeeData && isOpen) {
      reset({
        employee_code: employeeData.employee_code, prefix: employeeData.prefix || '',
        first_name: employeeData.first_name, last_name: employeeData.last_name || '',
        national_id: employeeData.national_id || '', nationality: employeeData.nationality || 'ไทย',
        position: employeeData.position || 'worker', job_title: employeeData.job_title || '',
        wage_type: employeeData.wage_type || 'daily', payment_method: employeeData.payment_method || 'bank_transfer',
        bank_name: employeeData.bank_name || '', bank_account: employeeData.bank_account || '',
        rate_per_12h: employeeData.rate_per_12h, status: employeeData.status || 'active',
        notes: employeeData.notes || '', data_complete: employeeData.data_complete ?? false,
      })
    } else if (!employeeId && isOpen) {
      reset({
        employee_code: '', prefix: '', first_name: '', last_name: '', national_id: '',
        nationality: 'ไทย', position: 'worker', job_title: '', wage_type: 'daily',
        payment_method: 'bank_transfer', bank_name: '', bank_account: '',
        rate_per_12h: 0, status: 'active', notes: '', data_complete: false,
      })
    }
  }, [employeeData, employeeId, isOpen, reset])

  const mutation = useMutation({
    mutationFn: async ({ values, deleteShifts }: { values: EmployeeFormValues; deleteShifts: boolean }) => {
      if (!user?.factory_id) throw new Error('No factory context')
      // Delete all shift assignments for this employee if requested
      if (deleteShifts && employeeId) {
        const { error: shiftErr } = await supabase.from('shift_assignments').delete().eq('employee_id', employeeId)
        if (shiftErr) throw shiftErr
      }
      const payload = {
        ...values,
        last_name: values.last_name?.trim() || '',
        factory_id: user.factory_id,
        bank_name: values.payment_method === 'cash' ? null : values.bank_name,
        bank_account: values.payment_method === 'cash' ? null : values.bank_account,
      }
      if (employeeId) {
        const { error } = await supabase.from('employees').update(payload).eq('id', employeeId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('employees').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: (_, { deleteShifts }) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.removeQueries({ queryKey: ['employee', employeeId] })
      queryClient.removeQueries({ queryKey: ['employee-shift-count', employeeId] })
      if (deleteShifts) {
        queryClient.invalidateQueries({ queryKey: ['all-period-shifts'] })
        queryClient.invalidateQueries({ queryKey: ['shift-assignments'] })
        toast.success('บันทึกสำเร็จ — ลบกะของพนักงานทั้งหมดแล้ว')
      } else {
        toast.success(employeeId ? 'อัปเดตข้อมูลสำเร็จ' : 'เพิ่มพนักงานสำเร็จ')
      }
      onSuccess?.()
      onClose()
    },
    onError: (err: unknown) => {
      const error = err as Error
      toast.error('เกิดข้อผิดพลาด', {
        description: error.message?.includes('unique') ? 'รหัสพนักงานนี้มีในระบบแล้ว' : error.message,
      })
    },
  })

  // Called by form submit — intercepts inactive + existing shifts case (synchronous, uses pre-fetched count)
  const handleSave = (values: EmployeeFormValues) => {
    if (values.status === 'inactive' && employeeId && employeeShiftCount > 0) {
      setInactiveConfirm({ shiftCount: employeeShiftCount, pendingValues: values })
      return
    }
    mutation.mutate({ values, deleteShifts: false })
  }

  if (!isOpen) return null

  return (
    <>
    <div className="vk-root" style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(22,19,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)',
        width: '100%', maxWidth: 760, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'var(--vk-persimmon)', color: 'var(--vk-bone)',
          padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserPlus style={{ width: 20, height: 20 }} />
            <div>
              <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>
                {employeeId ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 1 }}>
                {employeeId ? 'แก้ไขและบันทึกการเปลี่ยนแปลง' : 'กรอกข้อมูลพนักงานใหม่ให้ครบถ้วน'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 4, padding: 6, cursor: 'pointer', color: 'var(--vk-bone)', display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit(handleSave)} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>

            {/* Row 1: รหัส + สัญชาติ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">รหัสพนักงาน *</label>
                <input className="vk-input" {...register('employee_code')} placeholder="เช่น 001" />
                {errors.employee_code && <span style={errorStyle}>{errors.employee_code.message}</span>}
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">สัญชาติ *</label>
                <select className="vk-input" {...register('nationality')}>
                  {NATIONALITIES.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </div>
            </div>

            {/* Row 2: เลขบัตร + คำนำหน้า */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">เลขบัตรประชาชน / Passport</label>
                <input className="vk-input" {...register('national_id')} />
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">คำนำหน้า</label>
                <select className="vk-input" {...register('prefix')}>
                  <option value="">เลือก</option>
                  <option value="นาย">นาย</option>
                  <option value="นาง">นาง</option>
                  <option value="นางสาว">นางสาว</option>
                </select>
              </div>
            </div>

            {/* Row 3: ชื่อ + นามสกุล */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">ชื่อ *</label>
                <input className="vk-input" {...register('first_name')} />
                {errors.first_name && <span style={errorStyle}>{errors.first_name.message}</span>}
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">นามสกุล{isThai ? ' *' : ' (ไม่บังคับ)'}</label>
                <input className="vk-input" {...register('last_name')} />
                {errors.last_name && <span style={errorStyle}>{errors.last_name.message}</span>}
                {!isThai && <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>พนักงานต่างชาติไม่บังคับกรอกนามสกุล</span>}
              </div>
            </div>

            {/* Row 4: กลุ่มงาน + ตำแหน่งงาน */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">กลุ่มงาน *</label>
                <select className="vk-input" {...register('position')}>
                  <option value="worker">พนักงาน (ทั่วไป)</option>
                  <option value="clerk">เสมียน</option>
                </select>
                {position === 'clerk' && (
                  <span style={{ fontSize: 11, color: '#6F4A0E', background: 'var(--vk-marigold-tint)', padding: '3px 8px', borderRadius: 4 }}>
                    เสมียน: คิดค่าแรงแบบรายเดือน / OT ชั่วโมงละ 1.5 เท่า
                  </span>
                )}
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">ตำแหน่งงาน</label>
                <input className="vk-input" {...register('job_title')} placeholder="เช่น หัวหน้าช่าง, พนักงานขับรถ" />
              </div>
            </div>

            {/* Row 5: ประเภทค่าจ้าง + อัตราค่าจ้าง */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">ประเภทค่าจ้าง *</label>
                <div style={{ display: 'flex', gap: 20, paddingTop: 6 }}>
                  {(['daily', 'monthly'] as const).map(v => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 1, cursor: 'not-allowed' }}>
                      <input type="radio" value={v} {...register('wage_type')} disabled style={{ accentColor: 'var(--vk-persimmon)' }} />
                      {v === 'daily' ? 'รายวัน' : 'รายเดือน'}
                    </label>
                  ))}
                </div>
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">
                  {wageType === 'monthly' ? 'เงินเดือน (บาท/เดือน) *' : 'อัตราค่าจ้างรายวัน (บาท) *'}
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--vk-ink-3)' }}>฿</span>
                  <input className="vk-input" type="number" step="0.01" {...register('rate_per_12h')}
                    style={{ paddingLeft: 24 }} placeholder={wageType === 'monthly' ? 'เช่น 15000' : 'เช่น 350'} />
                </div>
                {wageType === 'daily' && position === 'worker' && currentRate > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 11, background: 'rgba(177,71,41,0.08)', color: 'var(--vk-persimmon)', padding: '2px 8px', borderRadius: 999 }}>ค่าจ้างปกติ: 357 ฿</span>
                    <span style={{ fontSize: 11, background: 'rgba(0,90,180,0.07)', color: '#005ab4', padding: '2px 8px', borderRadius: 999 }}>ค่ากะ: {Math.max(0, currentRate - 357)} ฿</span>
                  </div>
                )}
                {errors.rate_per_12h && <span style={errorStyle}>{errors.rate_per_12h.message}</span>}
              </div>
            </div>

            {/* Payment method */}
            <div style={{ border: '1px solid var(--vk-rule)', padding: '16px', background: 'var(--vk-bone)' }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow" style={{ marginBottom: 8 }}>วิธีการรับเงิน</label>
                <div style={{ display: 'flex', gap: 24 }}>
                  {([['bank_transfer', 'โอนผ่านบัญชี'], ['cash', 'เงินสด']] as const).map(([v, label]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" value={v} {...register('payment_method')} style={{ accentColor: 'var(--vk-persimmon)' }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              {paymentMethod === 'bank_transfer' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                  <div style={fieldStyle}>
                    <label className="vk-eyebrow">ธนาคาร *</label>
                    <select className="vk-input" {...register('bank_name')}>
                      <option value="">เลือกธนาคาร...</option>
                      <option value="กสิกรไทย">กสิกรไทย (KBANK)</option>
                      <option value="ไทยพาณิชย์">ไทยพาณิชย์ (SCB)</option>
                      <option value="กรุงเทพ">กรุงเทพ (BBL)</option>
                      <option value="กรุงไทย">กรุงไทย (KTB)</option>
                      <option value="กรุงศรี">กรุงศรี (BAY)</option>
                      <option value="ทหารไทยธนชาต">ทหารไทยธนชาต (TTB)</option>
                      <option value="ออมสิน">ออมสิน (GSB)</option>
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                    {errors.bank_name && <span style={errorStyle}>{errors.bank_name.message}</span>}
                  </div>
                  <div style={fieldStyle}>
                    <label className="vk-eyebrow">เลขที่บัญชี *</label>
                    <input className="vk-input vk-input--mono" {...register('bank_account')} placeholder="XXXXXXXXXX" />
                    {errors.bank_account && <span style={errorStyle}>{errors.bank_account.message}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* สถานะ + หมายเหตุ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">สถานะ</label>
                <select className="vk-input" {...register('status')}>
                  <option value="active">พนักงานปัจจุบัน</option>
                  <option value="inactive">พ้นสภาพพนักงาน</option>
                </select>
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">หมายเหตุ</label>
                <input className="vk-input" {...register('notes')} />
              </div>
            </div>

            {/* Data complete checkbox */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
              border: `1px solid ${dataComplete ? 'var(--vk-jade)' : 'var(--vk-marigold)'}`,
              background: dataComplete ? 'var(--vk-jade-tint)' : 'var(--vk-marigold-tint)',
            }}>
              <button type="button"
                onClick={() => setValue('data_complete', !dataComplete, { shouldDirty: true })}
                style={{
                  marginTop: 2, width: 18, height: 18, border: `1.5px solid ${dataComplete ? 'var(--vk-jade)' : 'var(--vk-marigold)'}`,
                  background: dataComplete ? 'var(--vk-jade)' : 'white', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                {dataComplete && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: dataComplete ? 'var(--vk-jade)' : '#6F4A0E' }}>
                  {dataComplete ? 'ข้อมูลสมบูรณ์' : 'ข้อมูลยังไม่สมบูรณ์ (Pending)'}
                </div>
                <div style={{ fontSize: 11, marginTop: 2, color: dataComplete ? '#1a5c3a' : '#7a4a10' }}>
                  {dataComplete
                    ? 'ข้อมูลพนักงานได้รับการตรวจสอบและยืนยันความถูกต้องแล้ว'
                    : 'ยังรอข้อมูลเพิ่มเติม เช่น เลขบัญชี หรือเลขบัตรประชาชน — ติ๊กเมื่อข้อมูลครบ'}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 10,
            padding: '14px 24px', borderTop: '1px solid var(--vk-rule)',
            background: 'var(--vk-bone)', flexShrink: 0, position: 'sticky', bottom: 0,
          }}>
            <button type="button" className="vk-btn" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="vk-btn vk-btn--primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
            </button>
          </div>
        </form>
      </div>
    </div>

      {/* ── Inactive + existing shifts confirmation modal ── */}
      {inactiveConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(22,19,17,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 420, overflow: 'hidden' }}>
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div style={{ fontWeight: 700, fontSize: 15 }}>พนักงานมีกะที่บันทึกอยู่</div>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.7 }}>
                พนักงานคนนี้มีกะที่ถูกบันทึกไว้ <strong>{inactiveConfirm.shiftCount} รายการ</strong>
                {' '}หากเปลี่ยนสถานะเป็น <strong>พ้นสภาพ</strong> ระบบจะลบกะทั้งหมดของพนักงานคนนี้ออกจากทุกงวด
              </p>
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--vk-persimmon-tint)', border: '1px solid var(--vk-persimmon)', fontSize: 12, color: 'var(--vk-persimmon-ink)', lineHeight: 1.6 }}>
                ⚠️ การลบกะไม่สามารถเรียกคืนได้ และจะส่งผลต่อการคำนวณค่าจ้างทุกงวดที่มีกะของพนักงานคนนี้
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 20px 20px', justifyContent: 'flex-end' }}>
              <button className="vk-btn" onClick={() => setInactiveConfirm(null)}>ยกเลิก</button>
              <button className="vk-btn vk-btn--primary" disabled={mutation.isPending}
                onClick={() => { mutation.mutate({ values: inactiveConfirm.pendingValues, deleteShifts: true }); setInactiveConfirm(null) }}>
                {mutation.isPending ? 'กำลังดำเนินการ...' : 'ยืนยัน — ลบกะและพ้นสภาพ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
