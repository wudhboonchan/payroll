import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState, useMemo } from 'react'
import { Plus, Trash2, Pencil, AlertTriangle, Search, X, Camera, ShieldAlert, UserX } from 'lucide-react'
import { toast } from 'sonner'
import type { Job, WageProfile } from '../features/tpi/model'
import { localDate, isTpiCompany } from '../features/tpi/model'
import { demoJobs } from '../features/tpi/demoData'
import { compareEmployeeCode, formatThaiDateDDMMYYYY } from '../lib/formatters'
import { ThaiDatePicker } from '../components/common/ThaiDatePicker'
import '../styles/tokens.css'

function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return null
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา'
  return nationality
}

function renderNotes(notes: string | null) {
  if (!notes) return '—'
  if (notes.includes('[สแกนหน้าไม่สำเร็จ]') || notes.includes('สแกนหน้าไม่สำเร็จ')) {
    const cleanNote = notes.replace('[สแกนหน้าไม่สำเร็จ]', '').trim()
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: '#fee2e2',
            color: '#b91c1c',
            border: '1px solid #fca5a5',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <Camera style={{ width: 11, height: 11 }} /> สแกนหน้าไม่สำเร็จ
        </span>
        {cleanNote && <span style={{ fontSize: 13 }}>{cleanNote}</span>}
      </div>
    )
  }
  if (
    notes.includes('[ลงโทษ ขาดงานไม่มีคนแทน]') ||
    notes.includes('ลงโทษ ขาดงาน') ||
    notes.includes('[ลงโทษ ขาด/ลา/มาสาย]') ||
    notes.includes('ลงโทษ ขาด/ลา/มาสาย')
  ) {
    const cleanNote = notes
      .replace(/\[ลงโทษ\s*(ขาดงานไม่มีคนแทน|ขาด\/ลา\/มาสาย|ขาดงาน)\]/, '')
      .replace(/วันที่:\s*([\d\/\-]+)/, (_, d) => `วันที่: ${formatThaiDateDDMMYYYY(d)}`)
      .trim()
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: '#fff7ed',
            color: '#c2410c',
            border: '1px solid #fdba74',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <UserX style={{ width: 11, height: 11 }} /> ลงโทษ ขาดงาน (ไม่มีคนแทน)
        </span>
        {cleanNote && <span style={{ fontSize: 13 }}>{cleanNote}</span>}
      </div>
    )
  }
  if (notes.includes('[หักค่าปรับ จป.]') || notes.includes('หักค่าปรับผิดระเบียบ') || notes.includes('ค่าปรับผิดระเบียบ')) {
    const cleanNote = notes.replace('[หักค่าปรับ จป.]', '').trim()
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: '#ede9fe',
            color: '#6d28d9',
            border: '1px solid #c4b5fd',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <ShieldAlert style={{ width: 11, height: 11 }} /> ค่าปรับผิดระเบียบ (จป.)
        </span>
        {cleanNote && <span style={{ fontSize: 13 }}>{cleanNote}</span>}
      </div>
    )
  }
  return notes
}

export default function Advances() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()

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

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'advance' | 'carryover'>('advance')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingEmp, setEditingEmp] = useState<{ employee_code: string; first_name: string; last_name: string; nationality?: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', amount: '', notes: '' })
  const [empSearch, setEmpSearch] = useState('')

  // ── Scan failure deduction (สแกนหน้าไม่สำเร็จ) state ──
  const [isScanModalOpen, setIsScanModalOpen] = useState(false)
  const [scanEmpSearch, setScanEmpSearch] = useState('')
  const [scanLookupLoading, setScanLookupLoading] = useState(false)
  const [scanLookupResult, setScanLookupResult] = useState<{
    source: 'shift' | 'not_found'
    job_code: string
    job_desc: string
    rate_tier: 'normal' | 'skilled'
    base_rate: number
    shift_name: string
  } | null>(null)
  const [isScanManualOverride, setIsScanManualOverride] = useState(false)
  const [scanForm, setScanForm] = useState({
    employee_id: '',
    work_date: localDate(),
    job_id: '',
    rate_tier: 'normal' as 'normal' | 'skilled' | 'custom',
    base_rate: 357,
    amount: '178.50',
    custom_notes: '',
  })

  // ── Disciplinary deduction (ขาดงานไม่มีคนแทน) state ──
  const [isDiscModalOpen, setIsDiscModalOpen] = useState(false)
  const [discEmpSearch, setDiscEmpSearch] = useState('')
  const [discLookupLoading, setDiscLookupLoading] = useState(false)
  const [discLookupResult, setDiscLookupResult] = useState<{
    source: 'shift' | 'not_found'
    job_code: string
    job_desc: string
    rate_tier: 'normal' | 'skilled'
    base_rate: number
    shift_name: string
  } | null>(null)
  const [isDiscManualOverride, setIsDiscManualOverride] = useState(false)
  const [discForm, setDiscForm] = useState({
    employee_id: '',
    work_date: localDate(),
    job_id: '',
    rate_tier: 'normal' as 'normal' | 'skilled' | 'custom',
    base_rate: 357,
    amount: '714.00',
    custom_notes: '',
  })

  const isEdit = !!editingId

  const openCreate = (mode: 'advance' | 'carryover' = 'advance') => {
    setEditingId(null)
    setModalMode(mode)
    setForm({ employee_id: '', amount: '', notes: mode === 'carryover' ? 'ยอดเบิกเกินค้างจากงวดก่อน' : '' })
    setIsModalOpen(true)
  }

  const openEdit = (a: any) => {
    setEditingId(a.id)
    setModalMode(a.is_carryover ? 'carryover' : 'advance')
    const empId = a.employee_id || ''
    setForm({ employee_id: empId, amount: String(a.amount), notes: a.notes || '' })
    setEditingEmp(a.employee as any)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setEditingEmp(null)
    setModalMode('advance')
    setForm({ employee_id: '', amount: '', notes: '' })
    setEmpSearch('')
  }

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })
  const currentPeriod = periods[0]
  const prevPeriod = periods[1] ?? null

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name,nationality,job_title,rate_per_12h').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error
      return (data || []).sort((a: any, b: any) => compareEmployeeCode(a.employee_code, b.employee_code))
    }, enabled: !!user?.factory_id,
  })

  const { data: advances = [], refetch: refetchAdvances } = useQuery<any[]>({
    queryKey: ['advances-v2', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod) return []
      const { data, error } = await supabase.from('advance_payments').select('id,employee_id,amount,notes,is_carryover,created_at,employee:employees(employee_code,first_name,last_name,nationality)').eq('period_id', currentPeriod.id).order('is_carryover', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error; return data
    },
    enabled: !!currentPeriod,
    staleTime: 0,
  })

  // Auto-compute carryovers from previous period's payroll entries
  const { data: prevEntries = [] } = useQuery<any[]>({
    queryKey: ['prev-entries-for-carryover', prevPeriod?.id],
    queryFn: async () => {
      if (!prevPeriod) return []
      const { data, error } = await supabase.from('payroll_entries')
        .select('employee_id,amount_normal,amount_shift,amount_ot,amount_wood_excess,amount_film,amount_special,amount_diligence,amount_position,override_special,deduct_social_security,deduct_advance,deduct_safety_equipment,deduct_uniform,employee:employees(id,employee_code,first_name,last_name,nationality)')
        .eq('period_id', prevPeriod.id)
      if (error) throw error
      return data ?? []
    },
    enabled: !!prevPeriod,
  })

  // Compute per-employee deficit from previous period
  const autoCarryovers = prevEntries
    .map(e => {
      const income = Number(e.amount_normal||0) + Number(e.amount_shift||0) + Number(e.amount_ot||0)
        + Number(e.amount_wood_excess||0) + Number(e.amount_film||0)
        + Number(e.override_special ?? e.amount_special ?? 0)
        + Number(e.amount_diligence||0) + Number(e.amount_position||0)
      const deduct = Number(e.deduct_social_security||0) + Number(e.deduct_advance||0) + Number(e.deduct_safety_equipment||0) + Number(e.deduct_uniform||0)
      const net = income - deduct
      return { employee_id: e.employee_id, deficit: net < 0 ? Math.abs(net) : 0, employee: e.employee }
    })
    .filter(e => e.deficit > 0)

  const carryovers = advances.filter(a => a.is_carryover)
  const regularAdvances = advances.filter(a => !a.is_carryover)

  // Pending = auto-carryovers not yet recorded for this period
  const savedCarryoverEmpIds = new Set(carryovers.map(a => a.employee_id))
  const pendingCarryovers = autoCarryovers.filter(e => !savedCarryoverEmpIds.has(e.employee_id))

  // ── Fetch TPI job codes & employee wage profiles ──────────────────
  const { data: dbJobs = [] } = useQuery<Job[]>({
    queryKey: ['tpi-jobs-for-scan', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', user.factory_id)
        .order('code')
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && isTpi,
  })

  const jobs: Job[] = useMemo(() => {
    const dbMap = new Map(dbJobs.map((j) => [j.code.trim().toLowerCase(), j]))
    const merged: Job[] = demoJobs.map((refJob) => {
      const key = refJob.code.trim().toLowerCase()
      const dbMatch = dbMap.get(key)
      if (dbMatch) {
        dbMap.delete(key)
        return dbMatch
      }
      return refJob
    })
    for (const customDbJob of dbMap.values()) {
      merged.push(customDbJob)
    }
    return merged
  }, [dbJobs])

  const { data: wageProfiles = [] } = useQuery<WageProfile[]>({
    queryKey: ['tpi-profiles-for-scan', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('*')
        .eq('factory_id', user.factory_id)
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && isTpi,
  })

  // ── Unified First Shift Lookup for Deductions ────────────────────
  const lookupFirstShiftForDeduction = async (
    target: 'scan' | 'disc',
    empId: string,
    workDate: string
  ) => {
    if (!empId || !workDate) {
      if (target === 'scan') setScanLookupResult(null)
      else setDiscLookupResult(null)
      return
    }

    if (target === 'scan') setScanLookupLoading(true)
    else setDiscLookupLoading(true)

    try {
      const { data: shiftData, error: shiftError } = await supabase
        .from('tpi_shift_entries')
        .select('id,shift_index,job_id,job_code_snapshot,rate_tier,rate_snapshot')
        .eq('employee_id', empId)
        .eq('work_date', workDate)
        .order('shift_index', { ascending: true })
        .limit(1)

      if (!shiftError && shiftData && shiftData.length > 0) {
        const firstShift = shiftData[0]
        const matchedJob = jobs.find(
          (j) =>
            (firstShift.job_id && j.id === firstShift.job_id) ||
            (firstShift.job_code_snapshot &&
              j.code.trim().toLowerCase() === firstShift.job_code_snapshot.trim().toLowerCase())
        )
        const isClerk = matchedJob?.job_group === 'clerk' || (matchedJob?.code && ['692021', '692032', '692041', '692050'].includes(matchedJob.code.trim()))
        const baseRate =
          Number(firstShift.rate_snapshot) ||
          (firstShift.rate_tier === 'skilled'
            ? (matchedJob?.skilled_rate ?? (isClerk ? 377 : (matchedJob?.normal_rate || 357)))
            : (matchedJob?.normal_rate || 357))
        const shiftNames = ['กะที่ 1 (กะเช้า)', 'กะที่ 2 (กะบ่าย)', 'กะที่ 3 (กะดึก)']
        const sName = shiftNames[firstShift.shift_index] || `กะที่ ${firstShift.shift_index + 1}`

        const res = {
          source: 'shift' as const,
          job_code: firstShift.job_code_snapshot || matchedJob?.code || '',
          job_desc: matchedJob?.description || '',
          rate_tier: (firstShift.rate_tier as 'normal' | 'skilled') || 'normal',
          base_rate: baseRate,
          shift_name: sName,
        }

        if (target === 'scan') {
          setScanLookupResult(res)
          setIsScanManualOverride(false)
          setScanForm((prev) => ({
            ...prev,
            employee_id: empId,
            work_date: workDate,
            job_id: matchedJob?.id || firstShift.job_id || '',
            rate_tier: res.rate_tier,
            base_rate: baseRate,
            amount: (baseRate / 2).toFixed(2),
          }))
        } else {
          setDiscLookupResult(res)
          setIsDiscManualOverride(false)
          setDiscForm((prev) => ({
            ...prev,
            employee_id: empId,
            work_date: workDate,
            job_id: matchedJob?.id || firstShift.job_id || '',
            rate_tier: res.rate_tier,
            base_rate: baseRate,
            amount: (baseRate * 2).toFixed(2),
          }))
        }
      } else {
        // NOT FOUND in database:
        // Strictly prevent creating or defaulting to fake job codes!
        // Inform user to select job code manually.
        const res = {
          source: 'not_found' as const,
          job_code: '',
          job_desc: '',
          rate_tier: 'normal' as const,
          base_rate: 357,
          shift_name: '',
        }
        if (target === 'scan') {
          setScanLookupResult(res)
          setIsScanManualOverride(true)
          setScanForm((prev) => ({
            ...prev,
            employee_id: empId,
            work_date: workDate,
            job_id: '',
            rate_tier: 'normal',
            base_rate: 357,
            amount: (357 / 2).toFixed(2),
          }))
        } else {
          setDiscLookupResult(res)
          setIsDiscManualOverride(true)
          setDiscForm((prev) => ({
            ...prev,
            employee_id: empId,
            work_date: workDate,
            job_id: '',
            rate_tier: 'normal',
            base_rate: 357,
            amount: (357 * 2).toFixed(2),
          }))
        }
      }
    } catch (err) {
      console.error('Error looking up first shift:', err)
      const res = {
        source: 'not_found' as const,
        job_code: '',
        job_desc: '',
        rate_tier: 'normal' as const,
        base_rate: 357,
        shift_name: '',
      }
      if (target === 'scan') {
        setScanLookupResult(res)
        setIsScanManualOverride(true)
      } else {
        setDiscLookupResult(res)
        setIsDiscManualOverride(true)
      }
    } finally {
      if (target === 'scan') setScanLookupLoading(false)
      else setDiscLookupLoading(false)
    }
  }

  // ── Scan modal handlers ──
  const openScanModal = () => {
    const today = localDate()
    setScanForm({
      employee_id: '',
      work_date: today,
      job_id: '',
      rate_tier: 'normal',
      base_rate: 357,
      amount: '178.50',
      custom_notes: '',
    })
    setScanLookupResult(null)
    setIsScanManualOverride(false)
    setScanEmpSearch('')
    setIsScanModalOpen(true)
  }

  const closeScanModal = () => {
    setIsScanModalOpen(false)
    setScanLookupResult(null)
    setIsScanManualOverride(false)
    setScanEmpSearch('')
  }

  const handleSelectScanEmployee = (empId: string) => {
    setScanForm((prev) => ({ ...prev, employee_id: empId }))
    lookupFirstShiftForDeduction('scan', empId, scanForm.work_date)
  }

  const handleScanDateChange = (newDate: string) => {
    setScanForm((prev) => ({ ...prev, work_date: newDate }))
    if (scanForm.employee_id) {
      lookupFirstShiftForDeduction('scan', scanForm.employee_id, newDate)
    }
  }

  const handleScanJobChange = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    let base = job.normal_rate || 357
    if (scanForm.rate_tier === 'skilled') {
      const isClerk = job.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(job.code.trim())
      base = job.skilled_rate ?? (isClerk ? 377 : (job.normal_rate || 357))
    } else if (scanForm.rate_tier === 'custom') {
      base = scanForm.base_rate
    }
    setScanForm((prev) => ({
      ...prev,
      job_id: jobId,
      base_rate: base,
      amount: (base / 2).toFixed(2),
    }))
  }

  const handleScanTierChange = (tier: 'normal' | 'skilled' | 'custom') => {
    const job = jobs.find((j) => j.id === scanForm.job_id)
    let base = scanForm.base_rate
    if (tier === 'normal') {
      base = job?.normal_rate || 357
    } else if (tier === 'skilled') {
      const isClerk = job?.job_group === 'clerk' || (job?.code && ['692021', '692032', '692041', '692050'].includes(job.code.trim()))
      base = job?.skilled_rate ?? (isClerk ? 377 : (job?.normal_rate || 357))
    }
    setScanForm((prev) => ({
      ...prev,
      rate_tier: tier,
      base_rate: base,
      amount: (base / 2).toFixed(2),
    }))
  }

  const handleScanBaseRateChange = (newBase: number) => {
    setScanForm((prev) => ({
      ...prev,
      base_rate: newBase,
      amount: (newBase / 2).toFixed(2),
    }))
  }

  const saveScanMutation = useMutation({
    mutationFn: async () => {
      if (!scanForm.employee_id) throw new Error('กรุณาเลือกพนักงาน')
      if (!scanForm.job_id) throw new Error('กรุณาเลือกรหัสงาน')
      if (!scanForm.amount || parseFloat(scanForm.amount) <= 0) throw new Error('กรุณาระบุจำนวนเงินที่ถูกต้อง')
      const job = jobs.find((j) => j.id === scanForm.job_id)
      const jobCode = job?.code || scanLookupResult?.job_code || ''
      const jobDesc = job?.description ? ` — ${job.description}` : (scanLookupResult?.job_desc ? ` — ${scanLookupResult.job_desc}` : '')
      const tierLabel = scanForm.rate_tier === 'skilled' ? 'ค่าแรงฝีมือ' : scanForm.rate_tier === 'custom' ? 'กำหนดเอง' : 'ปกติ'
      const shiftInfo = scanLookupResult?.source === 'shift' && scanLookupResult.shift_name ? ` (${scanLookupResult.shift_name})` : ''
      const formattedWorkDate = formatThaiDateDDMMYYYY(scanForm.work_date)
      const noteStr = `[สแกนหน้าไม่สำเร็จ] วันที่: ${formattedWorkDate} | กะแรก: ${jobCode}${jobDesc}${shiftInfo} (${tierLabel} ฿${scanForm.base_rate}) (หัก 50% = ฿${scanForm.amount})${scanForm.custom_notes ? ` | ${scanForm.custom_notes}` : ''}`

      const { error } = await supabase.from('advance_payments').insert({
        period_id: currentPeriod.id,
        employee_id: scanForm.employee_id,
        amount: parseFloat(scanForm.amount),
        notes: noteStr,
        is_carryover: false,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['advances-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] }),
      ])
      await refetchAdvances()
      toast.success('บันทึกรายการหักเงินสแกนหน้าไม่สำเร็จแล้ว')
      closeScanModal()
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  // ── Disciplinary deduction (ขาดงานไม่มีคนแทน) handlers & mutation ──
  const openDiscModal = () => {
    const today = localDate()
    setDiscForm({
      employee_id: '',
      work_date: today,
      job_id: '',
      rate_tier: 'normal',
      base_rate: 357,
      amount: '714.00',
      custom_notes: '',
    })
    setDiscLookupResult(null)
    setIsDiscManualOverride(false)
    setDiscEmpSearch('')
    setIsDiscModalOpen(true)
  }

  const closeDiscModal = () => {
    setIsDiscModalOpen(false)
    setDiscLookupResult(null)
    setIsDiscManualOverride(false)
    setDiscEmpSearch('')
  }

  const handleSelectDiscEmployee = (empId: string) => {
    setDiscForm((prev) => ({ ...prev, employee_id: empId }))
    lookupFirstShiftForDeduction('disc', empId, discForm.work_date)
  }

  const handleDiscDateChange = (newDate: string) => {
    setDiscForm((prev) => ({ ...prev, work_date: newDate }))
    if (discForm.employee_id) {
      lookupFirstShiftForDeduction('disc', discForm.employee_id, newDate)
    }
  }

  const handleDiscJobChange = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    let base = job.normal_rate || 357
    if (discForm.rate_tier === 'skilled') {
      const isClerk = job.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(job.code.trim())
      base = job.skilled_rate ?? (isClerk ? 377 : (job.normal_rate || 357))
    } else if (discForm.rate_tier === 'custom') {
      base = discForm.base_rate
    }
    setDiscForm((prev) => ({
      ...prev,
      job_id: jobId,
      base_rate: base,
      amount: (base * 2).toFixed(2),
    }))
  }

  const handleDiscTierChange = (tier: 'normal' | 'skilled' | 'custom') => {
    const job = jobs.find((j) => j.id === discForm.job_id)
    let base = discForm.base_rate
    if (tier === 'normal') {
      base = job?.normal_rate || 357
    } else if (tier === 'skilled') {
      const isClerk = job?.job_group === 'clerk' || (job?.code && ['692021', '692032', '692041', '692050'].includes(job.code.trim()))
      base = job?.skilled_rate ?? (isClerk ? 377 : (job?.normal_rate || 357))
    }
    setDiscForm((prev) => ({
      ...prev,
      rate_tier: tier,
      base_rate: base,
      amount: (base * 2).toFixed(2),
    }))
  }

  const handleDiscBaseRateChange = (newBase: number) => {
    setDiscForm((prev) => ({
      ...prev,
      base_rate: newBase,
      amount: (newBase * 2).toFixed(2),
    }))
  }

  const saveDiscMutation = useMutation({
    mutationFn: async () => {
      if (!discForm.employee_id) throw new Error('กรุณาเลือกพนักงาน')
      if (!discForm.job_id) throw new Error('กรุณาเลือกรหัสงาน')
      if (!discForm.amount || parseFloat(discForm.amount) <= 0) throw new Error('กรุณาระบุจำนวนเงินที่ถูกต้อง')
      const job = jobs.find((j) => j.id === discForm.job_id)
      const jobCode = job?.code || discLookupResult?.job_code || ''
      const jobDesc = job?.description ? ` — ${job.description}` : (discLookupResult?.job_desc ? ` — ${discLookupResult.job_desc}` : '')
      const tierLabel = discForm.rate_tier === 'skilled' ? 'ค่าแรงฝีมือ' : discForm.rate_tier === 'custom' ? 'กำหนดเอง' : 'ปกติ'
      const shiftInfo = discLookupResult?.source === 'shift' && discLookupResult.shift_name ? ` (${discLookupResult.shift_name})` : ''
      const formattedWorkDate = formatThaiDateDDMMYYYY(discForm.work_date)
      const noteStr = `[ลงโทษ ขาดงานไม่มีคนแทน] วันที่: ${formattedWorkDate} | กะแรก: ${jobCode}${jobDesc}${shiftInfo} (${tierLabel} ฿${discForm.base_rate}) (หัก 2 เท่า = ฿${discForm.amount})${discForm.custom_notes ? ` | ${discForm.custom_notes}` : ''}`

      const { error } = await supabase.from('advance_payments').insert({
        period_id: currentPeriod.id,
        employee_id: discForm.employee_id,
        amount: parseFloat(discForm.amount),
        notes: noteStr,
        is_carryover: false,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['advances-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] }),
      ])
      await refetchAdvances()
      toast.success('บันทึกรายการหักเงินลงโทษ ขาดงาน (ไม่มีคนแทน) แล้ว')
      closeDiscModal()
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const totalCarryover = carryovers.reduce((s, a) => s + Number(a.amount), 0)
  const totalRegular = regularAdvances.reduce((s, a) => s + Number(a.amount), 0)
  const totalAdv = totalCarryover + totalRegular

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!isEdit && !form.employee_id) throw new Error('กรุณาเลือกพนักงาน')
      if (!form.amount) throw new Error('กรุณากรอกจำนวนเงิน')
      if (isEdit) {
        const { error } = await supabase.from('advance_payments')
          .update({ amount: parseFloat(form.amount), notes: form.notes || null })
          .eq('id', editingId!)
        if (error) throw error
      } else {
        const { error } = await supabase.from('advance_payments').insert({
          period_id: currentPeriod.id, employee_id: form.employee_id,
          amount: parseFloat(form.amount), notes: form.notes || null,
          is_carryover: modalMode === 'carryover',
        })
        if (error) throw error
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['advances-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] }),
      ])
      await refetchAdvances()
      toast.success(isEdit ? 'อัปเดตรายการแล้ว' : 'บันทึกการเบิกล่วงหน้าแล้ว')
      closeModal()
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const bulkCarryoverMutation = useMutation({
    mutationFn: async () => {
      if (!currentPeriod || pendingCarryovers.length === 0) return
      const rows = pendingCarryovers.map(e => ({
        period_id: currentPeriod.id,
        employee_id: e.employee_id,
        amount: e.deficit,
        notes: 'ยอดเบิกเกินค้างจากงวดก่อน',
        is_carryover: true,
      }))
      const { error } = await supabase.from('advance_payments').insert(rows)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['advances-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] }),
      ])
      await refetchAdvances()
      toast.success(`บันทึกยอดตกค้าง ${pendingCarryovers.length} รายการแล้ว`)
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('advance_payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['advances-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-channel-stats'] }),
      ])
      await refetchAdvances()
      toast.success('ลบรายการแล้ว')
    },
  })

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TopBar title="เบิกล่วงหน้า" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      {/* ── Sticky header (never scrolls) ─────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '24px 36px 0', maxWidth: 1136, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>ADVANCES · เบิกล่วงหน้า</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              รวม <span style={{ fontFamily: 'var(--vk-mono)', color: 'var(--vk-crimson)' }}>฿ {totalAdv.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            {totalCarryover > 0 && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#92400e' }}>
                <AlertTriangle style={{ width: 12, height: 12 }} />
                <span>มียอดตกค้างจากงวดก่อน <strong>฿ {totalCarryover.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingCarryovers.length > 0 && (
              <button className="vk-btn vk-btn--ghost" onClick={() => bulkCarryoverMutation.mutate()} disabled={bulkCarryoverMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, borderColor: '#d97706', color: '#92400e' }}>
                <AlertTriangle style={{ width: 13, height: 13 }} />
                {bulkCarryoverMutation.isPending ? 'กำลังบันทึก...' : `บันทึกยอดค้าง ${pendingCarryovers.length} รายการ`}
              </button>
            )}
            <button className="vk-btn vk-btn--ghost" onClick={() => openCreate('carryover')} disabled={!currentPeriod}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, borderColor: '#d97706', color: '#92400e' }}>
              <AlertTriangle style={{ width: 13, height: 13 }} /> บันทึกยอดค้างจากงวดก่อน
            </button>
            {isTpi && (
              <>
                <button
                  className="vk-btn vk-btn--ghost"
                  onClick={openScanModal}
                  disabled={!currentPeriod}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    borderColor: '#ef4444',
                    color: '#b91c1c',
                    background: '#fef2f2',
                  }}
                >
                  <Camera style={{ width: 13, height: 13 }} /> หักเงินสแกนหน้าไม่สำเร็จ
                </button>
                <button
                  className="vk-btn vk-btn--ghost"
                  onClick={openDiscModal}
                  disabled={!currentPeriod}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    borderColor: '#ea580c',
                    color: '#c2410c',
                    background: '#fff7ed',
                  }}
                >
                  <UserX style={{ width: 13, height: 13 }} /> หักลงโทษ ขาดงาน (ไม่มีคนแทน)
                </button>
              </>
            )}
            <button className="vk-btn vk-btn--primary" onClick={() => openCreate('advance')} disabled={!currentPeriod}>
              <Plus style={{ width: 15, height: 15 }} /> เพิ่มรายการเบิก
            </button>
          </div>
        </div>
        <hr className="vk-rule" style={{ margin: 0 }} />
      </div>

      {/* ── Scrollable table area ──────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1136, width: '100%', margin: '0 auto', padding: '0 36px 48px', boxSizing: 'border-box' }}>

        {/* ── ตารางรวม (columns align ทุกแถว) ─────────────────────── */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 110 }} />
            <col style={{ width: 300 }} />
            <col />
            <col style={{ width: 170 }} />
            <col style={{ width: 74 }} />
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <tr>
              {['รหัส','ชื่อ–นามสกุล','หมายเหตุ','จำนวนเงิน',''].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)', padding: '10px 14px', borderBottom: '2px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>

            {/* ── section: ยอดตกค้างอัตโนมัติ (ยังไม่บันทึก) ── */}
            {pendingCarryovers.length > 0 && (
              <>
                <tr>
                  <td colSpan={5} style={{ padding: '8px 14px', background: '#fef9ec', borderBottom: '1px solid #fde68a', borderLeft: '3px dashed #d97706' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#92400e' }}>
                        <AlertTriangle style={{ width: 12, height: 12 }} />
                        ยอดตกค้างจากงวดก่อน (อัตโนมัติ) — {pendingCarryovers.length} รายการ · ยังไม่บันทึก
                      </span>
                      <button className="vk-btn vk-btn--ghost" onClick={() => bulkCarryoverMutation.mutate()} disabled={bulkCarryoverMutation.isPending}
                        style={{ fontSize: 11, padding: '3px 10px', borderColor: '#d97706', color: '#92400e', height: 26 }}>
                        {bulkCarryoverMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกทั้งหมด'}
                      </button>
                    </div>
                  </td>
                </tr>
                {pendingCarryovers.map(e => {
                  const emp = e.employee as any
                  return (
                    <tr key={e.employee_id} style={{ borderBottom: '1px solid #fde68a', background: '#fef9ec', borderLeft: '3px dashed #d97706', opacity: 0.85 }}>
                      <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12, color: '#92400e' }}>{emp?.employee_code}</td>
                      <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14, color: '#78350f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, color: '#92400e', fontStyle: 'italic', wordBreak: 'break-word' }}>ยอดเบิกเกินค้างจากงวดก่อน</td>
                      <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: '#b45309', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        – {e.deficit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                        <span style={{ fontSize: 11, color: '#b45309', fontStyle: 'italic' }}>รอบันทึก</span>
                      </td>
                    </tr>
                  )
                })}
                <tr><td colSpan={5} style={{ padding: 0, height: 16, background: 'var(--vk-paper)' }} /></tr>
              </>
            )}

            {/* ── section: ยอดตกค้าง ── */}
            {carryovers.length > 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '8px 14px', background: '#fef3c7', borderBottom: '1px solid #fde68a', borderLeft: '3px solid #d97706' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#92400e' }}>
                    <AlertTriangle style={{ width: 12, height: 12 }} />
                    ยอดตกค้างจากงวดก่อน — {carryovers.length} รายการ · ฿ {totalCarryover.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </td>
              </tr>
            )}
            {carryovers.map(a => {
              const emp = a.employee as any
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #fde68a', background: '#fffbeb', cursor: 'pointer', borderLeft: '3px solid #d97706' }}
                  onClick={() => openEdit(a)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fef3c7')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fffbeb')}>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12, color: '#92400e' }}>{emp?.employee_code}</td>
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14, color: '#78350f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: '#92400e', wordBreak: 'break-word' }}>{renderNotes(a.notes)}</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: '#b45309', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    – {Number(a.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={e => { e.stopPropagation(); openEdit(a) }}>
                        <Pencil style={{ width: 13, height: 13, color: '#92400e' }} />
                      </button>
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={e => { e.stopPropagation(); setDeleteTarget({ id: a.id, name: `${a.employee?.first_name ?? ''} ${a.employee?.last_name ?? ''}`.trim() }) }}>
                        <Trash2 style={{ width: 13, height: 13, color: '#b45309' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {/* ── section divider ── */}
            {carryovers.length > 0 && (
              <>
                <tr><td colSpan={5} style={{ padding: 0, height: 56, background: 'var(--vk-paper)' }} /></tr>
                <tr>
                  <td colSpan={5} style={{ padding: '9px 14px', background: 'var(--vk-paper)', borderTop: '2px solid var(--vk-rule)', borderBottom: '1px solid var(--vk-rule)' }}>
                    <span style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vk-ink-3)' }}>
                      เบิกล่วงหน้างวดนี้ — {regularAdvances.length} รายการ · ฿ {totalRegular.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </td>
                </tr>
              </>
            )}

            {/* ── section: เบิกปกติ ── */}
            {regularAdvances.map(a => {
              const emp = a.employee as any
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)', cursor: 'pointer' }}
                  onClick={() => openEdit(a)}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--vk-persimmon-tint)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{emp?.employee_code}</td>
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)', wordBreak: 'break-word' }}>{renderNotes(a.notes)}</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-crimson)', whiteSpace: 'nowrap' }}>
                    – {Number(a.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={e => { e.stopPropagation(); openEdit(a) }}>
                        <Pencil style={{ width: 13, height: 13, color: 'var(--vk-ink-3)' }} />
                      </button>
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={e => { e.stopPropagation(); setDeleteTarget({ id: a.id, name: `${a.employee?.first_name ?? ''} ${a.employee?.last_name ?? ''}`.trim() }) }}>
                        <Trash2 style={{ width: 13, height: 13, color: 'var(--vk-crimson)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {advances.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '48px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีรายการเบิกล่วงหน้า</td></tr>
            )}
            {advances.length > 0 && regularAdvances.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'var(--vk-ink-3)' }}>ยังไม่มีการเบิกล่วงหน้างวดนี้</td></tr>
            )}
          </tbody>
        </table>
      </div>{/* end inner wrapper */}
      </div>{/* end scroll area */}

      {/* Modal */}
      {isModalOpen && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeModal}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 400, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ background: modalMode === 'carryover' ? '#d97706' : 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {modalMode === 'carryover' && <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0 }} />}
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {isEdit
                    ? (modalMode === 'carryover' ? 'แก้ไขยอดตกค้างจากงวดก่อน' : 'แก้ไขรายการเบิกล่วงหน้า')
                    : (modalMode === 'carryover' ? 'บันทึกยอดตกค้างจากงวดก่อน' : 'เพิ่มรายการเบิกล่วงหน้า')
                  }
                </div>
              </div>
              <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
                {modalMode === 'carryover'
                  ? 'ยอดนี้จะถูกนำไปหักในงวดปัจจุบัน รวมกับยอดเบิกล่วงหน้าปกติ'
                  : (isEdit ? 'แก้ไขจำนวนเงินหรือหมายเหตุ' : 'กรอกข้อมูลพนักงานและจำนวนเงิน')
                }
              </div>
            </div>
            <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--vk-bone)' }}>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>พนักงาน</label>
                {isEdit ? (
                  <div style={{ padding: '8px 12px', border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)' }}>{editingEmp?.employee_code}</span>
                    <span style={{ fontWeight: 600, color: 'var(--vk-ink)' }}>{editingEmp?.first_name} {editingEmp?.last_name}{fmtNationality(editingEmp?.nationality ?? null) ? ` (${fmtNationality(editingEmp?.nationality ?? null)})` : ''}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Search box */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <Search style={{ position: 'absolute', left: 9, width: 13, height: 13, color: 'var(--vk-ink-3)', pointerEvents: 'none' }} />
                      <input
                        className="vk-input"
                        placeholder="พิมพ์ชื่อหรือรหัสเพื่อค้นหา..."
                        value={empSearch}
                        onChange={e => setEmpSearch(e.target.value)}
                        style={{ paddingLeft: 30, paddingRight: empSearch ? 28 : 10 }}
                        autoFocus
                      />
                      {empSearch && (
                        <button onClick={() => setEmpSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--vk-ink-3)' }}>
                          <X style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>
                    {/* Employee list */}
                    <div style={{ border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', maxHeight: 200, overflowY: 'auto' }}>
                      {employees
                        .filter(e => {
                          const q = empSearch.toLowerCase()
                          return !q || e.employee_code.toLowerCase().includes(q) || e.first_name.toLowerCase().includes(q) || (e.last_name || '').toLowerCase().includes(q)
                        })
                        .map(e => {
                          const selected = form.employee_id === e.id
                          return (
                            <div key={e.id}
                              onClick={() => setForm(f => ({ ...f, employee_id: e.id }))}
                              style={{
                                padding: '9px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                                background: selected ? 'var(--vk-persimmon-tint)' : 'transparent',
                                borderBottom: '1px solid var(--vk-rule-soft)',
                              }}
                              onMouseEnter={el => { if (!selected) el.currentTarget.style.background = 'var(--vk-bone)' }}
                              onMouseLeave={el => { if (!selected) el.currentTarget.style.background = 'transparent' }}>
                              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: selected ? 'var(--vk-persimmon)' : 'var(--vk-ink-3)', flexShrink: 0 }}>{e.employee_code}</span>
                              <span style={{ fontSize: 13, fontWeight: selected ? 700 : 400, color: selected ? 'var(--vk-persimmon)' : 'var(--vk-ink)', flex: 1 }}>
                                {e.first_name} {e.last_name}{fmtNationality(e.nationality) ? ` (${fmtNationality(e.nationality)})` : ''}
                              </span>
                              {selected && <span style={{ fontSize: 11, color: 'var(--vk-persimmon)' }}>✓</span>}
                            </div>
                          )
                        })}
                      {employees.filter(e => {
                        const q = empSearch.toLowerCase()
                        return !q || e.employee_code.toLowerCase().includes(q) || e.first_name.toLowerCase().includes(q) || (e.last_name || '').toLowerCase().includes(q)
                      }).length === 0 && (
                        <div style={{ padding: '16px', textAlign: 'center', fontSize: 13, color: 'var(--vk-ink-3)' }}>ไม่พบพนักงานที่ค้นหา</div>
                      )}
                    </div>
                    {/* Selected display */}
                    {form.employee_id && (() => {
                      const sel = employees.find(e => e.id === form.employee_id)
                      return sel ? (
                        <div style={{ fontSize: 12, color: 'var(--vk-persimmon)', fontWeight: 600 }}>
                          เลือก: {sel.employee_code} · {sel.first_name} {sel.last_name}
                        </div>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>จำนวนเงิน (บาท)</label>
                <input className="vk-input vk-input--mono" type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>หมายเหตุ</label>
                <input className="vk-input" placeholder="เช่น ค่ารักษาพยาบาล" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }} disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? 'กำลังบันทึก...' : isEdit ? 'อัปเดตรายการ' : 'บันทึก'}
              </button>
              <button className="vk-btn" onClick={closeModal}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal หักเงินสแกนหน้าไม่สำเร็จ (TPI) ─────────────────────── */}
      {isTpi && isScanModalOpen && (
        <div
          className="vk-root"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(22,19,17,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={closeScanModal}
        >
          <div
            style={{
              background: 'var(--vk-paper)',
              border: '1px solid var(--vk-rule)',
              width: '100%',
              maxWidth: 480,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 6,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ background: '#b91c1c', color: '#fff', padding: '16px 20px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Camera style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    บันทึกหักเงินสแกนหน้าไม่สำเร็จ
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeScanModal}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.8,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                >
                  <X style={{ width: 18, height: 18 }} />
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                ระบบจะคำนวณหักเงิน 50% ของค่าแรงในวันนั้น และนำไปหักในงวดปัจจุบัน ({currentPeriod?.label})
              </div>
            </div>

            {/* Modal Body */}
            <div
              style={{
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                background: 'var(--vk-bone)',
                overflowY: 'auto',
                flex: 1,
              }}
            >
              {/* 1. Employee selection */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  1. เลือกพนักงานที่ถูกหักเงิน <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search
                      style={{
                        position: 'absolute',
                        left: 9,
                        width: 13,
                        height: 13,
                        color: 'var(--vk-ink-3)',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      className="vk-input"
                      placeholder="พิมพ์ชื่อหรือรหัสพนักงานเพื่อค้นหา..."
                      value={scanEmpSearch}
                      onChange={(e) => setScanEmpSearch(e.target.value)}
                      style={{ paddingLeft: 30, paddingRight: scanEmpSearch ? 28 : 10 }}
                    />
                    {scanEmpSearch && (
                      <button
                        onClick={() => setScanEmpSearch('')}
                        style={{
                          position: 'absolute',
                          right: 6,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          color: 'var(--vk-ink-3)',
                        }}
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <div
                    style={{
                      border: '1px solid var(--vk-rule)',
                      background: 'var(--vk-paper)',
                      maxHeight: 140,
                      overflowY: 'auto',
                    }}
                  >
                    {employees
                      .filter((e) => {
                        const q = scanEmpSearch.toLowerCase()
                        return (
                          !q ||
                          e.employee_code.toLowerCase().includes(q) ||
                          e.first_name.toLowerCase().includes(q) ||
                          (e.last_name || '').toLowerCase().includes(q)
                        )
                      })
                      .map((e) => {
                        const selected = scanForm.employee_id === e.id
                        const prof = wageProfiles.find((p) => p.employee_id === e.id)
                        const isSkilled = prof?.rate_tier === 'skilled'
                        return (
                          <div
                            key={e.id}
                            onClick={() => handleSelectScanEmployee(e.id)}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              background: selected ? '#fee2e2' : 'transparent',
                              borderBottom: '1px solid var(--vk-rule-soft)',
                            }}
                            onMouseEnter={(el) => {
                              if (!selected) el.currentTarget.style.background = 'var(--vk-bone)'
                            }}
                            onMouseLeave={(el) => {
                              if (!selected) el.currentTarget.style.background = 'transparent'
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--vk-mono)',
                                fontSize: 11,
                                color: selected ? '#b91c1c' : 'var(--vk-ink-3)',
                                flexShrink: 0,
                              }}
                            >
                              {e.employee_code}
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: selected ? 700 : 400,
                                color: selected ? '#b91c1c' : 'var(--vk-ink)',
                                flex: 1,
                              }}
                            >
                              {e.first_name} {e.last_name}
                              {fmtNationality(e.nationality) ? ` (${fmtNationality(e.nationality)})` : ''}
                            </span>
                            {isSkilled && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: '#0369a1',
                                  background: '#e0f2fe',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                }}
                              >
                                ค่าแรงฝีมือ
                              </span>
                            )}
                            {selected && <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700 }}>✓</span>}
                          </div>
                        )
                      })}
                  </div>

                  {scanForm.employee_id && (() => {
                    const sel = employees.find((e) => e.id === scanForm.employee_id)
                    return sel ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#b91c1c',
                          fontWeight: 600,
                          background: '#fff',
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: '1px solid #fca5a5',
                        }}
                      >
                        ✓ พนักงานที่เลือก: {sel.employee_code} — {sel.first_name} {sel.last_name}
                      </div>
                    ) : null
                  })()}
                </div>
              </div>

              {/* 2. Date of incident */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  2. วันที่เกิดเหตุตามรายงานจาก HR <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <ThaiDatePicker
                  value={scanForm.work_date}
                  onChange={(val) => handleScanDateChange(val || localDate())}
                  placeholder="วว/ดด/ปปปป (พ.ศ.)"
                  required
                />
                <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                  ระบุวันที่เกิดเหตุในอดีต (รายงานจาก HR ย้อนหลังอย่างน้อย 1 เดือน) ระบบจะดึงข้อมูลกะแรกของวันนั้นให้อัตโนมัติ
                </div>
              </div>

              {/* 3. Shift Lookup Result & Job Selection */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="vk-eyebrow">
                    3. ข้อมูลกะแรกในวันนั้น (ระบบดึงอัตโนมัติ)
                  </label>
                  {scanLookupResult?.source === 'shift' && (
                    <button
                      type="button"
                      onClick={() => setIsScanManualOverride(!isScanManualOverride)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#b91c1c',
                        fontSize: 11,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {isScanManualOverride ? 'ซ่อนการเปลี่ยนรหัสงาน' : 'เปลี่ยนรหัสงาน'}
                    </button>
                  )}
                </div>

                {!scanForm.employee_id ? (
                  <div
                    style={{
                      background: 'var(--vk-paper)',
                      border: '1px dashed var(--vk-rule)',
                      padding: '16px',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 12,
                      color: 'var(--vk-ink-3)',
                    }}
                  >
                    กรุณาเลือกพนักงานเพื่อดึงข้อมูลกะแรกในวันที่ระบุ
                  </div>
                ) : scanLookupLoading ? (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fca5a5',
                      padding: '16px',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 12,
                      color: '#b91c1c',
                      fontWeight: 600,
                    }}
                  >
                    กำลังดึงข้อมูลกะแรกของวันที่ {formatThaiDateDDMMYYYY(scanForm.work_date)}...
                  </div>
                ) : scanLookupResult?.source === 'shift' ? (
                  <div
                    style={{
                      background: '#fff',
                      border: '1px solid #fca5a5',
                      borderRadius: 6,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            background: '#dcfce7',
                            color: '#166534',
                            border: '1px solid #86efac',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          ✓ พบตารางกะในระบบ
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#991b1b' }}>
                          {scanLookupResult.shift_name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                        {scanForm.rate_tier === 'skilled' ? 'ระดับค่าแรงฝีมือ' : 'ระดับค่าแรงปกติ'}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--vk-ink)', fontWeight: 600 }}>
                      หน้าที่ / รหัสงาน: <span style={{ color: '#b91c1c', fontFamily: 'var(--vk-mono)' }}>{scanLookupResult.job_code}</span> {scanLookupResult.job_desc ? `— ${scanLookupResult.job_desc}` : ''}
                    </div>

                    {isScanManualOverride && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '10px',
                          background: 'var(--vk-bone)',
                          borderRadius: 4,
                          border: '1px solid var(--vk-rule-soft)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <label className="vk-eyebrow" style={{ display: 'block', fontSize: 10 }}>
                          เลือกรหัสงานอื่น
                        </label>
                        <select
                          className="vk-input"
                          style={{ fontSize: 12, padding: '4px 8px' }}
                          value={scanForm.job_id}
                          onChange={(e) => handleScanJobChange(e.target.value)}
                        >
                          {jobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.code} {j.description ? `— ${j.description}` : ''} (ปกติ ฿{j.normal_rate}{j.skilled_rate ? `/ฝีมือ ฿${j.skilled_rate}` : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#fff7ed',
                      border: '1px solid #fdba74',
                      borderRadius: 6,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c2410c', fontWeight: 700, fontSize: 12 }}>
                      <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
                      ไม่พบข้อมูลกะของพนักงานในระบบในวันที่ระบุ
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.4 }}>
                      พนักงานอาจยังไม่ได้ลงบันทึกกะ หรือไม่ได้ลงเวลาทำงานในวันดังกล่าว กรุณาเลือกรหัสงานและกำหนดอัตราค่าแรงด้วยตนเอง (Manual)
                    </div>
                    <div>
                      <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 4, fontSize: 10 }}>
                        เลือกรหัสงานที่ต้องการ <span style={{ color: '#b91c1c' }}>*</span>
                      </label>
                      <select
                        className="vk-input"
                        value={scanForm.job_id}
                        onChange={(e) => handleScanJobChange(e.target.value)}
                        style={{ borderColor: !scanForm.job_id ? '#f97316' : undefined }}
                      >
                        <option value="" disabled>-- กรุณาเลือกรหัสงาน --</option>
                        {jobs.map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.code} {j.description ? `— ${j.description}` : ''} (ปกติ ฿{j.normal_rate}{j.skilled_rate ? `/ฝีมือ ฿${j.skilled_rate}` : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Wage Tier (Matching uploaded screenshot) */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 6 }}>
                  4. อัตราค่าแรงในวันนั้น
                </label>
                {(() => {
                  const job = jobs.find((j) => j.id === scanForm.job_id)
                  const normalRate = job?.normal_rate ?? 357
                  const isClerk = job?.job_group === 'clerk' || (job?.code && ['692021', '692032', '692041', '692050'].includes(job.code.trim()))
                  const skilledRate = job?.skilled_rate ?? (isClerk ? 377 : normalRate)
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: scanForm.rate_tier === 'normal' ? '2px solid #b91c1c' : '1px solid var(--vk-rule)',
                          background: scanForm.rate_tier === 'normal' ? '#fee2e2' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="scan_tier"
                            checked={scanForm.rate_tier === 'normal'}
                            onChange={() => handleScanTierChange('normal')}
                            style={{ accentColor: '#b91c1c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>ค่าแรงปกติ</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>
                          ฿ {normalRate}
                        </span>
                      </label>

                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: scanForm.rate_tier === 'skilled' ? '2px solid #b91c1c' : '1px solid var(--vk-rule)',
                          background: scanForm.rate_tier === 'skilled' ? '#fee2e2' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="scan_tier"
                            checked={scanForm.rate_tier === 'skilled'}
                            onChange={() => handleScanTierChange('skilled')}
                            style={{ accentColor: '#b91c1c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>ค่าแรงฝีมือ</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>
                          ฿ {skilledRate}
                        </span>
                      </label>

                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: scanForm.rate_tier === 'custom' ? '2px solid #b91c1c' : '1px solid var(--vk-rule)',
                          background: scanForm.rate_tier === 'custom' ? '#fee2e2' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="scan_tier"
                            checked={scanForm.rate_tier === 'custom'}
                            onChange={() => handleScanTierChange('custom')}
                            style={{ accentColor: '#b91c1c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>กำหนดเอง</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>ระบุยอด</span>
                      </label>
                    </div>
                  )
                })()}
              </div>

              {/* Calculation Box */}
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 6,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#991b1b', fontWeight: 700 }}>
                      อัตราค่าแรงเต็มวัน
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: '#7f1d1d' }}>฿</span>
                      <input
                        type="number"
                        className="vk-input vk-input--mono"
                        style={{ width: 110, padding: '4px 8px', height: 32, fontSize: 15, fontWeight: 700 }}
                        value={scanForm.base_rate}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          if (scanForm.rate_tier !== 'custom') {
                            handleScanTierChange('custom')
                          }
                          handleScanBaseRateChange(val)
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#991b1b', fontWeight: 700 }}>
                      ยอดหัก 50% (บันทึกในงวดนี้)
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--vk-mono)',
                        fontSize: 24,
                        fontWeight: 700,
                        color: '#b91c1c',
                        marginTop: 2,
                      }}
                    >
                      – ฿ {scanForm.amount}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#991b1b', borderTop: '1px dashed #fca5a5', paddingTop: 8 }}>
                  💡 หากสแกนหน้าไม่สำเร็จ จะถูกหัก 50% ของค่าแรงในวันนั้น ({scanForm.base_rate} ÷ 2 = ฿{scanForm.amount})
                </div>
              </div>

              {/* 5. Custom Notes */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  5. หมายเหตุเพิ่มเติม / เลขที่รายงาน HR (ระบุหรือไม่ก็ได้)
                </label>
                <input
                  className="vk-input"
                  placeholder="เช่น HR แจ้งรายงานเมื่อวันที่ 5 พ.ค., สแกนหน้าจุดผลิตไม่ผ่าน"
                  value={scanForm.custom_notes}
                  onChange={(e) => setScanForm((prev) => ({ ...prev, custom_notes: e.target.value }))}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '14px 20px',
                borderTop: '1px solid var(--vk-rule)',
                background: 'var(--vk-paper)',
                flexShrink: 0,
              }}
            >
              <button
                className="vk-btn"
                style={{
                  flex: 1,
                  background: '#b91c1c',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
                disabled={saveScanMutation.isPending || !scanForm.employee_id || !scanForm.job_id || parseFloat(scanForm.amount) <= 0 || scanLookupLoading}
                onClick={() => saveScanMutation.mutate()}
              >
                {saveScanMutation.isPending ? 'กำลังบันทึก...' : `ยืนยันบันทึกหักเงิน ฿ ${scanForm.amount}`}
              </button>
              <button className="vk-btn" onClick={closeScanModal}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal หักเงินลงโทษ ขาดงาน (ไม่มีคนแทน) ─────────────────────── */}
      {isTpi && isDiscModalOpen && (
        <div
          className="vk-root"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(22,19,17,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={closeDiscModal}
        >
          <div
            style={{
              background: 'var(--vk-paper)',
              border: '1px solid var(--vk-rule)',
              width: '100%',
              maxWidth: 480,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 6,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ background: '#c2410c', color: '#fff', padding: '16px 20px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserX style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    บันทึกหักเงินลงโทษ (ขาดงานไม่มีคนแทน)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDiscModal}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.8,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                >
                  <X style={{ width: 18, height: 18 }} />
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                ระบบดึงข้อมูลกะแรกในวันเกิดเหตุตามรายงานจาก HR และคำนวณหัก 2 เท่า เพื่อนำไปหักในงวดปัจจุบัน ({currentPeriod?.label})
              </div>
            </div>

            {/* Modal Body */}
            <div
              style={{
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                background: 'var(--vk-bone)',
                overflowY: 'auto',
                flex: 1,
              }}
            >
              {/* 1. Employee selection */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  1. เลือกพนักงานที่ขาดงาน <span style={{ color: '#c2410c' }}>*</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search
                      style={{
                        position: 'absolute',
                        left: 9,
                        width: 13,
                        height: 13,
                        color: 'var(--vk-ink-3)',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      className="vk-input"
                      placeholder="พิมพ์ชื่อหรือรหัสพนักงานเพื่อค้นหา..."
                      value={discEmpSearch}
                      onChange={(e) => setDiscEmpSearch(e.target.value)}
                      style={{ paddingLeft: 30, paddingRight: discEmpSearch ? 28 : 10 }}
                    />
                    {discEmpSearch && (
                      <button
                        onClick={() => setDiscEmpSearch('')}
                        style={{
                          position: 'absolute',
                          right: 6,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          color: 'var(--vk-ink-3)',
                        }}
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <div
                    style={{
                      border: '1px solid var(--vk-rule)',
                      background: 'var(--vk-paper)',
                      maxHeight: 130,
                      overflowY: 'auto',
                    }}
                  >
                    {employees
                      .filter((e) => {
                        const q = discEmpSearch.toLowerCase()
                        return (
                          !q ||
                          e.employee_code.toLowerCase().includes(q) ||
                          e.first_name.toLowerCase().includes(q) ||
                          (e.last_name || '').toLowerCase().includes(q)
                        )
                      })
                      .map((e) => {
                        const selected = discForm.employee_id === e.id
                        const prof = wageProfiles.find((p) => p.employee_id === e.id)
                        const isSkilled = prof?.rate_tier === 'skilled'
                        return (
                          <div
                            key={e.id}
                            onClick={() => handleSelectDiscEmployee(e.id)}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              background: selected ? '#ffedd5' : 'transparent',
                              borderBottom: '1px solid var(--vk-rule-soft)',
                            }}
                            onMouseEnter={(el) => {
                              if (!selected) el.currentTarget.style.background = 'var(--vk-bone)'
                            }}
                            onMouseLeave={(el) => {
                              if (!selected) el.currentTarget.style.background = 'transparent'
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--vk-mono)',
                                fontSize: 11,
                                color: selected ? '#c2410c' : 'var(--vk-ink-3)',
                                flexShrink: 0,
                              }}
                            >
                              {e.employee_code}
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: selected ? 700 : 400,
                                color: selected ? '#c2410c' : 'var(--vk-ink)',
                                flex: 1,
                              }}
                            >
                              {e.first_name} {e.last_name}
                              {fmtNationality(e.nationality) ? ` (${fmtNationality(e.nationality)})` : ''}
                            </span>
                            {isSkilled && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: '#0369a1',
                                  background: '#e0f2fe',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                }}
                              >
                                ค่าแรงฝีมือ
                              </span>
                            )}
                            {selected && <span style={{ fontSize: 12, color: '#c2410c', fontWeight: 700 }}>✓</span>}
                          </div>
                        )
                      })}
                  </div>

                  {discForm.employee_id && (() => {
                    const sel = employees.find((e) => e.id === discForm.employee_id)
                    return sel ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#c2410c',
                          fontWeight: 600,
                          background: '#fff',
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: '1px solid #fdba74',
                        }}
                      >
                        ✓ พนักงานที่เลือก: {sel.employee_code} — {sel.first_name} {sel.last_name}
                      </div>
                    ) : null
                  })()}
                </div>
              </div>

              {/* 2. Date of incident */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  2. วันที่เกิดเหตุตามรายงานจาก HR <span style={{ color: '#c2410c' }}>*</span>
                </label>
                <ThaiDatePicker
                  value={discForm.work_date}
                  onChange={(val) => handleDiscDateChange(val || localDate())}
                  placeholder="วว/ดด/ปปปป (พ.ศ.)"
                  required
                />
                <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 4 }}>
                  ระบุวันที่เกิดเหตุในอดีต ระบบจะดึงข้อมูลกะแรกของวันนั้นให้อัตโนมัติ
                </div>
              </div>

              {/* 3. Shift Lookup Result & Job Selection */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="vk-eyebrow">
                    3. ข้อมูลกะแรกในวันนั้น (ระบบดึงอัตโนมัติ)
                  </label>
                  {discLookupResult?.source === 'shift' && (
                    <button
                      type="button"
                      onClick={() => setIsDiscManualOverride(!isDiscManualOverride)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#c2410c',
                        fontSize: 11,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {isDiscManualOverride ? 'ซ่อนการเปลี่ยนรหัสงาน' : 'เปลี่ยนรหัสงาน'}
                    </button>
                  )}
                </div>

                {!discForm.employee_id ? (
                  <div
                    style={{
                      background: 'var(--vk-paper)',
                      border: '1px dashed var(--vk-rule)',
                      padding: '16px',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 12,
                      color: 'var(--vk-ink-3)',
                    }}
                  >
                    กรุณาเลือกพนักงานเพื่อดึงข้อมูลกะแรกในวันที่ระบุ
                  </div>
                ) : discLookupLoading ? (
                  <div
                    style={{
                      background: '#fff7ed',
                      border: '1px solid #fdba74',
                      padding: '16px',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 12,
                      color: '#c2410c',
                      fontWeight: 600,
                    }}
                  >
                    กำลังดึงข้อมูลกะแรกของวันที่ {formatThaiDateDDMMYYYY(discForm.work_date)}...
                  </div>
                ) : discLookupResult?.source === 'shift' ? (
                  <div
                    style={{
                      background: '#fff',
                      border: '1px solid #fdba74',
                      borderRadius: 6,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            background: '#dcfce7',
                            color: '#166534',
                            border: '1px solid #86efac',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          ✓ พบตารางกะในระบบ
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#9a3412' }}>
                          {discLookupResult.shift_name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                        {discForm.rate_tier === 'skilled' ? 'ระดับค่าแรงฝีมือ' : 'ระดับค่าแรงปกติ'}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--vk-ink)', fontWeight: 600 }}>
                      หน้าที่ / รหัสงาน: <span style={{ color: '#c2410c', fontFamily: 'var(--vk-mono)' }}>{discLookupResult.job_code}</span> {discLookupResult.job_desc ? `— ${discLookupResult.job_desc}` : ''}
                    </div>

                    {isDiscManualOverride && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '10px',
                          background: 'var(--vk-bone)',
                          borderRadius: 4,
                          border: '1px solid var(--vk-rule-soft)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <label className="vk-eyebrow" style={{ display: 'block', fontSize: 10 }}>
                          เลือกรหัสงานอื่น
                        </label>
                        <select
                          className="vk-input"
                          style={{ fontSize: 12, padding: '4px 8px' }}
                          value={discForm.job_id}
                          onChange={(e) => handleDiscJobChange(e.target.value)}
                        >
                          {jobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.code} {j.description ? `— ${j.description}` : ''} (ปกติ ฿{j.normal_rate}{j.skilled_rate ? `/ฝีมือ ฿${j.skilled_rate}` : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#fff7ed',
                      border: '1px solid #fdba74',
                      borderRadius: 6,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c2410c', fontWeight: 700, fontSize: 12 }}>
                      <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
                      ไม่พบข้อมูลกะของพนักงานในระบบในวันที่ระบุ
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-2)', lineHeight: 1.4 }}>
                      พนักงานอาจยังไม่ได้ลงบันทึกกะ หรือไม่ได้ลงเวลาทำงานในวันดังกล่าว กรุณาเลือกรหัสงานและกำหนดอัตราค่าแรงด้วยตนเอง (Manual)
                    </div>
                    <div>
                      <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 4, fontSize: 10 }}>
                        เลือกรหัสงานที่ต้องการ <span style={{ color: '#c2410c' }}>*</span>
                      </label>
                      <select
                        className="vk-input"
                        value={discForm.job_id}
                        onChange={(e) => handleDiscJobChange(e.target.value)}
                        style={{ borderColor: !discForm.job_id ? '#f97316' : undefined }}
                      >
                        <option value="" disabled>-- กรุณาเลือกรหัสงาน --</option>
                        {jobs.map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.code} {j.description ? `— ${j.description}` : ''} (ปกติ ฿{j.normal_rate}{j.skilled_rate ? `/ฝีมือ ฿${j.skilled_rate}` : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Wage Tier (Matching uploaded screenshot) */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 6 }}>
                  4. อัตราค่าแรงในวันนั้น
                </label>
                {(() => {
                  const job = jobs.find((j) => j.id === discForm.job_id)
                  const normalRate = job?.normal_rate ?? 357
                  const isClerk = job?.job_group === 'clerk' || (job?.code && ['692021', '692032', '692041', '692050'].includes(job.code.trim()))
                  const skilledRate = job?.skilled_rate ?? (isClerk ? 377 : normalRate)
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: discForm.rate_tier === 'normal' ? '2px solid #c2410c' : '1px solid var(--vk-rule)',
                          background: discForm.rate_tier === 'normal' ? '#ffedd5' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="disc_tier"
                            checked={discForm.rate_tier === 'normal'}
                            onChange={() => handleDiscTierChange('normal')}
                            style={{ accentColor: '#c2410c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>ค่าแรงปกติ</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>
                          ฿ {normalRate}
                        </span>
                      </label>

                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: discForm.rate_tier === 'skilled' ? '2px solid #c2410c' : '1px solid var(--vk-rule)',
                          background: discForm.rate_tier === 'skilled' ? '#ffedd5' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="disc_tier"
                            checked={discForm.rate_tier === 'skilled'}
                            onChange={() => handleDiscTierChange('skilled')}
                            style={{ accentColor: '#c2410c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>ค่าแรงฝีมือ</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>
                          ฿ {skilledRate}
                        </span>
                      </label>

                      <label
                        style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: discForm.rate_tier === 'custom' ? '2px solid #c2410c' : '1px solid var(--vk-rule)',
                          background: discForm.rate_tier === 'custom' ? '#ffedd5' : 'var(--vk-paper)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="radio"
                            name="disc_tier"
                            checked={discForm.rate_tier === 'custom'}
                            onChange={() => handleDiscTierChange('custom')}
                            style={{ accentColor: '#c2410c' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-ink)' }}>กำหนดเอง</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--vk-ink-3)', paddingLeft: 20 }}>ระบุยอด</span>
                      </label>
                    </div>
                  )
                })()}
              </div>

              {/* Calculation Box */}
              <div
                style={{
                  background: '#fff7ed',
                  border: '1px solid #fdba74',
                  borderRadius: 6,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a3412', fontWeight: 700 }}>
                      อัตราค่าแรงกะแรกในวันนั้น
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: '#7c2d12' }}>฿</span>
                      <input
                        type="number"
                        className="vk-input vk-input--mono"
                        style={{ width: 110, padding: '4px 8px', height: 32, fontSize: 15, fontWeight: 700 }}
                        value={discForm.base_rate}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          if (discForm.rate_tier !== 'custom') {
                            handleDiscTierChange('custom')
                          }
                          handleDiscBaseRateChange(val)
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a3412', fontWeight: 700 }}>
                      ยอดหักลงโทษ 2 เท่า (บันทึกในงวดนี้)
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--vk-mono)',
                        fontSize: 24,
                        fontWeight: 700,
                        color: '#c2410c',
                        marginTop: 2,
                      }}
                    >
                      – ฿ {discForm.amount}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#9a3412', borderTop: '1px dashed #fdba74', paddingTop: 8 }}>
                  💡 ขาดงานไม่มีคนแทน หัก 2 เท่าของค่าแรงกะแรกในวันนั้นตามกฎระเบียบวินัย ({discForm.base_rate} × 2 = ฿{discForm.amount})
                </div>
              </div>

              {/* 5. Custom Notes */}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>
                  5. หมายเหตุเพิ่มเติม / เลขที่รายงาน HR (ระบุหรือไม่ก็ได้)
                </label>
                <input
                  className="vk-input"
                  placeholder="เช่น HR แจ้งรายงานเมื่อวันที่ 5 พ.ค., ขาดงานกะเช้าไม่มีคนแทน"
                  value={discForm.custom_notes}
                  onChange={(e) => setDiscForm((prev) => ({ ...prev, custom_notes: e.target.value }))}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '14px 20px',
                borderTop: '1px solid var(--vk-rule)',
                background: 'var(--vk-paper)',
                flexShrink: 0,
              }}
            >
              <button
                className="vk-btn"
                style={{
                  flex: 1,
                  background: '#c2410c',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
                disabled={saveDiscMutation.isPending || !discForm.employee_id || !discForm.job_id || parseFloat(discForm.amount) <= 0 || discLookupLoading}
                onClick={() => saveDiscMutation.mutate()}
              >
                {saveDiscMutation.isPending ? 'กำลังบันทึก...' : `ยืนยันบันทึกหักเงิน ฿ ${discForm.amount}`}
              </button>
              <button className="vk-btn" onClick={closeDiscModal}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setDeleteTarget(null)}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Trash2 style={{ width: 15, height: 15, flexShrink: 0 }} />
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยืนยันการลบรายการเบิก</div>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.6 }}>
                ต้องการลบรายการเบิกล่วงหน้าของ <strong>{deleteTarget.name}</strong> ใช่หรือไม่?
              </p>
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--vk-persimmon-tint)', border: '1px solid var(--vk-persimmon)', fontSize: 12, color: 'var(--vk-persimmon-ink)' }}>
                การดำเนินการนี้ไม่สามารถเรียกคืนได้
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px', justifyContent: 'flex-end' }}>
              <button className="vk-btn" onClick={() => setDeleteTarget(null)}>ยกเลิก</button>
              <button className="vk-btn vk-btn--primary" disabled={deleteMutation.isPending}
                onClick={() => { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null) }}>
                {deleteMutation.isPending ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
