// Employee management modal component
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { UserPlus } from 'lucide-react'


import { NATIONALITIES } from '@/lib/constants'

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
    // Last name required for Thai employees
    if (data.nationality === 'ไทย' && !data.last_name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'กรุณาระบุนามสกุล (บังคับสำหรับพนักงานสัญชาติไทย)',
        path: ['last_name'],
      })
    }
    // Bank fields required if bank transfer
    if (data.payment_method === 'bank_transfer') {
      if (!data.bank_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'กรุณาระบุธนาคาร',
          path: ['bank_name'],
        })
      }
      if (!data.bank_account) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'กรุณาระบุเลขบัญชี',
          path: ['bank_account'],
        })
      }
    }
  })

type EmployeeFormValues = z.infer<typeof employeeSchema>

interface Props {
  isOpen: boolean
  onClose: () => void
  employeeId: string | null
}

interface Employee {
  id: string
  employee_code: string
  prefix: string | null
  first_name: string
  last_name: string | null
  national_id: string | null
  nationality: string | null
  position: 'worker' | 'clerk'
  job_title: string | null
  wage_type: 'daily' | 'monthly'
  payment_method: 'cash' | 'bank_transfer'
  bank_name: string | null
  bank_account: string | null
  rate_per_12h: number
  status: 'active' | 'inactive'
  notes: string | null
  data_complete: boolean
}

const SELECT_CLASS =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export default function EmployeeFormModal({ isOpen, onClose, employeeId }: Props) {
  const { user } = useAppStore()
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema) as any,
    defaultValues: {
      payment_method: 'bank_transfer',
      status: 'active',
      nationality: 'ไทย',
      data_complete: false,
    },
  })

  const paymentMethod = watch('payment_method')
  const nationality = watch('nationality')
  const dataComplete = watch('data_complete')
  const wageType = watch('wage_type')
  const position = watch('position')
  const currentRate = watch('rate_per_12h') || 0
  const isThai = !nationality || nationality === 'ไทย'

  // Fetch single employee if editing
  const { data: employeeData } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: async () => {
      if (!employeeId) return null
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single()
      if (error) throw error
      return data as Employee
    },
    enabled: !!employeeId && isOpen,
  })

  // Auto-set wage type based on position
  useEffect(() => {
    if (position === 'clerk') {
      setValue('wage_type', 'monthly')
    } else if (position === 'worker') {
      setValue('wage_type', 'daily')
    }
  }, [position, setValue])

  // Populate form on edit
  useEffect(() => {
    if (employeeData && isOpen) {
      reset({
        employee_code: employeeData.employee_code,
        prefix: employeeData.prefix || '',
        first_name: employeeData.first_name,
        last_name: employeeData.last_name || '',
        national_id: employeeData.national_id || '',
        nationality: employeeData.nationality || 'ไทย',
        position: employeeData.position || 'worker',
        job_title: employeeData.job_title || '',
        wage_type: employeeData.wage_type || 'daily',
        payment_method: employeeData.payment_method || 'bank_transfer',
        bank_name: employeeData.bank_name || '',
        bank_account: employeeData.bank_account || '',
        rate_per_12h: employeeData.rate_per_12h,
        status: employeeData.status || 'active',
        notes: employeeData.notes || '',
        data_complete: employeeData.data_complete ?? false,
      })
    } else if (!employeeId && isOpen) {
      reset({
        employee_code: '',
        prefix: '',
        first_name: '',
        last_name: '',
        national_id: '',
        nationality: 'ไทย',
        position: 'worker',
        job_title: '',
        wage_type: 'daily',
        payment_method: 'bank_transfer',
        bank_name: '',
        bank_account: '',
        rate_per_12h: 0,
        status: 'active',
        notes: '',
        data_complete: false,
      })
    }
  }, [employeeData, employeeId, isOpen, reset])

  const mutation = useMutation({
    mutationFn: async (values: EmployeeFormValues) => {
      if (!user?.factory_id) throw new Error('No factory context')

      const payload = {
        ...values,
        // DB has NOT NULL on last_name — send '' for foreign employees who skip it
        last_name: values.last_name?.trim() || '',
        factory_id: user.factory_id,
        bank_name: values.payment_method === 'cash' ? null : values.bank_name,
        bank_account: values.payment_method === 'cash' ? null : values.bank_account,
      }

      if (employeeId) {
        const { error } = await supabase
          .from('employees')
          .update(payload)
          .eq('id', employeeId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('employees')
          .insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(employeeId ? 'อัปเดตข้อมูลสำเร็จ' : 'เพิ่มพนักงานสำเร็จ')
      onClose()
    },
    onError: (err: unknown) => {
      const error = err as Error
      toast.error('เกิดข้อผิดพลาด', {
        description: error.message?.includes('unique')
          ? 'รหัสพนักงานนี้มีในระบบแล้ว'
          : error.message,
      })
    },
  })

  const onSubmit = (data: EmployeeFormValues) => {
    mutation.mutate(data)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md md:max-w-4xl p-0 overflow-hidden border-none shadow-2xl max-h-[90vh] flex flex-col">
        {/* ── Green Header ── */}
        <div className="bg-[#1D9E75] p-5 md:p-6 text-white flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-xl md:text-2xl font-bold flex items-center gap-2 md:gap-3">
              <UserPlus className="w-6 h-6 md:w-7 md:h-7" />
              {employeeId ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
            </DialogTitle>
            <p className="text-emerald-100 mt-1 text-xs md:text-sm">
              {employeeId
                ? 'แก้ไขข้อมูลพนักงานและบันทึกการเปลี่ยนแปลง'
                : 'กรอกข้อมูลพนักงานใหม่ให้ครบถ้วน'}
            </p>
          </DialogHeader>
        </div>

        {/* ── Form Body ── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto"
        >
          <div className="p-5 md:p-8 bg-white space-y-6">

            {/* Row 1: รหัสพนักงาน + สัญชาติ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">รหัสพนักงาน *</Label>
                <Input
                  {...register('employee_code')}
                  placeholder="เช่น 001"
                  className="w-full h-11"
                />
                {errors.employee_code && (
                  <p className="text-xs text-red-500">{errors.employee_code.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">สัญชาติ *</Label>
                <select {...register('nationality')} className={SELECT_CLASS}>
                  {NATIONALITIES.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: เลขบัตรประชาชน / Passport + คำนำหน้า */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">
                  เลขบัตรประชาชน / Passport
                </Label>
                <Input
                  {...register('national_id')}
                  className="w-full h-11"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">คำนำหน้า</Label>
                <select {...register('prefix')} className={SELECT_CLASS}>
                  <option value="">เลือก</option>
                  <option value="นาย">นาย</option>
                  <option value="นาง">นาง</option>
                  <option value="นางสาว">นางสาว</option>
                </select>
              </div>
            </div>

            {/* Row 3: ชื่อ + นามสกุล */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">ชื่อ *</Label>
                <Input
                  {...register('first_name')}
                  className="w-full h-11"
                />
                {errors.first_name && (
                  <p className="text-xs text-red-500">{errors.first_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">
                  นามสกุล{isThai ? ' *' : ' (ไม่บังคับ)'}
                </Label>
                <Input
                  {...register('last_name')}
                  className="w-full h-11"
                />
                {errors.last_name && (
                  <p className="text-xs text-red-500">{errors.last_name.message}</p>
                )}
                {!isThai && (
                  <p className="text-[10px] sm:text-xs text-slate-400">
                    พนักงานต่างชาติไม่บังคับกรอกนามสกุล
                  </p>
                )}
              </div>
            </div>

            {/* Row 4: กลุ่มงาน + ตำแหน่งงาน */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">กลุ่มงาน *</Label>
                <select {...register('position')} className={SELECT_CLASS}>
                  <option value="worker">👷 พนักงาน (ทั่วไป)</option>
                  <option value="clerk">👩🏻‍🏫 เสมียน</option>
                </select>
                {position === 'clerk' && (
                  <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    ⚠️ เสมียน: คิดค่าแรงแบบรายเดือน / OT ชั่วโมงละ 1.5 เท่า
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">ตำแหน่งงาน</Label>
                <Input
                  {...register('job_title')}
                  placeholder="เช่น หัวหน้าช่าง, พนักงานขับรถ"
                  className="w-full h-11"
                />
              </div>
            </div>

            {/* Row 5: ประเภทค่าจ้าง + อัตราค่าจ้างรายวัน */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">ประเภทค่าจ้าง *</Label>
                <div className="flex gap-4 pt-2">
                  <label className={`flex items-center gap-2 text-sm ${position === 'worker' ? 'cursor-default opacity-100' : 'cursor-not-allowed opacity-50'}`}>
                    <input
                      type="radio"
                      value="daily"
                      {...register('wage_type')}
                      disabled={true}
                      className="w-4 h-4 accent-[#1D9E75]"
                    />
                    รายวัน (บาท/วัน)
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${position === 'clerk' ? 'cursor-default opacity-100' : 'cursor-not-allowed opacity-50'}`}>
                    <input
                      type="radio"
                      value="monthly"
                      {...register('wage_type')}
                      disabled={true}
                      className="w-4 h-4 accent-[#1D9E75]"
                    />
                    รายเดือน (บาท/เดือน)
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">
                  {wageType === 'monthly'
                    ? 'เงินเดือน (บาท/เดือน) *'
                    : 'อัตราค่าจ้างรายวัน (บาท) *'}
                </Label>
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-medium text-slate-400 group-focus-within:text-[#1D9E75] text-sm">
                    ฿
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    {...register('rate_per_12h')}
                    className="pl-8 w-full h-11"
                    placeholder={wageType === 'monthly' ? 'เช่น 15000' : 'เช่น 350'}
                  />
                </div>
                {wageType === 'monthly' && (
                  <p className="text-xs text-slate-400">
                    ระบบจะคำนวณ OT อัตโนมัติจากเงินเดือน ÷ 30 ÷ 8 × 1.5
                  </p>
                )}
                {wageType === 'daily' && position === 'worker' && currentRate > 0 && (
                  <div className="flex gap-2 mt-2">
                    <Badge variant="secondary" className="bg-[#1D9E75]/10 text-[#1D9E75] hover:bg-[#1D9E75]/20 font-medium border-0">ค่าจ้างปกติ: 357 ฿</Badge>
                    <Badge variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium border-0">ค่ากะ: {Math.max(0, currentRate - 357)} ฿</Badge>
                  </div>
                )}
                {errors.rate_per_12h && (
                  <p className="text-xs text-red-500">{errors.rate_per_12h.message}</p>
                )}
              </div>
            </div>

            {/* Row 4: Payment Method */}
            <div className="space-y-4 p-4 md:p-5 border border-slate-200 rounded-xl bg-slate-50">
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-slate-700">วิธีการรับเงิน</Label>
                <div className="flex flex-wrap gap-4 md:gap-8">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      value="bank_transfer"
                      {...register('payment_method')}
                      className="w-4 h-4 accent-[#1D9E75]"
                    />
                    โอนผ่านบัญชี
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      value="cash"
                      {...register('payment_method')}
                      className="w-4 h-4 accent-[#1D9E75]"
                    />
                    เงินสด
                  </label>
                </div>
              </div>

              {paymentMethod === 'bank_transfer' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">ธนาคาร *</Label>
                    <select {...register('bank_name')} className={SELECT_CLASS}>
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
                    {errors.bank_name && (
                      <p className="text-xs text-red-500">{errors.bank_name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">เลขที่บัญชี *</Label>
                    <Input
                      {...register('bank_account')}
                      placeholder="XXXXXXXXXX"
                      className="w-full h-11 bg-white"
                    />
                    {errors.bank_account && (
                      <p className="text-xs text-red-500">{errors.bank_account.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Row 7: สถานะ + หมายเหตุ */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="space-y-2 md:col-span-1">
                <Label className="text-sm font-semibold text-slate-700">สถานะ</Label>
                <select {...register('status')} className={SELECT_CLASS}>
                  <option value="active">พนักงานปัจจุบัน</option>
                  <option value="inactive">พ้นสภาพพนักงาน</option>
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-sm font-semibold text-slate-700">หมายเหตุ</Label>
                <Input
                  {...register('notes')}
                  className="w-full h-11"
                />
              </div>
            </div>

            {/* Data Complete Checkbox */}
            <div className={`flex items-start gap-3 p-4 md:p-5 rounded-xl border transition-all ${dataComplete
              ? 'border-[#1D9E75] bg-[#1D9E75]/5'
              : 'border-amber-200 bg-amber-50'
              }`}>
              <button
                type="button"
                onClick={() => setValue('data_complete', !dataComplete, { shouldDirty: true })}
                className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-all ${dataComplete
                  ? 'bg-[#1D9E75] border-[#1D9E75]'
                  : 'border-amber-400 bg-white'
                  }`}
              >
                {dataComplete && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <div className="flex-1">
                <p className={`font-semibold text-sm ${dataComplete ? 'text-[#1D9E75]' : 'text-amber-800'
                  }`}>
                  {dataComplete ? '✅ ข้อมูลสมบูรณ์' : '⚠️ ข้อมูลยังไม่สมบูรณ์ (Pending)'}
                </p>
                <p className={`text-[10px] sm:text-xs mt-0.5 ${dataComplete ? 'text-emerald-700' : 'text-amber-700'
                  }`}>
                  {dataComplete
                    ? 'ข้อมูลพนักงานได้รับการตรวจสอบและยืนยันความถูกต้องแล้ว'
                    : 'ยังรอข้อมูลเพิ่มเติมจากพนักงาน เช่น เลขบัญชี หรือเลขบัตรประชาชน — ติ๊กเมื่อข้อมูลครบและถูกต้อง'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-4 md:px-8 md:py-5 border-t border-slate-100 bg-white sticky bottom-0 z-10">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 md:flex-none"
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="bg-[#1D9E75] hover:bg-[#157a5a] flex-1 md:flex-none"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
