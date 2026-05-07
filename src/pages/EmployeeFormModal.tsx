import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { UserPlus } from 'lucide-react'

// Nationality options
export const NATIONALITIES = [
  { value: 'ไทย', label: '🇹🇭 ไทย' },
  { value: 'เมียนมาร์', label: '🇲🇲 เมียนมาร์/กะเหรี่ยง' },
  { value: 'กัมพูชา', label: '🇰🇭 กัมพูชา' },
  { value: 'ลาว', label: '🇱🇦 ลาว' },
]

// Helper: format name with nationality badge for foreign employees
export function formatEmployeeName(emp: {
  prefix?: string | null
  first_name: string
  last_name?: string | null
  nationality?: string | null
}) {
  const prefix = emp.prefix ? `${emp.prefix} ` : ''
  const lastName = emp.last_name?.trim() ? ` ${emp.last_name.trim()}` : ''
  const name = `${prefix}${emp.first_name}${lastName}`
  const nat = emp.nationality
  if (!nat || nat === 'ไทย') return name
  return `${name} (${nat})`
}

const employeeSchema = z
  .object({
    employee_code: z.string().min(1, 'กรุณาระบุรหัสพนักงาน'),
    prefix: z.string().optional(),
    first_name: z.string().min(1, 'กรุณาระบุชื่อ'),
    last_name: z.string().optional(),
    national_id: z.string().optional(),
    nationality: z.string().default('ไทย'),
    payment_method: z.enum(['cash', 'bank_transfer']),
    bank_name: z.string().optional(),
    bank_account: z.string().optional(),
    rate_per_12h: z.coerce.number().min(1, 'กรุณาระบุค่าแรง'),
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

const SELECT_CLASS =
  'flex h-12 w-full rounded-lg border-2 border-slate-100 bg-slate-50 px-4 py-2 text-base transition-all focus:border-[#1D9E75] outline-none'

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
      return data as any
    },
    enabled: !!employeeId && isOpen,
  })

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
        const { error } = await (supabase as any)
          .from('employees')
          .update(payload as any)
          .eq('id', employeeId)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('employees')
          .insert(payload as any)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(employeeId ? 'อัปเดตข้อมูลสำเร็จ' : 'เพิ่มพนักงานสำเร็จ')
      onClose()
    },
    onError: (error: any) => {
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
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-none shadow-2xl max-h-[92vh] flex flex-col">
        {/* ── Green Header ── */}
        <div className="bg-[#1D9E75] p-6 text-white flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <UserPlus className="w-7 h-7" />
              {employeeId ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
            </DialogTitle>
            <p className="text-emerald-100 mt-1 text-sm">
              {employeeId
                ? 'แก้ไขข้อมูลพนักงานและบันทึกการเปลี่ยนแปลง'
                : 'กรอกข้อมูลพนักงานใหม่ให้ครบถ้วน'}
            </p>
          </DialogHeader>
        </div>

        {/* ── Form Body ── */}
        <form
          onSubmit={handleSubmit(onSubmit as any)}
          className="flex-1 overflow-y-auto"
        >
          <div className="p-8 bg-white space-y-7">

            {/* Row 1: Employee Code + Nationality */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">รหัสพนักงาน *</Label>
                <Input
                  {...register('employee_code')}
                  placeholder="เช่น 001"
                  className="h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                />
                {errors.employee_code && (
                  <p className="text-xs text-red-500">{errors.employee_code.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">สัญชาติ *</Label>
                <select {...register('nationality')} className={SELECT_CLASS}>
                  {NATIONALITIES.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Prefix + First Name + Last Name */}
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">คำนำหน้า</Label>
                <select {...register('prefix')} className={SELECT_CLASS}>
                  <option value="">เลือก</option>
                  <option value="นาย">นาย</option>
                  <option value="นาง">นาง</option>
                  <option value="นางสาว">นางสาว</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">ชื่อ *</Label>
                <Input
                  {...register('first_name')}
                  className="h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                />
                {errors.first_name && (
                  <p className="text-xs text-red-500">{errors.first_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">
                  นามสกุล{isThai ? ' *' : ' (ไม่บังคับ)'}
                </Label>
                <Input
                  {...register('last_name')}
                  className="h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                />
                {errors.last_name && (
                  <p className="text-xs text-red-500">{errors.last_name.message}</p>
                )}
                {!isThai && (
                  <p className="text-xs text-slate-400">
                    พนักงานต่างชาติไม่บังคับกรอกนามสกุล
                  </p>
                )}
              </div>
            </div>

            {/* Row 3: National ID + Wage */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">
                  เลขบัตรประชาชน / Passport
                </Label>
                <Input
                  {...register('national_id')}
                  className="h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">
                  อัตราค่าจ้างรายวัน (บาท) *
                </Label>
                <div className="relative group">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 group-focus-within:text-[#1D9E75]">
                    ฿
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    {...register('rate_per_12h')}
                    className="pl-8 h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                  />
                </div>
                {errors.rate_per_12h && (
                  <p className="text-xs text-red-500">{errors.rate_per_12h.message}</p>
                )}
              </div>
            </div>

            {/* Row 4: Payment Method */}
            <div className="space-y-4 p-5 border-2 border-slate-100 rounded-xl bg-slate-50">
              <div className="space-y-3">
                <Label className="text-base font-bold text-slate-800">วิธีการรับเงิน</Label>
                <div className="flex gap-8">
                  <label className="flex items-center gap-2 text-base cursor-pointer">
                    <input
                      type="radio"
                      value="bank_transfer"
                      {...register('payment_method')}
                      className="w-4 h-4 accent-[#1D9E75]"
                    />
                    โอนผ่านบัญชี
                  </label>
                  <label className="flex items-center gap-2 text-base cursor-pointer">
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
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-base font-bold text-slate-800">ธนาคาร *</Label>
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
                    <Label className="text-base font-bold text-slate-800">เลขที่บัญชี *</Label>
                    <Input
                      {...register('bank_account')}
                      placeholder="XXXXXXXXXX"
                      className="h-12 text-base border-2 border-slate-100 bg-white focus:border-[#1D9E75]"
                    />
                    {errors.bank_account && (
                      <p className="text-xs text-red-500">{errors.bank_account.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Row 5: Status + Notes */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">สถานะ</Label>
                <select {...register('status')} className={SELECT_CLASS}>
                  <option value="active">พนักงานปัจจุบัน</option>
                  <option value="inactive">พ้นสภาพพนักงาน</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-base font-bold text-slate-800">หมายเหตุ</Label>
                <Input
                  {...register('notes')}
                  className="h-12 text-base border-2 border-slate-100 bg-slate-50 focus:border-[#1D9E75]"
                />
              </div>
            </div>

            {/* Data Complete Checkbox */}
            <div className={`flex items-start gap-4 p-5 rounded-xl border-2 transition-all ${
              dataComplete
                ? 'border-[#1D9E75] bg-[#1D9E75]/5'
                : 'border-amber-200 bg-amber-50'
            }`}>
              <button
                type="button"
                onClick={() => setValue('data_complete', !dataComplete, { shouldDirty: true })}
                className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                  dataComplete
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
                <p className={`font-bold text-base ${
                  dataComplete ? 'text-[#1D9E75]' : 'text-amber-800'
                }`}>
                  {dataComplete ? '✅ ข้อมูลสมบูรณ์' : '⚠️ ข้อมูลยังไม่สมบูรณ์ (Pending)'}
                </p>
                <p className={`text-sm mt-0.5 ${
                  dataComplete ? 'text-emerald-700' : 'text-amber-700'
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
          <div className="flex justify-end gap-4 px-8 py-5 border-t border-slate-100 bg-white">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onClose}
              className="h-12 px-10 text-base font-bold border-2"
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-12 px-12 text-base font-bold bg-[#1D9E75] hover:bg-[#157a5a] shadow-lg shadow-[#1D9E75]/20"
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
