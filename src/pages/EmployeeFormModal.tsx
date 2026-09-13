import { useEffect, useState, useRef, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { toast } from 'sonner'
import { UserPlus, X, AlertTriangle } from 'lucide-react'
import { NATIONALITIES } from '@/lib/constants'
import { normalizePrefix, cleanEmployeeNameData } from '@/lib/formatters'
import '../styles/tokens.css'
import { isTpiCompany, isTpiJobCode, type Job } from '../features/tpi/model'
import { demoJobs } from '../features/tpi/demoData'
import { employeeWageForm } from '../features/tpi/employeeWageForm'
import { ThaiDatePicker } from '../components/common/ThaiDatePicker'
import './TpiShiftEntry.css'

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
    exempt_social_security: z.boolean().default(false),
    is_safety_officer: z.boolean().default(false),
    has_position_allowance: z.boolean().default(false),
    social_security_number: z.string().optional(),
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
  exempt_social_security: boolean
  is_safety_officer?: boolean | null
  has_position_allowance?: boolean | null
  social_security_number?: string | null
}

const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
}

const errorStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--vk-crimson)', marginTop: 2,
}

export default function EmployeeFormModal({ isOpen, onClose, employeeId, onSuccess }: Props) {
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()
  const [inactiveConfirm, setInactiveConfirm] = useState<{ shiftCount: number; pendingValues: EmployeeFormValues } | null>(null)

  // Fetch factories list to reliably identify active factory name
  const { data: factories = [] } = useQuery({
    queryKey: ['factories-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('id, name')
      if (error) return []
      return data || []
    },
    staleTime: 60000,
  })

  const currentFactoryName =
    factories.find((f) => f.id === user?.factory_id)?.name ||
    companyContext?.factoryName ||
    companyContext?.name ||
    ''

  const isTpi = isTpiCompany(currentFactoryName)

  // TPI specific wage tier state — seed from QueryClient cache if available
  // so the correct value is shown immediately on mount (component re-mounts every open)
  const cachedWageProfile = employeeId
    ? queryClient.getQueryData<any>(['tpi-employee-wage', user?.factory_id, employeeId])
    : undefined

  const [tpiRateTier, setTpiRateTier] = useState<'normal' | 'skilled'>(
    () => (cachedWageProfile?.rate_tier as 'normal' | 'skilled') || 'normal'
  )
  const [tpiSkilledFrom, setTpiSkilledFrom] = useState<string>(
    () => cachedWageProfile?.skilled_from === '0001-01-01' ? '' : cachedWageProfile?.skilled_from || ''
  )
  const [tpiJobCode, setTpiJobCode] = useState<string>(
    () => (cachedWageProfile as any)?.job_code || ''
  )
  const [tpiJobId, setTpiJobId] = useState<string>(
    () => (cachedWageProfile as any)?.job_id || ''
  )

  // Query TPI Job Codes for selection
  const { data: dbTpiJobs = [] } = useQuery<Job[]>({
    queryKey: ['tpi-jobs-for-employee-form', user?.factory_id],
    enabled: !!user?.factory_id && isOpen && isTpi,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', user!.factory_id)
        .order('code')
      if (error) return []
      return (data || []) as Job[]
    },
    staleTime: 30000,
  })

  // Filter only Active jobs (active === true and not expired)
  const activeTpiJobs = useMemo(() => {
    const list = dbTpiJobs.length > 0 ? dbTpiJobs : demoJobs
    const todayStr = new Date().toISOString().split('T')[0]
    return list.filter((j) => {
      if (!j.active) return false
      if (j.expires_on && j.expires_on < todayStr) return false
      if (j.valid_from && j.valid_from > todayStr) return false
      return true
    })
  }, [dbTpiJobs])

  const selectedActiveJob = useMemo(() => {
    return activeTpiJobs.find((j) => j.code.trim().toLowerCase() === tpiJobCode.trim().toLowerCase() || j.id === tpiJobId)
  }, [activeTpiJobs, tpiJobCode, tpiJobId])

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema) as any,
    defaultValues: { payment_method: 'bank_transfer', status: 'active', nationality: 'ไทย', data_complete: false },
  })

  const paymentMethod = watch('payment_method')
  const nationality = watch('nationality')
  const prefix = watch('prefix')
  const dataComplete = watch('data_complete')
  const exemptSS = watch('exempt_social_security')
  const isSafetyOfficer = watch('is_safety_officer')
  const nationalIdWatch = watch('national_id')
  const wageType = watch('wage_type')
  const position = watch('position')
  const currentRate = watch('rate_per_12h') || 0
  const isThai = !nationality || nationality === 'ไทย'
  const prevNationalityRef = useRef<string>(nationality || 'ไทย')

  // When nationality switches between Thai and Foreign (TPI factory only), convert prefix
  useEffect(() => {
    if (!isTpi) return
    const prev = prevNationalityRef.current
    if (prev !== nationality) {
      if (nationality !== 'ไทย' && prev === 'ไทย') {
        if (prefix === 'นาย') setValue('prefix', 'Mr.')
        else if (prefix === 'นาง') setValue('prefix', 'Mrs.')
        else if (prefix === 'นางสาว') setValue('prefix', 'Ms.')
      } else if (nationality === 'ไทย' && prev !== 'ไทย') {
        if (prefix === 'Mr.' || prefix === 'Mr') setValue('prefix', 'นาย')
        else if (prefix === 'Mrs.' || prefix === 'Mrs') setValue('prefix', 'นาง')
        else if (prefix === 'Ms.' || prefix === 'Ms') setValue('prefix', 'นางสาว')
      }
      prevNationalityRef.current = nationality
    }
  }, [nationality, prefix, setValue, isTpi])

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

  // Query TPI Wage Profile for existing employee
  // NOTE: do NOT include isTpi in enabled — factories query may still be loading when this
  // component mounts, causing isTpi=false momentarily and missing the cache key on getQueryData.
  const { data: tpiWageProfile, isLoading: isLoadingWageProfile, error: wageProfileError } = useQuery({
    queryKey: ['tpi-employee-wage', user?.factory_id, employeeId],
    enabled: !!user?.factory_id && !!employeeId && isOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('*')
        .eq('employee_id', employeeId!)
        .eq('factory_id', user!.factory_id)
        .maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 0,
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
    if (!isTpi) {
      if (position === 'clerk') setValue('wage_type', 'monthly')
      else if (position === 'worker') setValue('wage_type', 'daily')
    } else {
      setValue('wage_type', 'daily')
    }
  }, [position, setValue, isTpi])

  const wageInitialized = useRef<string | null>(null)
  useEffect(() => {
    if (!isOpen) {
      wageInitialized.current = null
      return
    }
    if (!isTpi) return
    const sessionKey = employeeId || 'new'
    if (wageInitialized.current === sessionKey) return
    if (employeeId && (!employeeData || tpiWageProfile === undefined)) return
    wageInitialized.current = sessionKey

    const settings = employeeWageForm(
      employeeId ? employeeData?.job_title : '',
      employeeId ? tpiWageProfile : null,
      dbTpiJobs.length > 0 ? dbTpiJobs : demoJobs,
    )
    setTpiRateTier(settings.rateTier)
    setTpiSkilledFrom(settings.skilledFrom)
    setTpiJobCode(settings.jobCode)
    setTpiJobId(settings.jobId)
  }, [tpiWageProfile, employeeData, employeeId, isOpen, isTpi, dbTpiJobs])

  const employeeInitialized = useRef<string | null>(null)
  useEffect(() => {
    if (!isOpen) {
      employeeInitialized.current = null
      return
    }
    const sessionKey = `${employeeId || 'new'}:${isTpi}`
    if (employeeInitialized.current === sessionKey) return
    if (employeeId && !employeeData) return
    employeeInitialized.current = sessionKey
    if (employeeData && isOpen) {
      const empNat = employeeData.nationality || 'ไทย'
      const cleaned = cleanEmployeeNameData(employeeData, isTpi)
      const normPref = normalizePrefix(cleaned.prefix, empNat, cleaned.first_name, isTpi)
      prevNationalityRef.current = empNat
      reset({
        employee_code: employeeData.employee_code,
        prefix: normPref || '',
        first_name: cleaned.first_name,
        last_name: cleaned.last_name || '',
        national_id: employeeData.national_id || '',
        nationality: empNat,
        position: employeeData.position || 'worker',
        job_title: (isTpi && isTpiJobCode(employeeData.job_title)) ? '' : (employeeData.job_title || ''),
        wage_type: employeeData.wage_type || 'daily',
        payment_method: employeeData.payment_method || 'bank_transfer',
        bank_name: (() => {
          const b = (employeeData.bank_name || '').trim()
          if (b.includes('เกษตร') || b.includes('ธ.ก.ส') || b.includes('ธกส') || b.toLowerCase().includes('baac')) {
            return 'ธ.ก.ส.'
          }
          return employeeData.bank_name || ''
        })(),
        bank_account: employeeData.bank_account || '',
        rate_per_12h: employeeData.rate_per_12h || 0,
        status: (employeeData.status as any) || 'active',
        notes: employeeData.notes || '',
        data_complete: employeeData.data_complete || false,
        exempt_social_security: employeeData.exempt_social_security || false,
        is_safety_officer: employeeData.is_safety_officer || false,
        has_position_allowance: isTpi ? false : (employeeData.has_position_allowance || false),
        social_security_number: employeeData.social_security_number || '',
      })
    } else if (!employeeId && isOpen) {
      prevNationalityRef.current = 'ไทย'
      reset({
        employee_code: '',
        prefix: 'นาย',
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
        exempt_social_security: false,
        is_safety_officer: false,
        has_position_allowance: false,
        social_security_number: '',
      })
    }
  }, [employeeData, employeeId, isOpen, reset, isTpi])

  const mutation = useMutation({
    mutationFn: async ({ values, deleteShifts }: { values: EmployeeFormValues; deleteShifts: boolean }) => {
      if (!user?.factory_id) throw new Error('No factory context')
      // Delete all shift assignments for this employee if requested
      if (deleteShifts && employeeId) {
        const { error: shiftErr } = await supabase.from('shift_assignments').delete().eq('employee_id', employeeId)
        if (shiftErr) throw shiftErr
      }
      const cleaned = cleanEmployeeNameData(values, isTpi)
      const normPrefix = normalizePrefix(cleaned.prefix, values.nationality, cleaned.first_name, isTpi)
      const payload = {
        ...values,
        prefix: normPrefix || null,
        first_name: cleaned.first_name,
        last_name: cleaned.last_name?.trim() || '',
        factory_id: user.factory_id,
        bank_name: values.payment_method === 'cash' ? null : values.bank_name,
        bank_account: values.payment_method === 'cash' ? null : values.bank_account,
        job_title: values.job_title?.trim() || null,
        wage_type: isTpi ? 'daily' : values.wage_type,
        rate_per_12h: isTpi ? 0 : values.rate_per_12h,
        has_position_allowance: isTpi ? false : values.has_position_allowance,
        is_safety_officer: isTpi ? values.is_safety_officer : false,
      }
      let savedEmpId = employeeId
      if (employeeId) {
        const { error } = await supabase.from('employees').update(payload).eq('id', employeeId)
        if (error) throw error
      } else {
        const { data: newEmp, error } = await supabase.from('employees').insert(payload).select('id').single()
        if (error) throw error
        savedEmpId = newEmp.id
      }

      // Upsert TPI Wage Profile if in TPI factory
      if (isTpi && savedEmpId) {
        const profilePayload: any = {
          employee_id: savedEmpId,
          factory_id: user.factory_id,
          rate_tier: tpiRateTier,
          // Legacy DB requires a date: earliest date represents no start restriction.
          skilled_from: tpiRateTier === 'skilled' ? (tpiSkilledFrom || '0001-01-01') : null,
          job_id: tpiRateTier === 'skilled' ? (tpiJobId || null) : null,
          job_code: tpiRateTier === 'skilled' ? (tpiJobCode || null) : null,
          updated_at: new Date().toISOString(),
        }

        const saveProfile = () => supabase
          .from('tpi_employee_wage_profiles')
          .upsert(profilePayload, { onConflict: 'employee_id' })
          .select('*')
          .single()
        let { data: savedProfile, error: profileErr } = await saveProfile()

        // Older databases store the assigned job in employees.job_title.
        // Retry only an explicitly missing optional column, preserving any supported column.
        for (let attempt = 0; profileErr && attempt < 2; attempt++) {
          if (!['PGRST204', '42703'].includes(profileErr.code)) break
          const missingColumn = ['job_code', 'job_id'].find((column) =>
            Object.hasOwn(profilePayload, column) &&
            (profileErr!.message.includes(`'${column}'`) || profileErr!.message.includes(`"${column}"`))
          )
          if (!missingColumn) break
          delete profilePayload[missingColumn]
          const result = await saveProfile()
          savedProfile = result.data
          profileErr = result.error
        }

        if (profileErr) throw profileErr
        queryClient.setQueryData(
          ['tpi-employee-wage', user.factory_id, savedEmpId], savedProfile
        )
      }
    },
    onSuccess: (_, { deleteShifts }) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['employees-all'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-employee-wage'] })
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
    if (isTpi && employeeId && (isLoadingWageProfile || wageProfileError)) {
      toast.error('ยังโหลดประเภทค่าแรงไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่อีกครั้ง')
      return
    }
    if (isTpi && tpiRateTier === 'skilled' && position !== 'clerk' && !tpiJobCode) {
      toast.error('กรุณาเลือกรหัสงานที่ Active อยู่สำหรับพนักงานค่าแรงฝีมือ')
      return
    }
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

            {/* Row 2: เลขบัตร / เลข ปกส (ต่างชาติ) + คำนำหน้า */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">
                  {isThai ? 'เลขบัตรประชาชน' : 'เลขประจำตัวประกันสังคม (ปกส)'}
                </label>
                <input
                  className="vk-input"
                  {...register('national_id')}
                  placeholder={isThai ? 'เลขบัตรประชาชน 13 หลัก' : 'ระบุเลข ปกส เมื่อได้รับแล้ว'}
                />
              </div>
              <div style={fieldStyle}>
                <label className="vk-eyebrow">คำนำหน้า</label>
                <select className="vk-input" {...register('prefix')}>
                  <option value="">{isTpi && !isThai ? 'Select' : 'เลือก'}</option>
                  {isTpi && !isThai ? (
                    <>
                      <option value="Mr.">Mr.</option>
                      <option value="Ms.">Ms.</option>
                      <option value="Mrs.">Mrs.</option>
                    </>
                  ) : (
                    <>
                      <option value="นาย">นาย</option>
                      <option value="นาง">นาง</option>
                      <option value="นางสาว">นางสาว</option>
                    </>
                  )}
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
                {position === 'clerk' && !isTpi && (
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

            {/* Row 5: ประเภทค่าแรง (TPI: Radio ปกติ/ฝีมือ | ตราเพชร: รายวัน/รายเดือน) */}
            {isTpi ? (
              <div style={{ background: '#faf8f4', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <label className="vk-eyebrow" style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)', margin: 0 }}>
                    ประเภทค่าแรงพนักงาน <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                    (คิดค่าแรงอัตโนมัติตามอัตราของรหัสงาน)
                  </span>
                </div>

                {isLoadingWageProfile && employeeId && <p role="status">กำลังโหลดประเภทค่าแรง...</p>}
                {wageProfileError && <p role="alert">โหลดประเภทค่าแรงไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่อีกครั้ง</p>}
                <fieldset disabled={mutation.isPending || (!!employeeId && (isLoadingWageProfile || !!wageProfileError))} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Option 1: ค่าแรงปกติ */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: tpiRateTier === 'normal' ? '2px solid var(--vk-persimmon)' : '1px solid var(--vk-rule-soft)',
                      background: tpiRateTier === 'normal' ? '#ffffff' : '#ffffff',
                      boxShadow: tpiRateTier === 'normal' ? '0 1px 3px rgba(177,71,41,0.1)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="tpi_rate_tier"
                      value="normal"
                      checked={tpiRateTier === 'normal'}
                      onChange={() => {
                        setTpiRateTier('normal')
                        setTpiJobCode('')
                        setTpiJobId('')
                        setTpiSkilledFrom('')
                      }}
                      style={{ width: 18, height: 18, accentColor: 'var(--vk-persimmon)', marginTop: 2, cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>
                        ค่าแรงปกติ
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                        อัตราค่าแรงปกติของแต่ละรหัสงาน
                      </div>
                    </div>
                  </label>

                  {/* Option 2: ค่าแรงฝีมือ */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: tpiRateTier === 'skilled' ? '2px solid #16a34a' : '1px solid var(--vk-rule-soft)',
                      background: tpiRateTier === 'skilled' ? '#ffffff' : '#ffffff',
                      boxShadow: tpiRateTier === 'skilled' ? '0 1px 3px rgba(22,163,74,0.1)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="tpi_rate_tier"
                      value="skilled"
                      checked={tpiRateTier === 'skilled'}
                      onChange={() => setTpiRateTier('skilled')}
                      style={{ width: 18, height: 18, accentColor: '#16a34a', marginTop: 2, cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                        ค่าแรงฝีมือ
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                        อัตราค่าแรงฝีมือตามรหัสงาน
                      </div>
                    </div>
                  </label>
                </fieldset>

                {tpiRateTier === 'skilled' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, padding: '14px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    {position === 'clerk' ? (
                      <div style={{ fontSize: 12, color: '#166534', background: 'rgba(22,163,74,0.08)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #16a34a', lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#15803d' }}>
                          <span>🏢</span> กลุ่มงานเสมียน — ได้รับเรทฝีมือ ฿377 อัตโนมัติ
                        </div>
                        พนักงานตำแหน่งเสมียนจะได้รับอัตราค่าแรงฝีมือ <strong>฿377</strong> ต่อกะ (ดึงจากฐานข้อมูล) ในทุกรหัสงานกลุ่มเสมียน (692021, 692032, 692041, 692050) แม้จะมีการสลับหมุนเวียนตำแหน่ง (Rotation) เป็นประจำ โดยไม่ต้องผูกติดกับรหัสงานเดี่ยว
                      </div>
                    ) : (
                      /* Job Code selector for general workers */
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 700, color: '#166534', display: 'block', marginBottom: 6 }}>
                          รหัสงานประจำ (สำหรับค่าแรงฝีมือ) <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                        </label>
                        {activeTpiJobs.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#b45309', background: '#fef9c3', padding: '8px 12px', borderRadius: 6, border: '1px solid #fde047' }}>
                            ไม่พบรหัสงานที่ Active — กรุณาเพิ่มรหัสงานในหน้าจัดการรหัสงาน (TPI) ก่อน
                          </div>
                        ) : (
                          <select
                            className="vk-input"
                            value={tpiJobCode}
                            onChange={(e) => {
                              const code = e.target.value
                              setTpiJobCode(code)
                              const matched = activeTpiJobs.find(j => j.code === code)
                              setTpiJobId(matched?.id || '')
                            }}
                            style={{ borderColor: !tpiJobCode ? 'var(--vk-crimson)' : '#86efac', background: '#fff' }}
                          >
                            <option value="">— เลือกรหัสงานประจำ —</option>
                            {activeTpiJobs.map(j => (
                              <option key={j.id} value={j.code}>
                                {j.code}{j.description ? ` – ${j.description}` : ''}{j.skilled_rate ? ` (ฝีมือ ฿${j.skilled_rate.toLocaleString()})` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {!tpiJobCode && (
                          <span style={{ fontSize: 11, color: 'var(--vk-crimson)', marginTop: 4, display: 'block' }}>
                            ⚠ กรุณาเลือกรหัสงานประจำก่อนบันทึก
                          </span>
                        )}
                        {tpiJobCode && selectedActiveJob && (
                          <span style={{ fontSize: 11, color: '#166534', marginTop: 4, display: 'block' }}>
                            ✓ รหัสงาน <strong>{selectedActiveJob.code}</strong> — เรทฝีมือ ฿{(selectedActiveJob.skilled_rate || 0).toLocaleString()} / เรทปกติ ฿{(selectedActiveJob.normal_rate || 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Skilled from date */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#166534', whiteSpace: 'nowrap' }}>
                        วันที่เริ่มใช้เรทฝีมือ (ถ้ามี):
                      </label>
                      <div style={{ maxWidth: 220, width: '100%' }}>
                        <ThaiDatePicker
                          value={tpiSkilledFrom}
                          onChange={(val) => setTpiSkilledFrom(val || '')}
                          placeholder="วว/ดด/ปปปป (พ.ศ.)"
                          aria-label="วันที่เริ่มใช้เรทฝีมือ (ถ้ามี)"
                        />
                      </div>
                    </div>

                    {/* Use-case explanation */}
                    {position !== 'clerk' && (
                      <div style={{ fontSize: 11, color: '#166534', background: 'rgba(22,163,74,0.07)', padding: '8px 12px', borderRadius: 6, borderLeft: '3px solid #86efac', lineHeight: 1.6 }}>
                        <strong>หลักการค่าแรงฝีมือ:</strong> พนักงานจะได้รับ<strong>เรทฝีมือ</strong>เฉพาะวันที่ปฏิบัติงานในรหัสงานประจำที่เลือกไว้เท่านั้น
                        หากมีการโยกย้ายไปทำงานรหัสอื่นชั่วคราว จะคิดเป็น<strong>เรทปกติ</strong>แทน
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
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
            )}

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
                      <option value="ธ.ก.ส.">ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส. / BAAC)</option>
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

            {/* สิทธิ์เงินพิเศษ จป. (TPI Special Allowances) */}
            {isTpi && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  สิทธิ์เงินพิเศษ จป. (จ่ายในงวดที่จบที่สิ้นเดือน)
                </div>

                {/* Checkbox: เจ้าหน้าที่ความปลอดภัย (จป.) */}
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
                  border: `1px solid ${isSafetyOfficer ? '#059669' : 'var(--vk-rule-soft)'}`,
                  background: isSafetyOfficer ? '#ecfdf5' : 'var(--vk-bone)',
                  cursor: 'pointer',
                }}>
                  <input type="checkbox" {...register('is_safety_officer')}
                    style={{ marginTop: 2, accentColor: '#059669', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isSafetyOfficer ? '#065f46' : 'var(--vk-ink)' }}>
                      เจ้าหน้าที่ความปลอดภัย (จป.) (+500 บาท/เดือน)
                    </div>
                    <div style={{ fontSize: 11, color: isSafetyOfficer ? '#047857' : 'var(--vk-ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                      จ่ายเพิ่มให้คนละ 500 บาท/เดือน ในงวดที่จบที่สิ้นเดือน (งวดหลัง)
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* ยกเว้นประกันสังคม — เฉพาะพนักงานสัญชาติไทย */}
            {isThai && (
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
                border: `1px solid ${exemptSS ? '#94a3b8' : 'var(--vk-rule-soft)'}`,
                background: exemptSS ? '#f8fafc' : 'var(--vk-bone)',
                cursor: 'pointer',
              }}>
                <input type="checkbox" {...register('exempt_social_security')}
                  style={{ marginTop: 2, accentColor: '#475569', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: exemptSS ? '#334155' : 'var(--vk-ink)' }}>
                    ไม่หักประกันสังคม (ยกเว้น ปกส)
                  </div>
                  <div style={{ fontSize: 11, color: exemptSS ? '#64748b' : 'var(--vk-ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                    คิดเงินเต็มจำนวน ไม่หักประกันสังคม — สำหรับพนักงานไทยที่ได้รับการยกเว้น
                  </div>
                </div>
              </label>
            )}

            {/* สำหรับพนักงานต่างชาติ: แจ้งเตือนสถานะการหัก ปกส */}
            {!isThai && (
              <div style={{
                padding: '12px 16px',
                background: (nationalIdWatch?.trim() && dataComplete) ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${(nationalIdWatch?.trim() && dataComplete) ? '#86efac' : '#fde68a'}`,
                fontSize: 12,
                lineHeight: 1.6,
                color: (nationalIdWatch?.trim() && dataComplete) ? '#166534' : '#92400e',
              }}>
                {(nationalIdWatch?.trim() && dataComplete) ? (
                  <span>✓ <strong>พร้อมหัก ปกส:</strong> มีเลข ปกส และข้อมูลสมบูรณ์แล้ว ระบบจะหัก ปกส ตามอัตราที่กำหนดในงวด (จากกะแรก) อัตโนมัติ</span>
                ) : (
                  <span>⚠️ <strong>พนักงานต่างชาติ:</strong> จะถูกหัก ปกส เมื่อกรอกเลขประจำตัว ปกส ในช่องด้านบน และกดติ๊ก <strong>"ข้อมูลสมบูรณ์"</strong> ด้านล่างนี้เรียบร้อยแล้ว</span>
                )}
              </div>
            )}

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
            <button type="submit" className="vk-btn vk-btn--primary" disabled={mutation.isPending || (isTpi && !!employeeId && (isLoadingWageProfile || !!wageProfileError))}>
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
              <button className="vk-btn vk-btn--primary" disabled={mutation.isPending || (isTpi && !!employeeId && (isLoadingWageProfile || !!wageProfileError))}
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
