import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import {
  Plus,
  Search,
  Briefcase,
  Layers,
  Clock,
  CheckCircle2,
  Edit2,
  X,
  Save,
} from 'lucide-react'
import type { Job } from '../features/tpi/model'
import { demoJobs } from '../features/tpi/demoData'
import { cleanJobNotes } from '../features/tpi/referenceJobs'
import { formatThaiBuddhistDate } from '../lib/formatters'
import { ThaiDatePicker } from '../components/common/ThaiDatePicker'
import { toast } from 'sonner'
import '../styles/tokens.css'
import './TpiShiftEntry.css'

export default function TpiJobManagement() {
  const outletContext = useOutletContext<{ onMenuClick?: () => void }>()
  const onMenuClick = outletContext?.onMenuClick || (() => {})
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()

  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'regular' | 'temporary'>('all')
  const [groupFilter, setGroupFilter] = useState<'all' | 'clerk' | 'general'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // Modal State for Add / Edit Job
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Form State
  const [formData, setFormData] = useState<Partial<Job>>({
    code: '',
    department: '',
    description: '',
    job_type: 'regular',
    job_group: 'general',
    quota: 1,
    planned_morning: 1,
    planned_afternoon: 0,
    planned_night: 0,
    normal_rate: 357,
    skilled_rate: null,
    valid_from: null,
    expires_on: null,
    active: true,
    notes: '',
  })

  // ── 1. Fetch Job Codes from Supabase ───────────────────────────────
  const { data: dbJobs = [] } = useQuery<Job[]>({
    queryKey: ['tpi-jobs-manager', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []

      const { data, error } = await supabase
        .from('tpi_job_codes')
        .select('*')
        .eq('factory_id', user.factory_id)
        .order('code')

      if (error) {
        console.error('Error loading tpi_job_codes:', error)
        throw error
      }
      return (data || []).map((j: Job) => {
        let active = j.active
        let needsActiveFix = false

        // คืนค่าสถานะเปิดใช้งาน: Master Data ไม่มีสถานะงดรับกะ (การงดรับกะเป็นเรื่องของการปฏิบัติงานรายวัน)
        if (!active && (['P315/69VRK', 'P322/69VRK', 'P422/69', 'Q121/69', 'Q131/69'].includes(j.code.trim()) || (j.notes && j.notes.includes('ระบุหยุด')))) {
          active = true
          needsActiveFix = true
        }

        const cleanNotes = cleanJobNotes(j.notes)
        const notesChanged = j.notes && j.notes !== cleanNotes

        if (needsActiveFix || notesChanged) {
          supabase
            .from('tpi_job_codes')
            .update({
              active,
              notes: cleanNotes,
            })
            .eq('id', j.id)
            .then(() => {})
        }
        return { ...j, active, notes: cleanNotes }
      })
    },
    enabled: !!user?.factory_id,
  })

  // Seamlessly merge DB jobs with demo/reference jobs so that all standard reference jobs
  // remain accessible even if only some of them have been individually edited and saved to DB
  const jobs: Job[] = useMemo(() => {
    const normalizeCodeKey = (c: string) => c.trim().toLowerCase().replace(/\/69(vrk)?$/i, '')
    const dbMap = new Map(dbJobs.map((j) => [j.code.trim().toLowerCase(), j]))
    const dbNormMap = new Map(dbJobs.map((j) => [normalizeCodeKey(j.code), j]))

    const merged: Job[] = demoJobs.map((refJob) => {
      const key = refJob.code.trim().toLowerCase()
      const normKey = normalizeCodeKey(refJob.code)
      const dbMatch = dbMap.get(key) || dbNormMap.get(normKey)
      if (dbMatch) {
        dbMap.delete(dbMatch.code.trim().toLowerCase())
        dbNormMap.delete(normalizeCodeKey(dbMatch.code))
        return dbMatch
      }
      return refJob
    })

    // Append any extra custom jobs created in DB that were not in reference list
    for (const customDbJob of dbMap.values()) {
      merged.push(customDbJob)
    }

    return merged
  }, [dbJobs])

  // ── 2. Summary Statistics ──────────────────────────────────────────
  const stats = useMemo(() => {
    const totalJobs = jobs.length
    const clerkJobs = jobs.filter((j) => j.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(j.code.trim()))
    const generalJobs = jobs.filter((j) => !clerkJobs.includes(j))
    const regularJobs = jobs.filter((j) => j.job_type === 'regular')
    const tempJobs = jobs.filter((j) => j.job_type === 'temporary')
    const activeJobs = jobs.filter((j) => j.active)

    const totalQuota = jobs.reduce((sum, j) => sum + (j.active ? j.quota : 0), 0)
    const regularQuota = regularJobs.reduce((sum, j) => sum + (j.active ? j.quota : 0), 0)
    const tempQuota = tempJobs.reduce((sum, j) => sum + (j.active ? j.quota : 0), 0)

    return {
      totalJobs,
      clerkJobsCount: clerkJobs.length,
      generalJobsCount: generalJobs.length,
      regularJobsCount: regularJobs.length,
      tempJobsCount: tempJobs.length,
      activeJobsCount: activeJobs.length,
      totalQuota,
      regularQuota,
      tempQuota,
    }
  }, [jobs])

  // ── 3. Filtered Jobs ───────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const matchSearch =
        !searchTerm.trim() ||
        j.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        j.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        j.description.toLowerCase().includes(searchTerm.toLowerCase())

      const matchType = typeFilter === 'all' || j.job_type === typeFilter
      const isClerk = j.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(j.code.trim())
      const matchGroup =
        groupFilter === 'all' ||
        (groupFilter === 'clerk' && isClerk) ||
        (groupFilter === 'general' && !isClerk)

      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && j.active) ||
        (statusFilter === 'inactive' && !j.active)

      return matchSearch && matchType && matchGroup && matchStatus
    })
  }, [jobs, searchTerm, typeFilter, groupFilter, statusFilter])

  // ── 4. Open Modal for Create / Edit ────────────────────────────────
  const handleOpenCreate = () => {
    setEditingJob(null)
    setFormData({
      code: '',
      department: '',
      description: '',
      job_type: 'regular',
      job_group: 'general',
      quota: 1,
      planned_morning: 1,
      planned_afternoon: 0,
      planned_night: 0,
      normal_rate: 357,
      skilled_rate: null,
      valid_from: null,
      expires_on: null,
      active: true,
      notes: '',
    })
    setIsModalOpen(true)
  }

  const handleOpenEdit = (job: Job) => {
    setEditingJob(job)
    const isClerk = job.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(job.code.trim())
    setFormData({
      ...job,
      job_group: isClerk ? 'clerk' : 'general',
      skilled_rate: isClerk ? (job.skilled_rate ?? 377) : job.skilled_rate,
      notes: cleanJobNotes(job.notes),
    })
    setIsModalOpen(true)
  }

  // ── 5. Save Mutation ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<Job>) => {
      const quota = Number(payload.quota) || 0
      const pm = payload.planned_morning !== null && payload.planned_morning !== undefined ? Number(payload.planned_morning) : null
      const pa = payload.planned_afternoon !== null && payload.planned_afternoon !== undefined ? Number(payload.planned_afternoon) : null
      const pn = payload.planned_night !== null && payload.planned_night !== undefined ? Number(payload.planned_night) : null
      const isPlanValid = pm !== null && pa !== null && pn !== null && (pm + pa + pn === quota)

      const isClerk = payload.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes((payload.code || '').trim())
      const jobGroup = isClerk ? 'clerk' : 'general'
      const skilledRate = payload.skilled_rate !== null && payload.skilled_rate !== undefined && payload.skilled_rate !== ''
        ? Number(payload.skilled_rate)
        : (isClerk ? 377 : null)

      if (!user?.factory_id) {
        const key = (payload.code || '').trim().toLowerCase()
        const normKey = key.replace(/\/69(vrk)?$/i, '')
        const idx = demoJobs.findIndex((j) => j.id === editingJob?.id || j.code.trim().toLowerCase() === key || j.code.trim().toLowerCase().replace(/\/69(vrk)?$/i, '') === normKey)
        if (idx >= 0) {
          demoJobs[idx] = { ...demoJobs[idx], ...payload, skilled_rate: skilledRate } as Job
        }
        return { ...payload, skilled_rate: skilledRate }
      }

      const jobPayload: any = {
        factory_id: user.factory_id,
        code: (payload.code || '').trim(),
        department: (payload.department || '').trim(),
        description: (payload.description || '').trim(),
        job_type: payload.job_type || 'regular',
        job_group: jobGroup,
        quota,
        planned_morning: isPlanValid ? pm : null,
        planned_afternoon: isPlanValid ? pa : null,
        planned_night: isPlanValid ? pn : null,
        normal_rate: Number(payload.normal_rate) || 357,
        skilled_rate: skilledRate,
        valid_from: payload.valid_from || null,
        expires_on: payload.expires_on || null,
        active: payload.active ?? true,
        notes: payload.notes || '',
        updated_at: new Date().toISOString(),
      }

      const doSave = async (p: any) => {
        if (editingJob && editingJob.id && !editingJob.id.startsWith('reference-')) {
          const res = await supabase.from('tpi_job_codes').update(p).eq('id', editingJob.id).select()
          if (res.data && res.data.length > 0) return res
          // If no row updated by id, fallback to upsert by factory_id + code
          return supabase.from('tpi_job_codes').upsert(p, { onConflict: 'factory_id,code' }).select()
        } else {
          return supabase.from('tpi_job_codes').upsert(p, { onConflict: 'factory_id,code' }).select()
        }
      }

      let res = await doSave(jobPayload)
      let error = res.error
      // Graceful fallback if job_group column is not yet migrated in remote Supabase
      if (error && error.message?.includes('job_group')) {
        delete jobPayload.job_group
        res = await doSave(jobPayload)
        error = res.error
      }

      if (error) throw error
      return (res.data && res.data[0]) ? res.data[0] : jobPayload
    },
    onSuccess: (savedData: any) => {
      if (savedData) {
        queryClient.setQueryData(['tpi-jobs-manager', user?.factory_id], (old: Job[] | undefined) => {
          if (!old) return old
          const key = (savedData.code || '').trim().toLowerCase()
          const normKey = key.replace(/\/69(vrk)?$/i, '')
          const exists = old.some((j) => (savedData.id && j.id === savedData.id) || j.code.trim().toLowerCase() === key || j.code.trim().toLowerCase().replace(/\/69(vrk)?$/i, '') === normKey)
          if (exists) {
            return old.map((j) => ((savedData.id && j.id === savedData.id) || j.code.trim().toLowerCase() === key || j.code.trim().toLowerCase().replace(/\/69(vrk)?$/i, '') === normKey) ? { ...j, ...savedData } : j)
          }
          return [...old, savedData]
        })
      }
      queryClient.invalidateQueries({ queryKey: ['tpi-jobs-manager'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-job-codes'] })
      toast.success(editingJob ? '✓ แก้ไขรหัสงานสำเร็จ' : '✓ เพิ่มรหัสงานใหม่สำเร็จ')
      setIsModalOpen(false)
    },
    onError: (err: any) => {
      const msg = err?.message || ''
      if (msg.includes('tpi_job_codes') && msg.includes('schema cache')) {
        toast.error('ยังไม่ได้สร้างตาราง tpi_job_codes ใน Supabase กรุณารัน SQL migration_tpi_phase2.sql ใน Supabase SQL Editor')
      } else {
        toast.error(`เกิดข้อผิดพลาด: ${msg || 'ไม่สามารถบันทึกได้'}`)
      }
    },
  })

  // ── 6. Import Standard Reference Jobs ──────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code?.trim()) {
      toast.error('กรุณาระบุรหัสงาน')
      return
    }
    if (!formData.department?.trim()) {
      toast.error('กรุณาระบุแผนก / ฝ่าย')
      return
    }
    if (formData.job_type === 'temporary' && !formData.expires_on) {
      toast.error('งานชั่วคราวต้องระบุวันหมดอายุ')
      return
    }
    if (formData.valid_from && formData.expires_on && formData.expires_on < formData.valid_from) {
      toast.error('วันหมดอายุต้องไม่ก่อนวันที่เริ่มใช้')
      return
    }

    saveMutation.mutate(formData)
  }

  return (
    <div className="vk-root" style={{ background: 'var(--vk-paper)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 1. Header Bar */}
      <TopBar title="จัดการรหัสงาน" onMenuClick={onMenuClick} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '16px 24px 60px', maxWidth: 1400, width: '100%', margin: '0 auto' }}>
        {/* Page Title & Main Actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontFamily: 'var(--vk-sans)', fontSize: 22, fontWeight: 800, color: 'var(--vk-ink)', margin: 0 }}>
                ฐานข้อมูลรหัสงาน (Job Codes)
              </h1>
            </div>
            <p style={{ fontSize: 13, color: 'var(--vk-ink-3)', margin: '4px 0 0' }}>
              กำหนดรหัสงาน ยอดความต้องการแรงงาน แผนรายกะ และอัตราค่าจ้างประจำวัน
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="vk-btn vk-btn--primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              onClick={handleOpenCreate}
            >
              <Plus style={{ width: 16, height: 16 }} />
              เพิ่มรหัสงานใหม่
            </button>
          </div>
        </div>

        {/* 2. KPI Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(177,71,41,0.08)', color: 'var(--vk-persimmon)', display: 'grid', placeItems: 'center' }}>
              <Briefcase style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vk-ink-3)', textTransform: 'uppercase' }}>รหัสงานทั้งหมด</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vk-ink)', fontFamily: 'var(--vk-mono)' }}>
                {stats.totalJobs} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--vk-ink-3)' }}>รหัส</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(234,179,8,0.12)', color: '#b45309', display: 'grid', placeItems: 'center' }}>
              <Layers style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vk-ink-3)', textTransform: 'uppercase' }}>1. งานประจำ (Regular)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vk-ink)', fontFamily: 'var(--vk-mono)' }}>
                {stats.regularJobsCount} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--vk-ink-3)' }}>รหัส ({stats.regularQuota} แรง)</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(59,130,246,0.12)', color: '#2563eb', display: 'grid', placeItems: 'center' }}>
              <Clock style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vk-ink-3)', textTransform: 'uppercase' }}>2. งานชั่วคราว (Temporary)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vk-ink)', fontFamily: 'var(--vk-mono)' }}>
                {stats.tempJobsCount} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--vk-ink-3)' }}>รหัส ({stats.tempQuota} แรง)</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(34,197,94,0.12)', color: '#16a34a', display: 'grid', placeItems: 'center' }}>
              <CheckCircle2 style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vk-ink-3)', textTransform: 'uppercase' }}>ยอดแรงงานเป้าหมายรวม</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#15803d', fontFamily: 'var(--vk-mono)' }}>
                {stats.totalQuota} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--vk-ink-3)' }}>คน/วัน</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Search & Filter Bar */}
        <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 400 }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--vk-ink-3)' }} />
            <input
              type="text"
              placeholder="ค้นหารหัสงาน, แผนก, รายละเอียด..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="vk-input"
              style={{ paddingLeft: 34, width: '100%', height: 36, fontSize: 13 }}
            />
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 6, padding: 2 }}>
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: typeFilter === 'all' ? '#ffffff' : 'transparent',
                  color: typeFilter === 'all' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: typeFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                ทุกประเภท ({jobs.length})
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('regular')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: typeFilter === 'regular' ? '#ffffff' : 'transparent',
                  color: typeFilter === 'regular' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: typeFilter === 'regular' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                1. งานประจำ ({stats.regularJobsCount})
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('temporary')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: typeFilter === 'temporary' ? '#ffffff' : 'transparent',
                  color: typeFilter === 'temporary' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: typeFilter === 'temporary' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                2. งานชั่วคราว ({stats.tempJobsCount})
              </button>
            </div>

            {/* Filter: Job Group */}
            <div style={{ display: 'flex', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 6, padding: 2 }}>
              <button
                type="button"
                onClick={() => setGroupFilter('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: groupFilter === 'all' ? '#ffffff' : 'transparent',
                  color: groupFilter === 'all' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: groupFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ทุกกลุ่มงาน ({jobs.length})
              </button>
              <button
                type="button"
                onClick={() => setGroupFilter('clerk')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: groupFilter === 'clerk' ? '#ffffff' : 'transparent',
                  color: groupFilter === 'clerk' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: groupFilter === 'clerk' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                🏢 กลุ่มเสมียน ({stats.clerkJobsCount})
              </button>
              <button
                type="button"
                onClick={() => setGroupFilter('general')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: groupFilter === 'general' ? '#ffffff' : 'transparent',
                  color: groupFilter === 'general' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: groupFilter === 'general' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                🏭 กลุ่มทั่วไป ({stats.generalJobsCount})
              </button>
            </div>

            {/* Filter: Active Status */}
            <div style={{ display: 'flex', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 6, padding: 2 }}>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'all' ? '#ffffff' : 'transparent',
                  color: statusFilter === 'all' ? 'var(--vk-ink)' : 'var(--vk-ink-3)',
                  boxShadow: statusFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ทุกสถานะ
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'active' ? '#ffffff' : 'transparent',
                  color: statusFilter === 'active' ? '#16a34a' : 'var(--vk-ink-3)',
                  boxShadow: statusFilter === 'active' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                เปิดใช้งาน ({stats.activeJobsCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('inactive')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'inactive' ? '#ffffff' : 'transparent',
                  color: statusFilter === 'inactive' ? '#dc2626' : 'var(--vk-ink-3)',
                  boxShadow: statusFilter === 'inactive' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ยกเลิกรหัสงาน ({stats.totalJobs - stats.activeJobsCount})
              </button>
            </div>
          </div>
        </div>

        {/* 4. Jobs Table */}
        <div style={{ background: '#ffffff', border: '1px solid var(--vk-rule-soft)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13, tableLayout: 'auto' }}>
              <thead>
                <tr style={{ background: 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule-soft)', color: 'var(--vk-ink-2)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '10px 14px', width: 95, whiteSpace: 'nowrap' }}>รหัสงาน</th>
                  <th style={{ padding: '10px 14px', width: 140, whiteSpace: 'nowrap' }}>แผนก / ฝ่าย</th>
                  <th style={{ padding: '10px 14px', minWidth: 220 }}>รายละเอียดงาน</th>
                  <th style={{ padding: '10px 12px', width: 95, textAlign: 'center', whiteSpace: 'nowrap' }}>ประเภท</th>
                  <th style={{ padding: '10px 12px', width: 95, textAlign: 'center', whiteSpace: 'nowrap' }}>กลุ่มงาน</th>
                  <th style={{ padding: '10px 12px', width: 85, textAlign: 'center', whiteSpace: 'nowrap' }}>ยอดเต็ม</th>
                  <th style={{ padding: '10px 12px', width: 100, textAlign: 'right', whiteSpace: 'nowrap' }}>ค่าแรงปกติ</th>
                  <th style={{ padding: '10px 12px', width: 100, textAlign: 'right', whiteSpace: 'nowrap' }}>ค่าแรงฝีมือ</th>
                  <th style={{ padding: '10px 12px', width: 110, textAlign: 'center', whiteSpace: 'nowrap' }}>วันหมดอายุ</th>
                  <th style={{ padding: '10px 12px', width: 85, textAlign: 'center', whiteSpace: 'nowrap' }}>สถานะ</th>
                  <th style={{ padding: '10px 14px', width: 80, textAlign: 'center', whiteSpace: 'nowrap' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--vk-ink-3)' }}>
                      ไม่พบรหัสงานที่ตรงกับเงื่อนไขการค้นหา
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((job) => {
                    const isClerk = job.job_group === 'clerk' || ['692021', '692032', '692041', '692050'].includes(job.code.trim())
                    return (
                      <tr
                        key={job.id}
                        style={{
                          borderBottom: '1px solid var(--vk-rule-soft)',
                          background: job.active ? '#ffffff' : '#fafafa',
                          opacity: job.active ? 1 : 0.65,
                        }}
                        className="hover:bg-[#fcfbf9]"
                      >
                        {/* รหัสงาน */}
                        <td style={{ padding: '12px 14px', fontWeight: 700, fontFamily: 'var(--vk-mono)', whiteSpace: 'nowrap' }}>
                          <span className="vk-tpi-code-tag" style={{ fontSize: 12, padding: '2px 7px' }}>
                            {job.code}
                          </span>
                        </td>

                        {/* แผนก */}
                        <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--vk-ink)', fontSize: 12 }}>
                          {job.department}
                        </td>

                        {/* รายละเอียด */}
                        <td style={{ padding: '12px 14px', color: 'var(--vk-ink-2)' }}>
                          <div style={{ lineHeight: 1.4 }}>{job.description}</div>
                          {cleanJobNotes(job.notes) ? (
                            <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>
                              {cleanJobNotes(job.notes)}
                            </div>
                          ) : null}
                        </td>

                        {/* ประเภท */}
                        <td style={{ padding: '12px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: job.job_type === 'regular' ? '#fef3c7' : '#dbeafe',
                              color: job.job_type === 'regular' ? '#92400e' : '#1e40af',
                            }}
                          >
                            {job.job_type === 'regular' ? 'งานประจำ' : 'งานชั่วคราว'}
                          </span>
                        </td>

                        {/* กลุ่มงาน */}
                        <td style={{ padding: '12px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {isClerk ? (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: '#e0e7ff',
                                color: '#3730a3',
                                border: '1px solid #c7d2fe',
                              }}
                            >
                              🏢 เสมียน
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: '#f1f5f9',
                                color: '#475569',
                              }}
                            >
                              🏭 ทั่วไป
                            </span>
                          )}
                        </td>

                        {/* ยอดเต็ม */}
                        <td style={{ padding: '12px 12px', textAlign: 'center', fontWeight: 800, fontFamily: 'var(--vk-mono)', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {job.quota} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--vk-ink-3)' }}>คน</span>
                        </td>

                        {/* ค่าแรงปกติ */}
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, color: 'var(--vk-ink)', whiteSpace: 'nowrap' }}>
                          ฿{job.normal_rate.toLocaleString()}
                        </td>

                        {/* ค่าแรงฝีมือ */}
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {job.skilled_rate ? (
                            <span style={{ color: '#15803d' }}>฿{job.skilled_rate.toLocaleString()}</span>
                          ) : (
                            <span style={{ color: 'var(--vk-ink-3)', fontWeight: 400 }}>—</span>
                          )}
                        </td>

                        {/* หมดอายุ */}
                        <td style={{ padding: '12px 12px', textAlign: 'center', fontSize: 12, color: job.expires_on ? '#b45309' : 'var(--vk-ink-3)', whiteSpace: 'nowrap', fontFamily: job.expires_on ? 'var(--vk-mono)' : 'inherit' }}>
                          {formatThaiBuddhistDate(job.expires_on, 'ไม่มีกำหนด')}
                        </td>

                        {/* สถานะ */}
                        <td style={{ padding: '12px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {job.active ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>
                              เปิดใช้งาน
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#dc2626' }}>
                              ยกเลิกรหัสงาน
                            </span>
                          )}
                        </td>

                        {/* ปุ่มจัดการ */}
                        <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="vk-btn vk-btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handleOpenEdit(job)}
                          >
                            <Edit2 style={{ width: 12, height: 12 }} />
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>

      {/* ── 5. Add / Edit Modal ─────────────────────────────────────── */}
      {isModalOpen && (
        <div className="vk-modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div
            className="vk-modal-container"
            style={{
              maxWidth: 620,
              background: '#ffffff',
              borderRadius: 12,
              border: '1px solid var(--vk-rule-soft)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="vk-modal-header" style={{ padding: '16px 20px', background: '#ffffff', borderBottom: '1px solid var(--vk-rule-soft)' }}>
              <div className="vk-modal-header-left">
                <div className="vk-modal-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--vk-ink)' }}>
                  {editingJob ? `แก้ไขรหัสงาน: ${editingJob.code}` : 'เพิ่มรหัสงานใหม่'}
                </div>
                <div className="vk-modal-subtitle" style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>
                  กำหนดข้อมูลรหัสงาน ความต้องการแรงงาน และอัตราค่าจ้าง
                </div>
              </div>
              <button
                type="button"
                className="vk-modal-btn-close"
                onClick={() => setIsModalOpen(false)}
                title="ปิดหน้าต่าง"
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div
                className="vk-modal-body"
                style={{
                  padding: '20px 22px',
                  background: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  overflowY: 'auto',
                }}
              >
                {/* Line 1: Code & Department */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      รหัสงาน <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="เช่น 690003, P134/69"
                      value={formData.code || ''}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      className="vk-input"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1' }}
                    />
                  </div>

                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      แผนก / ฝ่าย <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="เช่น FCB Warehouse, Finishing"
                      value={formData.department || ''}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="vk-input"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1' }}
                    />
                  </div>
                </div>

                {/* Line 2: Description */}
                <div className="vk-field-group">
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>รายละเอียดงาน</label>
                  <textarea
                    rows={2}
                    placeholder="เช่น งานคัดแยกของเสีย Coating Line 3,4,6"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="vk-input"
                    style={{ background: '#ffffff', borderColor: '#cbd5e1', height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                  />
                </div>

                {/* Line 3: Group & Type */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      กลุ่มงาน <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                    </label>
                    <select
                      value={formData.job_group || 'general'}
                      onChange={(e) => {
                        const newGroup = e.target.value as 'clerk' | 'general'
                        setFormData({
                          ...formData,
                          job_group: newGroup,
                          skilled_rate: newGroup === 'clerk' ? (formData.skilled_rate ?? 377) : formData.skilled_rate,
                        })
                      }}
                      className="vk-modal-select"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1' }}
                    >
                      <option value="general">🏭 กลุ่มงานทั่วไป (General)</option>
                      <option value="clerk">🏢 กลุ่มงานเสมียน (Clerk - หมุนเวียนตำแหน่ง)</option>
                    </select>
                  </div>

                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      ประเภทงาน <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                    </label>
                    <select
                      value={formData.job_type || 'regular'}
                      onChange={(e) => setFormData({ ...formData, job_type: e.target.value as any })}
                      className="vk-modal-select"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1' }}
                    >
                      <option value="regular">1. งานประจำ (Regular)</option>
                      <option value="temporary">2. งานชั่วคราว (Temporary)</option>
                    </select>
                  </div>
                </div>

                {/* Line 4: Quota */}
                <div className="vk-field-group">
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                    ยอดเต็มที่ต้องการ (คน/วัน) <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1}
                    value={formData.quota || 0}
                    onChange={(e) => setFormData({ ...formData, quota: Number(e.target.value) })}
                    className="vk-input"
                    style={{ background: '#ffffff', borderColor: '#cbd5e1', fontFamily: 'var(--vk-mono)' }}
                  />
                </div>

                {/* Line 5: Wage Rates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      ค่าแรงปกติ (บาท/กะ) <span style={{ color: 'var(--vk-crimson)' }}>*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      step={1}
                      value={formData.normal_rate || 357}
                      onChange={(e) => setFormData({ ...formData, normal_rate: Number(e.target.value) })}
                      className="vk-input"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1', fontFamily: 'var(--vk-mono)' }}
                    />
                  </div>

                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      ค่าแรงฝีมือ (บาท/กะ - ถ้ามี)
                      {formData.job_group === 'clerk' && <span style={{ color: '#4338ca', marginLeft: 4 }}>(มาตรฐานเสมียน ฿377)</span>}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder={formData.job_group === 'clerk' ? '377' : 'เว้นว่างได้ (หากไม่มีเรทฝีมือ)'}
                      value={formData.skilled_rate ?? ''}
                      onChange={(e) => setFormData({ ...formData, skilled_rate: e.target.value === '' ? null : Number(e.target.value) })}
                      className="vk-input"
                      style={{ background: '#ffffff', borderColor: '#cbd5e1', fontFamily: 'var(--vk-mono)' }}
                    />
                  </div>
                </div>
                {formData.job_group === 'clerk' && (
                  <div style={{ fontSize: 11, color: '#3730a3', background: '#eef2ff', padding: '8px 12px', borderRadius: 6, borderLeft: '3px solid #6366f1', lineHeight: 1.5 }}>
                    <strong>กลุ่มงานเสมียน (Clerk Group):</strong> พนักงานตำแหน่งเสมียนที่ตั้งค่าเรทฝีมือไว้ จะได้รับค่าแรงเรทฝีมือ <strong>฿{formData.skilled_rate || 377}</strong> อัตโนมัติเมื่อหมุนเวียนมาปฏิบัติงานในรหัสนี้ ส่วนพนักงานเรทปกติจะได้รับค่าแรงปกติ <strong>฿{formData.normal_rate || 357}</strong>
                  </div>
                )}

                {/* Line 5: Dates (Thai Buddhist Era format) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>วันที่เริ่มใช้ (ถ้ามี)</label>
                    <ThaiDatePicker
                      value={formData.valid_from}
                      onChange={(val) => setFormData({ ...formData, valid_from: val })}
                      placeholder="วว/ดด/ปปปป (พ.ศ.)"
                    />
                  </div>

                  <div className="vk-field-group">
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>
                      วันหมดอายุ {formData.job_type === 'temporary' ? <span style={{ color: 'var(--vk-crimson)' }}>*</span> : '(ถ้ามี)'}
                    </label>
                    <ThaiDatePicker
                      required={formData.job_type === 'temporary'}
                      value={formData.expires_on}
                      onChange={(val) => setFormData({ ...formData, expires_on: val })}
                      placeholder="วว/ดด/ปปปป (พ.ศ.)"
                    />
                  </div>
                </div>

                {/* Line 6: Notes */}
                <div className="vk-field-group">
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--vk-ink-2)' }}>หมายเหตุ</label>
                  <input
                    type="text"
                    placeholder="เช่น 1 กะ/5 วัน, ทำงานเฉพาะเสาร์–อาทิตย์"
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="vk-input"
                    style={{ background: '#ffffff', borderColor: '#cbd5e1' }}
                  />
                </div>

                {/* Line 7: Active Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    background: (formData.active ?? true) ? '#f0fdf4' : '#fafafa',
                    borderRadius: 8,
                    border: `1px solid ${(formData.active ?? true) ? '#bbf7d0' : 'var(--vk-rule-soft)'}`,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)' }}>
                    <input
                      type="checkbox"
                      checked={formData.active ?? true}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      style={{ width: 18, height: 18, accentColor: 'var(--vk-persimmon)', cursor: 'pointer' }}
                    />
                    <span>
                      {(formData.active ?? true) ? 'เปิดใช้งาน' : 'ยกเลิกรหัสงาน'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Footer */}
              <div className="vk-modal-bottom-actions" style={{ justifyContent: 'flex-end', gap: 10, padding: '14px 20px', background: 'var(--vk-paper)', borderTop: '1px solid var(--vk-rule-soft)' }}>
                <button
                  type="button"
                  className="vk-btn vk-btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="vk-btn vk-btn--primary"
                  disabled={saveMutation.isPending}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Save style={{ width: 15, height: 15 }} />
                  {saveMutation.isPending ? 'กำลังบันทึก...' : editingJob ? 'บันทึกการแก้ไข' : 'บันทึกรหัสงาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
