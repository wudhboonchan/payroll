import { useState, useMemo, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import EmployeeFormModal from './EmployeeFormModal'
import EmployeeImportModal from './EmployeeImportModal'
import { Plus, Upload, Search, AlertCircle, UserX, ArrowUpDown, ArrowUp, ArrowDown, Award, ShieldCheck, Briefcase } from 'lucide-react'
import { isTpiCompany, isTpiJobCode } from '../features/tpi/model'
import { formatEmployeeFullName, compareEmployeeCode, cleanEmployeeNameData } from '../lib/formatters'
import '../styles/tokens.css'

function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return 'ไทย'
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา'
  return nationality
}

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string
  prefix: string | null; nationality: string | null; status: string
  rate_per_12h: number; payment_method: string; bank_name: string | null
  bank_account: string | null; position: string | null; job_title: string | null
  data_complete: boolean
  is_safety_officer?: boolean | null
  has_position_allowance?: boolean | null
  national_id?: string | null
  social_security_number?: string | null
  exempt_social_security?: boolean | null
}

type SortCol =
  | 'employee_code'
  | 'name'
  | 'position'
  | 'nationality'
  | 'payment_method'
  | 'rate'
  | 'status'

const POSITIONS: Record<string, string> = {
  worker: 'พนักงานทั่วไป', clerk: 'เสมียน', foreman: 'หัวหน้างาน',
  office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ',
}

export default function Employees() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()

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

  type QuickFilter = 'all' | 'pending' | 'skilled' | 'safety' | 'clerk' | 'inactive'
  const [searchTerm, setSearchTerm] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<SortCol>('employee_code')
  const [sortAsc, setSortAsc] = useState(true)

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees-all', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,prefix,nationality,status,rate_per_12h,payment_method,bank_name,bank_account,position,job_title,data_complete,is_safety_officer,has_position_allowance,national_id,social_security_number,exempt_social_security')
        .eq('factory_id', user?.factory_id ?? '').order('employee_code')
      if (error) throw error
      return (data || []).sort((a: any, b: any) => compareEmployeeCode(a.employee_code, b.employee_code))
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  // Auto-repair corrupted employee records in database (e.g. duplicate name in last_name from prior imports)
  const isRepairingRef = useRef(false)
  useEffect(() => {
    if (!employees || employees.length === 0 || !user?.factory_id || isRepairingRef.current) return

    const corrupted = employees.filter(emp => {
      const cleaned = cleanEmployeeNameData(emp, isTpi)
      const currentPrefix = (emp.prefix || '').trim()
      const cleanedPrefix = (cleaned.prefix || '').trim()
      const currentFirst = (emp.first_name || '').trim()
      const cleanedFirst = (cleaned.first_name || '').trim()
      const currentLast = (emp.last_name || '').trim()
      const cleanedLast = (cleaned.last_name || '').trim()

      const hasCorruptedName =
        currentPrefix !== cleanedPrefix ||
        currentFirst !== cleanedFirst ||
        currentLast !== cleanedLast

      const hasJobCodeInTitle = isTpi && isTpiJobCode(emp.job_title)

      return hasCorruptedName || hasJobCodeInTitle
    })

    if (corrupted.length === 0) return

    isRepairingRef.current = true
    const repairCorrupted = async () => {
      try {
        let fixedNameCount = 0
        let fixedJobTitleCount = 0
        for (const emp of corrupted) {
          const cleaned = cleanEmployeeNameData(emp, isTpi)
          const currentPrefix = (emp.prefix || '').trim()
          const cleanedPrefix = (cleaned.prefix || '').trim()
          const currentFirst = (emp.first_name || '').trim()
          const cleanedFirst = (cleaned.first_name || '').trim()
          const currentLast = (emp.last_name || '').trim()
          const cleanedLast = (cleaned.last_name || '').trim()

          const hasCorruptedName =
            currentPrefix !== cleanedPrefix ||
            currentFirst !== cleanedFirst ||
            currentLast !== cleanedLast

          const isJobCode = isTpi && isTpiJobCode(emp.job_title)

          if (isJobCode) {
            // Migrate legacy job code in job_title to wage profile
            const legacyCode = emp.job_title!.trim()
            await supabase
              .from('tpi_employee_wage_profiles')
              .upsert({
                employee_id: emp.id,
                factory_id: user.factory_id,
                rate_tier: 'skilled',
                job_code: legacyCode,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'employee_id' })
            fixedJobTitleCount++
          }

          const updatePayload: Record<string, any> = {}
          if (hasCorruptedName) {
            updatePayload.prefix = cleaned.prefix || null
            updatePayload.first_name = cleaned.first_name
            updatePayload.last_name = cleaned.last_name || ''
            fixedNameCount++
          }
          if (isJobCode) {
            updatePayload.job_title = null
          }

          if (Object.keys(updatePayload).length > 0) {
            await supabase
              .from('employees')
              .update(updatePayload)
              .eq('id', emp.id)
          }
        }
        if (fixedNameCount > 0) {
          toast.success(`ซ่อมแซมข้อมูลชื่อพนักงานที่ซ้ำซ้อนเรียบร้อยแล้ว (${fixedNameCount} คน)`)
        }
        if (fixedJobTitleCount > 0) {
          toast.success(`แยกข้อมูลรหัสงานฝีมือออกจากตำแหน่งเรียบร้อยแล้ว (${fixedJobTitleCount} คน)`)
          queryClient.invalidateQueries({ queryKey: ['tpi-profiles', user.factory_id] })
        }
        if (fixedNameCount > 0 || fixedJobTitleCount > 0) {
          queryClient.invalidateQueries({ queryKey: ['employees-all', user.factory_id] })
          queryClient.invalidateQueries({ queryKey: ['employees', user.factory_id] })
        }
      } catch (err) {
        console.error('Failed to auto-repair corrupted employee records:', err)
      } finally {
        isRepairingRef.current = false
      }
    }

    repairCorrupted()
  }, [employees, user?.factory_id, isTpi, queryClient])

  // Query TPI Wage Profiles if in TPI factory
  const { data: tpiProfiles = [] } = useQuery({
    queryKey: ['tpi-profiles', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id || !isTpi) return []
      const { data, error } = await supabase
        .from('tpi_employee_wage_profiles')
        .select('*')
        .eq('factory_id', user.factory_id)
      if (error) return []
      return data || []
    },
    enabled: !!user?.factory_id && isTpi,
  })

  const tpiProfileMap = useMemo(() => {
    const map = new Map<string, { rate_tier: string; skilled_from: string | null; job_code: string | null; job_id: string | null }>()
    for (const p of (tpiProfiles || [])) {
      map.set(p.employee_id, {
        rate_tier: p.rate_tier,
        skilled_from: p.skilled_from,
        job_code: p.job_code || null,
        job_id: p.job_id || null,
      })
    }
    return map
  }, [tpiProfiles])

  const pendingCount  = employees.filter(e => e.data_complete === false && e.status !== 'inactive').length
  const inactiveCount = employees.filter(e => e.status === 'inactive').length
  const skilledCount  = employees.filter(e => {
    const prof = tpiProfileMap.get(e.id)
    return (prof?.rate_tier === 'skilled' || (isTpi && isTpiJobCode(e.job_title))) && e.status !== 'inactive'
  }).length
  const safetyCount   = isTpi ? employees.filter(e => !!e.is_safety_officer && e.status !== 'inactive').length : 0
  const clerkCount    = employees.filter(e => e.position === 'clerk' && e.status !== 'inactive').length

  const filtered = employees.filter(emp => {
    const matchesSearch =
      (emp.employee_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(searchTerm.toLowerCase())

    if (!matchesSearch) return false

    if (quickFilter === 'pending')  return emp.data_complete === false && emp.status !== 'inactive'
    if (quickFilter === 'skilled') {
      const prof = tpiProfileMap.get(emp.id)
      return isTpi && (prof?.rate_tier === 'skilled' || isTpiJobCode(emp.job_title)) && emp.status !== 'inactive'
    }
    if (quickFilter === 'safety')   return isTpi && !!emp.is_safety_officer && emp.status !== 'inactive'
    if (quickFilter === 'clerk')    return emp.position === 'clerk' && emp.status !== 'inactive'
    if (quickFilter === 'inactive') return emp.status === 'inactive'

    if (!searchTerm.trim() && emp.status === 'inactive') return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortCol === 'employee_code') {
      cmp = compareEmployeeCode(a.employee_code, b.employee_code)
    } else if (sortCol === 'name') {
      const nameA = formatEmployeeFullName(a, isTpi)
      const nameB = formatEmployeeFullName(b, isTpi)
      cmp = nameA.localeCompare(nameB, 'th')
    } else if (sortCol === 'position') {
      const posA = POSITIONS[a.position ?? ''] || a.position || ''
      const posB = POSITIONS[b.position ?? ''] || b.position || ''
      cmp = posA.localeCompare(posB, 'th')
    } else if (sortCol === 'nationality') {
      const natA = fmtNationality(a.nationality)
      const natB = fmtNationality(b.nationality)
      cmp = natA.localeCompare(natB, 'th')
    } else if (sortCol === 'payment_method') {
      const payA = a.payment_method === 'bank_transfer' ? `โอน ${a.bank_name || ''} ${a.bank_account || ''}` : 'เงินสด'
      const payB = b.payment_method === 'bank_transfer' ? `โอน ${b.bank_name || ''} ${b.bank_account || ''}` : 'เงินสด'
      cmp = payA.localeCompare(payB, 'th')
    } else if (sortCol === 'rate') {
      if (isTpi) {
        const profA = tpiProfileMap.get(a.id)
        const profB = tpiProfileMap.get(b.id)
        const tierA = profA?.rate_tier === 'skilled' || isTpiJobCode(a.job_title) ? 1 : 0
        const tierB = profB?.rate_tier === 'skilled' || isTpiJobCode(b.job_title) ? 1 : 0
        cmp = tierA - tierB
      } else {
        cmp = (Number(a.rate_per_12h) || 0) - (Number(b.rate_per_12h) || 0)
      }
    } else if (sortCol === 'status') {
      cmp = (a.status || '').localeCompare(b.status || '', 'th')
    }

    if (cmp === 0) {
      cmp = compareEmployeeCode(a.employee_code, b.employee_code)
    }

    return sortAsc ? cmp : -cmp
  })

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown style={{ width: 11, height: 11, opacity: 0.3, marginLeft: 4 }} />
    return sortAsc
      ? <ArrowUp   style={{ width: 11, height: 11, marginLeft: 4, color: 'var(--vk-persimmon)' }} />
      : <ArrowDown style={{ width: 11, height: 11, marginLeft: 4, color: 'var(--vk-persimmon)' }} />
  }

  const handleCreate = () => { setSelectedEmployeeId(null); setIsModalOpen(true) }
  const handleEdit   = (id: string) => { setSelectedEmployeeId(id); setIsModalOpen(true) }

  const activeLabel =
    quickFilter === 'pending'
      ? `ข้อมูลไม่ครบ (${filtered.length})`
      : quickFilter === 'skilled'
      ? `ค่าแรงฝีมือ (${filtered.length})`
      : quickFilter === 'safety'
      ? `เจ้าหน้าที่ จป. (${filtered.length})`
      : quickFilter === 'clerk'
      ? `เสมียน (${filtered.length})`
      : quickFilter === 'inactive'
      ? `พ้นสภาพ (${filtered.length})`
      : `ปกติ (${filtered.length})`

  return (
    // Fill the AppLayout inner-div as a flex column so we control our own scroll
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      <TopBar title="ฐานข้อมูลพนักงาน" subtitle={activeLabel} onMenuClick={onMenuClick} />

      {/* ── Controls area (never scrolls) ─────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '28px 36px 12px', maxWidth: 1136, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>EMPLOYEES · ฐานข้อมูลพนักงาน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              พนักงาน <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>สถานะปกติ {employees.length - inactiveCount} คน</span>{inactiveCount > 0 && <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--vk-ink-4)', marginLeft: 10 }}>({inactiveCount} พ้นสภาพ)</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="vk-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setIsImportOpen(true)}>
              <Upload style={{ width: 14, height: 14 }} />
              นำเข้า Excel
            </button>
            <button className="vk-btn vk-btn--primary" onClick={handleCreate}>
              <Plus style={{ width: 15, height: 15 }} />
              เพิ่มพนักงาน
            </button>
          </div>
        </div>

        {/* Filters — row 1: search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--vk-ink-3)' }} />
            <input className="vk-input" placeholder="ค้นหาชื่อหรือรหัสพนักงาน" value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 32, height: 36, fontSize: 13 }} />
          </div>
        </div>

        {/* Filters — row 2: quick filter buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setQuickFilter(f => f === 'pending' ? 'all' : 'pending')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
              fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
              border: `1px solid ${quickFilter === 'pending' ? 'var(--vk-marigold)' : 'var(--vk-rule-soft)'}`,
              borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
              background: quickFilter === 'pending' ? 'var(--vk-marigold-tint)' : 'var(--vk-bone)',
              color: quickFilter === 'pending' ? '#6F4A0E' : 'var(--vk-ink-2)',
            }}>
            <AlertCircle style={{ width: 13, height: 13 }} />
            ข้อมูลไม่ครบ
            {pendingCount > 0 && (
              <span style={{ background: 'var(--vk-marigold)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{pendingCount}</span>
            )}
          </button>

          {(isTpi || skilledCount > 0) && (
            <button
              onClick={() => setQuickFilter(f => f === 'skilled' ? 'all' : 'skilled')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
                fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
                border: `1px solid ${quickFilter === 'skilled' ? '#7c3aed' : 'var(--vk-rule-soft)'}`,
                borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
                background: quickFilter === 'skilled' ? '#f5f3ff' : 'var(--vk-bone)',
                color: quickFilter === 'skilled' ? '#5b21b6' : 'var(--vk-ink-2)',
              }}>
              <Award style={{ width: 13, height: 13 }} />
              ค่าแรงฝีมือ
              {skilledCount > 0 && (
                <span style={{ background: quickFilter === 'skilled' ? '#7c3aed' : 'var(--vk-ink-3)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{skilledCount}</span>
              )}
            </button>
          )}

          {isTpi && (
            <button
              onClick={() => setQuickFilter(f => f === 'safety' ? 'all' : 'safety')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
                fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
                border: `1px solid ${quickFilter === 'safety' ? '#059669' : 'var(--vk-rule-soft)'}`,
                borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
                background: quickFilter === 'safety' ? '#ecfdf5' : 'var(--vk-bone)',
                color: quickFilter === 'safety' ? '#065f46' : 'var(--vk-ink-2)',
              }}>
              <ShieldCheck style={{ width: 13, height: 13 }} />
              เจ้าหน้าที่ จป.
              {safetyCount > 0 && (
                <span style={{ background: quickFilter === 'safety' ? '#059669' : 'var(--vk-ink-3)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{safetyCount}</span>
              )}
            </button>
          )}

          <button
            onClick={() => setQuickFilter(f => f === 'clerk' ? 'all' : 'clerk')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
              fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
              border: `1px solid ${quickFilter === 'clerk' ? '#0284c7' : 'var(--vk-rule-soft)'}`,
              borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
              background: quickFilter === 'clerk' ? '#f0f9ff' : 'var(--vk-bone)',
              color: quickFilter === 'clerk' ? '#0369a1' : 'var(--vk-ink-2)',
            }}>
            <Briefcase style={{ width: 13, height: 13 }} />
            เสมียน
            {clerkCount > 0 && (
              <span style={{ background: quickFilter === 'clerk' ? '#0284c7' : 'var(--vk-ink-3)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{clerkCount}</span>
            )}
          </button>

          <button
            onClick={() => setQuickFilter(f => f === 'inactive' ? 'all' : 'inactive')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
              fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
              border: `1px solid ${quickFilter === 'inactive' ? 'var(--vk-ink-2)' : 'var(--vk-rule-soft)'}`,
              borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
              background: quickFilter === 'inactive' ? 'var(--vk-ink-2)' : 'var(--vk-bone)',
              color: quickFilter === 'inactive' ? 'var(--vk-bone)' : 'var(--vk-ink-2)',
            }}>
            <UserX style={{ width: 13, height: 13 }} />
            พ้นสภาพ
            {inactiveCount > 0 && (
              <span style={{ background: quickFilter === 'inactive' ? 'rgba(255,255,255,0.25)' : 'var(--vk-ink-3)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{inactiveCount}</span>
            )}
          </button>

          {quickFilter !== 'all' && (
            <button
              onClick={() => setQuickFilter('all')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--vk-ink-3)', fontSize: 13, textDecoration: 'underline', padding: '4px 8px',
              }}>
              แสดงทั้งหมด
            </button>
          )}
        </div>
      </div>

      {/* ── Table scroll area — full width so scrollbar doesn't eat into table ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* Inner wrapper matches controls maxWidth so columns align */}
      <div style={{ maxWidth: 1136, width: '100%', margin: '0 auto', padding: '0 36px 48px', boxSizing: 'border-box' }}>
        {isLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }} className="vk-eyebrow">กำลังโหลด...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>ไม่พบพนักงาน</div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>ลองเปลี่ยนคำค้นหา หรือเพิ่มพนักงานใหม่</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            {/* thead sticky at top:0 of THIS scroll container — always works, zero bleed-through */}
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                {[
                  { label: 'รหัส',           col: 'employee_code' as SortCol, align: 'left'   },
                  { label: 'ชื่อ–นามสกุล',   col: 'name'          as SortCol, align: 'left'   },
                  { label: 'กลุ่มงาน',        col: 'position'      as SortCol, align: 'left'   },
                  { label: 'สัญชาติ',         col: 'nationality'   as SortCol, align: 'left'   },
                  { label: 'วิธีรับเงิน',     col: 'payment_method' as SortCol, align: 'left'  },
                  { label: isTpi ? 'ประเภทค่าแรง' : 'ค่าจ้าง/เงินเดือน', col: 'rate' as SortCol, align: isTpi ? 'center' : 'right' },
                  { label: 'สถานะ',           col: 'status'        as SortCol, align: 'right'  },
                ].map((h, i) => (
                  <th key={i}
                    onClick={() => toggleSort(h.col)}
                    style={{
                      textAlign: h.align as any,
                      fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11,
                      textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)',
                      padding: '12px 14px', borderBottom: '1px solid var(--vk-rule)',
                      background: 'var(--vk-paper)', cursor: 'pointer',
                      whiteSpace: 'nowrap', userSelect: 'none',
                    }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: h.align === 'right' ? 'flex-end' : h.align === 'center' ? 'center' : 'flex-start',
                      width: '100%',
                    }}>
                      {h.label}<SortIcon col={h.col} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(emp => (
                <tr key={emp.id}
                  onClick={() => handleEdit(emp.id)}
                  style={{ borderBottom: '1px solid var(--vk-rule-soft)', cursor: 'pointer', transition: 'background 120ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--vk-bone-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {emp.employee_code}
                  </td>
                  <td style={{ padding: '13px 14px', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{formatEmployeeFullName(emp, isTpi)}</span>
                      {isTpi && emp.is_safety_officer && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }} title="เจ้าหน้าที่ความปลอดภัย (จป.) +500/เดือน">
                          จป.
                        </span>
                      )}
                      {emp.exempt_social_security && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }} title="ได้รับการยกเว้นไม่ต้องหักประกันสังคม">
                          ยกเว้น ปกส
                        </span>
                      )}
                      {emp.data_complete === false && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }} title="ข้อมูลพนักงานยังไม่สมบูรณ์">
                          ข้อมูลไม่ครบ
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {POSITIONS[emp.position ?? ''] || emp.position || '—'}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {fmtNationality(emp.nationality)}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {emp.payment_method === 'bank_transfer'
                      ? <span><span style={{ fontWeight: 600 }}>{emp.bank_name || '—'}</span> <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{emp.bank_account || ''}</span></span>
                      : 'เงินสด'}
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: isTpi ? 'center' : 'right', fontFamily: isTpi ? 'inherit' : 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {isTpi ? (
                      (() => {
                        const prof = tpiProfileMap.get(emp.id)
                        const isSkilled = prof?.rate_tier === 'skilled' || isTpiJobCode(emp.job_title)
                        const jobCode = prof?.job_code || (isTpiJobCode(emp.job_title) ? emp.job_title : null)
                        return isSkilled ? (
                          <span
                            style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d', whiteSpace: 'nowrap' }}
                            title={jobCode ? `รหัสงานฝีมือ: ${jobCode}` : undefined}
                          >
                            ค่าแรงฝีมือ
                          </span>
                        ) : (
                          <span
                            style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}
                          >
                            ค่าแรงปกติ
                          </span>
                        )
                      })()
                    ) : (
                      Number(emp.rate_per_12h).toLocaleString('en-US', { minimumFractionDigits: 2 })
                    )}
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <span className="vk-pill" data-tone={emp.status === 'active' ? 'approved' : 'draft'}>
                      ● {emp.status === 'active' ? 'ปกติ' : 'พ้นสภาพ'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>{/* end inner wrapper */}
      </div>{/* end table scroll area */}

      {/* Modal — always mounted so React state (tpiRateTier etc.) survives close/reopen */}
      <EmployeeFormModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setSelectedEmployeeId(null) }}
        employeeId={selectedEmployeeId}
        onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['employees'] }); queryClient.invalidateQueries({ queryKey: ['employees-all'] }) }}
      />

      <EmployeeImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
    </div>
  )
}
