import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Save, X, Clock, Clock4, CheckSquare, Search } from 'lucide-react'
import '../styles/v2-tokens.css'

// ── helpers ────────────────────────────────────────────────────────────
function parseLocal(s: string) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
function fmtDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const DAYS   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์']
function fmtDisplay(s: string) {
  const d = parseLocal(s)
  return `วัน${DAYS[d.getDay()]}ที่ ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
function isWeekend(s: string) { const d = parseLocal(s); return d.getDay() === 0 || d.getDay() === 6 }

// ── types ──────────────────────────────────────────────────────────────
interface Period { id: string; label: string; period_start: string; period_end: string; status: string }
interface Employee { id: string; employee_code: string; first_name: string; last_name: string; prefix: string | null; position: string; nationality: string | null }
interface AssignedEmp {
  employee_id: string; shift_type: string; code: string; name: string
  nationality: string | null
  isClerk: boolean; isHalfShift: boolean; partialHours: number
  woodExcess: number; filmAmount: number; otHours: number
  isHolidayOTExempt: boolean; isCrossPosition: boolean
  crossPositionTitle: string; crossPositionExtraPay: number
  isNew: boolean
  rate_per_12h: number
}

const SHIFTS = [
  { key: 'morning',   label: 'กะเช้า',  hours: '08:00 — 20:00' },
  { key: 'afternoon', label: 'กะบ่าย',  hours: '20:00 — 08:00' },
]

function empName(e: Employee) {
  return `${e.first_name} ${e.last_name}`.trim()
}
function isNonThai(nationality: string | null) {
  return nationality && nationality !== 'ไทย'
}
function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return null
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา/กะเหรี่ยง'
  return nationality
}

// ── component ──────────────────────────────────────────────────────────
export default function ShiftEntry() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isHoliday, setIsHoliday] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [assignments, setAssignments] = useState<AssignedEmp[]>([])
  const [detailEmp, setDetailEmp] = useState<AssignedEmp | null>(null)
  const [clerkQueue, setClerkQueue] = useState<AssignedEmp[]>([])
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const confirmResolveRef = useRef<(ok: boolean) => void>(null as any)
  const splitRef = useRef<HTMLDivElement>(null)
  const [splitHeight, setSplitHeight] = useState<number | null>(null)

  // Measure actual height for the split panel.
  // Subtracts footer height so the content fills the scrollable inner div exactly,
  // preventing any outer scroll in Chrome/Edge/Safari.
  useEffect(() => {
    const update = () => {
      if (!splitRef.current) return
      const footer = document.querySelector('footer')
      const footerH = footer ? footer.getBoundingClientRect().height : 0
      setSplitHeight(window.innerHeight - splitRef.current.getBoundingClientRect().top - footerH)
    }
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
    }
  }, [])

  // ── periods ──
  const { data: periods = [] } = useQuery<Period[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const currentPeriod = periods[0]
  const periodStart = currentPeriod ? parseLocal(currentPeriod.period_start) : new Date()
  const periodEnd   = currentPeriod ? parseLocal(currentPeriod.period_end)   : new Date()

  const [currentDate, setCurrentDate] = useState<Date | null>(null)
  const activeDate = currentDate ?? new Date(Math.min(periodEnd.getTime(), Date.now()))
  const activeDateStr = fmtDate(activeDate)
  const weekend = isWeekend(activeDateStr)

  const isAtStart = activeDateStr <= fmtDate(periodStart)
  const isAtEnd   = activeDateStr >= fmtDate(periodEnd)

  // ── employees ──
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,prefix,position,nationality')
        .eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  // ── fetch existing assignments for the day ──
  const { data: rawAssignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ['shifts-v2', currentPeriod?.id, activeDateStr],
    queryFn: async () => {
      if (!currentPeriod) return []
      const { data, error } = await supabase.from('shift_assignments')
        .select('id,employee_id,shift_type,is_holiday_ot,is_half_shift,wood_excess,film_amount,ot_hours,actual_hours,is_holiday_ot_exempt,is_cross_position,cross_position_title,cross_position_extra_pay')
        .eq('period_id', currentPeriod.id).eq('work_date', activeDateStr)
      if (error) throw error; return data
    }, enabled: !!currentPeriod,
  })

  // Sync DB → local state when date changes; auto-delete orphaned assignments from inactive employees
  useEffect(() => {
    if (loadingAssignments || employees.length === 0 || !currentPeriod) return
    const activeIds = new Set(employees.map(e => e.id))
    const orphaned = (rawAssignments || []).filter((a: any) => !activeIds.has(a.employee_id))
    if (orphaned.length > 0) {
      const orphanedIds = orphaned.map((a: any) => a.employee_id)
      supabase.from('shift_assignments')
        .delete()
        .eq('period_id', currentPeriod.id)
        .eq('work_date', activeDateStr)
        .in('employee_id', orphanedIds)
        .then(() => {})
    }
    const mapped: AssignedEmp[] = (rawAssignments || [])
      .filter((a: any) => activeIds.has(a.employee_id))
      .map((a: any) => {
        const emp = employees.find(e => e.id === a.employee_id)!
        return {
          employee_id: a.employee_id, shift_type: a.shift_type,
          code: emp.employee_code,
          name: empName(emp),
          nationality: emp.nationality ?? null,
          isClerk: emp.position === 'clerk',
          isHalfShift: a.is_half_shift ?? false,
          partialHours: Number(a.actual_hours ?? 0),
          woodExcess: Number(a.wood_excess ?? 0),
          filmAmount: Number(a.film_amount ?? 0),
          otHours: Number(a.ot_hours ?? 0),
          isHolidayOTExempt: a.is_holiday_ot_exempt ?? false,
          isCrossPosition: a.is_cross_position ?? false,
          crossPositionTitle: a.cross_position_title || '',
          crossPositionExtraPay: Number(a.cross_position_extra_pay ?? 0),
          isNew: false,
          rate_per_12h: Number(emp.rate_per_12h ?? 0),
        }
      })
    setAssignments(mapped)
    if (rawAssignments.length > 0) setIsHoliday((rawAssignments[0] as any).is_holiday_ot ?? false)
    else setIsHoliday(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAssignments, employees.length, currentPeriod?.id, activeDateStr])

  const assignedIds = new Set(assignments.map(a => a.employee_id))
  const pool = employees.filter(e => !assignedIds.has(e.id))

  const filteredPool = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return pool
    return pool.filter(emp => {
      const code = emp.employee_code.toLowerCase()
      const fullName = empName(emp).toLowerCase()
      const nationality = (emp.nationality || '').toLowerCase()
      return code.includes(term) || fullName.includes(term) || nationality.includes(term)
    })
  }, [pool, searchTerm])

  const visibleEligible = useMemo(() => {
    return filteredPool.filter(e => !(isHoliday && e.position === 'clerk'))
  }, [filteredPool, isHoliday])

  const allEligibleSelected = useMemo(() => {
    if (visibleEligible.length === 0) return false
    return visibleEligible.every(e => selectedIds.has(e.id))
  }, [visibleEligible, selectedIds])

  // ── selection helpers ──
  const toggleSelect = (emp: Employee) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(emp.id)) next.delete(emp.id)
      else next.add(emp.id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      visibleEligible.forEach(e => next.add(e.id))
      return next
    })
  }

  const deselectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      visibleEligible.forEach(e => next.delete(e.id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const updateAssignment = (empId: string, patch: Partial<AssignedEmp>) => {
    setAssignments(prev => prev.map(a => a.employee_id === empId ? { ...a, ...patch } : a))
    setDetailEmp(prev => prev?.employee_id === empId ? { ...prev, ...patch } : prev)
  }

  const handleAssign = (shiftKey: string) => {
    if (selectedIds.size === 0) return

    const selectedEmps = pool.filter(e => selectedIds.has(e.id))
    const blocked = selectedEmps.filter(e => isHoliday && e.position === 'clerk')
    if (blocked.length > 0) {
      toast.error(`ไม่อนุญาตให้ลงกะเสมียนในวันหยุดนักขัตฤกษ์`)
      return
    }

    const newEmps: AssignedEmp[] = selectedEmps.map(emp => {
      const isClerk = emp.position === 'clerk'
      return {
        employee_id: emp.id, shift_type: shiftKey,
        code: emp.employee_code, name: empName(emp),
        nationality: emp.nationality ?? null,
        isClerk, isHalfShift: isClerk, partialHours: 0,
        woodExcess: 0, filmAmount: 0, otHours: 0,
        isHolidayOTExempt: false, isCrossPosition: false,
        crossPositionTitle: '', crossPositionExtraPay: 0, isNew: true,
        rate_per_12h: Number(emp.rate_per_12h ?? 0),
      }
    })

    setAssignments(prev => [...prev, ...newEmps])
    clearSelection()

    // Auto-open OT modal for every clerk assigned on a weekend, one by one
    if (weekend) {
      const clerks = newEmps.filter(e => e.isClerk)
      if (clerks.length > 0) {
        setDetailEmp(clerks[0])
        setClerkQueue(clerks.slice(1))
      }
    }
  }

  const handleRemove = (empId: string) => {
    setAssignments(prev => prev.filter(a => a.employee_id !== empId))
  }

  const navigate = (dir: -1 | 1) => {
    const d = new Date(activeDate); d.setDate(d.getDate() + dir)
    if (fmtDate(d) < fmtDate(periodStart) || fmtDate(d) > fmtDate(periodEnd)) return
    setCurrentDate(d); clearSelection()
  }

  // ── save ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id || !currentPeriod?.id) throw new Error('กรุณาสร้างงวดก่อน')
      if (assignments.length === 0) {
        const ok = await new Promise<boolean>(resolve => { confirmResolveRef.current = resolve; setConfirmDeleteOpen(true) })
        if (!ok) throw new Error('ยกเลิก')
        await supabase.from('shift_assignments').delete().eq('period_id', currentPeriod.id).eq('work_date', activeDateStr)
        return
      }
      const payload = assignments.map(a => ({
        period_id: currentPeriod.id, employee_id: a.employee_id, work_date: activeDateStr,
        shift_type: a.shift_type, is_holiday_ot: isHoliday,
        is_half_shift: a.isHalfShift,
        wood_excess: a.isClerk ? 0 : a.woodExcess,
        film_amount: a.isClerk ? 0 : a.filmAmount,
        ot_hours: a.otHours, actual_hours: a.partialHours || 0,
        is_holiday_ot_exempt: a.isHolidayOTExempt,
        is_cross_position: a.isCrossPosition,
        cross_position_title: a.crossPositionTitle || '',
        cross_position_extra_pay: a.crossPositionExtraPay || 0,
      }))
      const { error } = await supabase.from('shift_assignments' as any).upsert(payload, { onConflict: 'employee_id,work_date' })
      if (error) throw error
      const keepIds = assignments.map(a => a.employee_id)
      await supabase.from('shift_assignments').delete().eq('period_id', currentPeriod.id).eq('work_date', activeDateStr).not('employee_id', 'in', `(${keepIds.join(',')})`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts-v2'] })
      queryClient.invalidateQueries({ queryKey: ['all-period-shifts'] })
      toast.success(`บันทึกข้อมูล ${fmtDisplay(activeDateStr)} สำเร็จ`)
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const hasSelection = selectedIds.size > 0

  if (!currentPeriod) return (
    <>
      <TopBar title="กรอกกะรายวัน" onMenuClick={onMenuClick} />
      <div style={{ padding: '60px 36px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีงวด — กรุณาสร้างงวดที่ Dashboard ก่อน</div>
    </>
  )

  return (
    <>
      <TopBar title="กรอกกะรายวัน" subtitle={currentPeriod.label} onMenuClick={onMenuClick} />

      {/* Date strip */}
      <div style={{
        borderBottom: '1px solid var(--vk-rule)',
        background: isHoliday ? 'var(--vk-marigold-tint)' : weekend ? '#FAF6FD' : 'var(--vk-bone)',
        padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8,
        position: 'sticky',
        top: 'var(--vk-topbar-h)',
        zIndex: 20,
      }}>
        {/* Row 1: prev / date + weekend badge / next */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <button className="vk-btn vk-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={isAtStart} onClick={() => navigate(-1)}>
            <ChevronLeft style={{ width: 15, height: 15 }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 210, justifyContent: 'center' }}>
            <div style={{
              fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em',
              color: isHoliday ? '#6F4A0E' : weekend ? '#5b21b6' : 'var(--vk-ink)',
            }}>
              {fmtDisplay(activeDateStr)}
            </div>
            {/* Mobile only: badge inline with date */}
            {weekend && (
              <span className="md:hidden" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5b21b6', background: 'rgba(91,33,182,0.08)', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                วันหยุดสัปดาห์
              </span>
            )}
          </div>
          <button className="vk-btn vk-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={isAtEnd} onClick={() => navigate(1)}>
            <ChevronRight style={{ width: 15, height: 15 }} />
          </button>
        </div>
        {/* Row 2: holiday checkbox + weekend badge (desktop) + save button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 12px',
            border: `1px solid ${isHoliday ? 'var(--vk-marigold)' : 'var(--vk-rule-soft)'}`,
            borderRadius: 6, background: isHoliday ? 'var(--vk-marigold-tint)' : 'transparent',
            fontSize: 13, fontWeight: 600, color: isHoliday ? '#6F4A0E' : 'var(--vk-ink-2)',
          }}>
            <input type="checkbox" checked={isHoliday} onChange={e => setIsHoliday(e.target.checked)} style={{ accentColor: 'var(--vk-marigold)' }} />
            วันหยุดนักขัตฤกษ์ (OT ×2)
          </label>
          {/* Desktop only: weekend badge after holiday checkbox */}
          {weekend && (
            <span className="hidden md:inline-flex" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5b21b6', background: 'rgba(91,33,182,0.08)', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
              วันหยุดสัปดาห์
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <button className="vk-btn vk-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save style={{ width: 14, height: 14 }} />
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกวันนี้'}
            </button>
          </div>
        </div>
      </div>

      <div ref={splitRef} className="vk-shift-split" style={splitHeight ? { height: splitHeight } : undefined}>
        {/* Pool */}
        <div className="vk-pool-wrapper">
          {/* Pool header with search & select-all */}
          <div className="vk-pool-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="vk-eyebrow">POOL · ยังไม่ได้กรอก ({pool.length})</div>
              {visibleEligible.length > 0 && (
                <button
                  onClick={allEligibleSelected ? deselectAllVisible : selectAll}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    color: allEligibleSelected ? 'var(--vk-persimmon)' : 'var(--vk-ink-3)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
                    textTransform: 'uppercase',
                  }}>
                  <CheckSquare style={{ width: 12, height: 12 }} />
                  {allEligibleSelected ? 'ยกเลิก' : 'เลือกทั้งหมด'}
                </button>
              )}
            </div>

            {/* Premium Search Input Box */}
            <div className="vk-search-container">
              <Search className="vk-search-icon" />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, รหัส, สัญชาติ..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="vk-search-input"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="vk-search-clear"
                  title="ล้างคำค้นหา"
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
          </div>

          <div className="vk-pool-list">
            {filteredPool.length === 0 ? (
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)', padding: '12px 0', textAlign: 'center' }}>
                {searchTerm ? 'ไม่พบพนักงานที่ตรงกับที่ค้นหา' : 'กรอกครบทุกคนแล้ว ✓'}
              </div>
            ) : filteredPool.map(emp => {
              const isSelected = selectedIds.has(emp.id)
              const isBlockedClerk = isHoliday && emp.position === 'clerk'
              return (
                <div key={emp.id}
                  onClick={() => !isBlockedClerk && toggleSelect(emp)}
                  className="vk-employee-card"
                  data-selected={isSelected}
                  data-blocked={isBlockedClerk}>

                  {/* Checkbox indicator */}
                  <div style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${isSelected ? 'var(--vk-persimmon)' : 'var(--vk-rule-soft)'}`,
                    background: isSelected ? 'var(--vk-persimmon)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {empName(emp)}{fmtNationality(emp.nationality) ? ` (${fmtNationality(emp.nationality)})` : ''}
                      </span>
                      {emp.position === 'clerk' && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>เสมียน</span>
                      )}
                    </div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)', marginTop: 1 }}>{emp.employee_code}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Shift columns container */}
        <div className="vk-shift-columns-container">
          {SHIFTS.map(sh => {
            const shiftEmps = assignments.filter(a => a.shift_type === sh.key)
            const canDrop = hasSelection
            return (
              <div key={sh.key}
                onClick={() => { if (hasSelection) handleAssign(sh.key) }}
                className="vk-shift-column"
                style={{
                  borderRight: sh.key === 'morning' ? '1px solid var(--vk-rule-soft)' : 'none',
                  outline: canDrop ? `2px solid var(--vk-persimmon)` : 'none',
                  outlineOffset: -2,
                  cursor: canDrop ? 'pointer' : 'default',
                  transition: 'outline-color 160ms',
                }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '16px 16px 10px', flexShrink: 0 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--vk-ink)' }}>{sh.label}</div>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 2 }}>{sh.hours}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 13, fontWeight: 700, color: 'var(--vk-ink-3)' }}>{shiftEmps.length} คน</span>
                </div>
                <div style={{ margin: '0 16px 4px', borderTop: '1px solid var(--vk-rule-soft)', flexShrink: 0 }} />
                <div className="vk-shift-list-scroll">
                  {shiftEmps.map(emp => (
                    <div key={emp.employee_id}
                       onClick={e => { e.stopPropagation(); setDetailEmp(emp) }}
                       style={{
                         display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                         padding: '8px 12px', background: 'var(--vk-paper)',
                         border: '1px solid var(--vk-rule-soft)', cursor: 'pointer',
                         transition: 'border-color 120ms',
                       }}
                       onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--vk-persimmon)')}
                       onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--vk-rule-soft)')}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vk-ink)' }}>
                            {emp.name}{fmtNationality(emp.nationality) ? ` (${fmtNationality(emp.nationality)})` : ''}
                          </span>
                          {emp.isClerk && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(177,71,41,0.12)', color: 'var(--vk-persimmon)', letterSpacing: '0.04em', flexShrink: 0 }}>เสมียน</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
                          <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)' }}>{emp.code}</span>
                          {emp.isNew && <Pill color="jade">ใหม่</Pill>}
                          {emp.isHalfShift && !emp.partialHours && !emp.isClerk && <Pill color="amber">8 ชม.</Pill>}
                          {emp.partialHours > 0 && <Pill color="orange">{emp.partialHours} ชม.</Pill>}
                          {emp.otHours > 0 && <Pill color="purple">OT {emp.otHours} ชม.</Pill>}
                          {emp.woodExcess > 0 && <Pill color="blue">+ค่าไม้</Pill>}
                          {emp.filmAmount > 0 && <Pill color="blue">+ค่าฟิล์ม</Pill>}
                          {emp.isHolidayOTExempt && <Pill color="ink">×1</Pill>}
                          {emp.isCrossPosition && <Pill color="jade">สลับตำแหน่ง</Pill>}
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleRemove(emp.employee_id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', padding: 4, display: 'flex', flexShrink: 0 }}>
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ))}
                  {canDrop && (
                    <div style={{ padding: 10, border: '1px dashed var(--vk-persimmon)', color: 'var(--vk-persimmon-ink)', fontSize: 12, textAlign: 'center' }}>
                      + วาง {selectedIds.size} คน ที่นี่
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating selection hint — top-right so it doesn't cover pool list */}
      {hasSelection && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--vk-topbar-h) + var(--vk-date-strip-h) + 12px)',
          right: 16,
          background: 'var(--vk-ink-2)', color: 'var(--vk-bone)',
          padding: '10px 14px 10px 16px',
          fontFamily: 'var(--vk-sans)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
          zIndex: 100, borderRadius: 10,
          boxShadow: '0 4px 20px rgba(22,19,17,0.35)',
          maxWidth: 280,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--vk-persimmon)', textTransform: 'uppercase', marginBottom: 2 }}>
              เลือกแล้ว {selectedIds.size} คน
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>คลิกที่กะที่ต้องการ</div>
            <div style={{ fontSize: 11, color: 'var(--vk-ink-4)', marginTop: 2, lineHeight: 1.5, wordBreak: 'break-word' }}>
              {pool.filter(e => selectedIds.has(e.id)).map(e => empName(e)).join(', ')}
            </div>
          </div>
          <span style={{ cursor: 'pointer', color: 'var(--vk-ink-4)', fontSize: 18, lineHeight: 1, flexShrink: 0 }} onClick={clearSelection}>×</span>
        </div>
      )}

      {/* Employee detail modal */}
      {detailEmp && (
        <DetailModal
          emp={detailEmp} isHoliday={isHoliday} weekend={weekend}
          onUpdate={(patch) => updateAssignment(detailEmp.employee_id, patch)}
          onClose={() => {
            // If there are more clerks waiting in queue, open next one
            if (clerkQueue.length > 0) {
              setDetailEmp(clerkQueue[0])
              setClerkQueue(q => q.slice(1))
            } else {
              setDetailEmp(null)
            }
          }}
        />
      )}

      {/* Confirm delete all shifts modal */}
      {confirmDeleteOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(22,19,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setConfirmDeleteOpen(false); confirmResolveRef.current(false) }}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 380, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--vk-persimmon)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <X style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div style={{ fontWeight: 700, fontSize: 15 }}>ยืนยันการลบข้อมูลกะ</div>
            </div>
            <div style={{ padding: '20px 20px 8px' }}>
              <p style={{ fontSize: 14, color: 'var(--vk-ink-2)', lineHeight: 1.6 }}>
                ไม่มีพนักงานในกะวันนี้ — ระบบจะ<strong>ลบข้อมูลกะทั้งหมด</strong>ของวันนี้ออก
              </p>
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--vk-persimmon-tint)', border: '1px solid var(--vk-persimmon)', fontSize: 12, color: 'var(--vk-persimmon-ink)' }}>
                การดำเนินการนี้ไม่สามารถเรียกคืนได้
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '16px 20px', justifyContent: 'flex-end' }}>
              <button className="vk-btn" onClick={() => { setConfirmDeleteOpen(false); confirmResolveRef.current(false) }}>ยกเลิก</button>
              <button className="vk-btn vk-btn--primary" onClick={() => { setConfirmDeleteOpen(false); confirmResolveRef.current(true) }}>ยืนยันลบ</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Pill helper ────────────────────────────────────────────────────────
type PillColor = 'jade' | 'amber' | 'orange' | 'purple' | 'blue' | 'ink'
const PILL_STYLES: Record<PillColor, React.CSSProperties> = {
  jade:   { background: 'rgba(30,140,80,0.1)',  color: '#1a7a40' },
  amber:  { background: 'rgba(180,120,0,0.1)',  color: '#7a5200' },
  orange: { background: 'rgba(200,80,0,0.1)',   color: '#a04000' },
  purple: { background: 'rgba(100,50,180,0.1)', color: '#4a1a9a' },
  blue:   { background: 'rgba(0,80,180,0.1)',   color: '#004090' },
  ink:    { background: 'rgba(50,40,35,0.1)',   color: 'var(--vk-ink-2)' },
}
function Pill({ color, children }: { color: PillColor; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, ...PILL_STYLES[color] }}>
      {children}
    </span>
  )
}

// ── Detail Modal ───────────────────────────────────────────────────────
function DetailModal({ emp, isHoliday, weekend, onUpdate, onClose }: {
  emp: AssignedEmp; isHoliday: boolean; weekend: boolean
  onUpdate: (patch: Partial<AssignedEmp>) => void
  onClose: () => void
}) {
  // earlyReturn = กลับก่อน (8–12 ชม.) vs underHalf = ลา/ป่วย (< 8 ชม.)
  const [earlyReturn, setEarlyReturn] = React.useState(emp.partialHours >= 8)
  const isPartial = emp.partialHours > 0

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--vk-mono)', fontSize: 14, fontWeight: 600,
    border: '1px solid var(--vk-rule)', background: 'var(--vk-paper)',
    padding: '6px 10px', width: 90, textAlign: 'center',
  }

  return (
    <div className="vk-root" style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(22,19,17,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)',
        width: '100%', maxWidth: 400,
      }}>
        {/* Header */}
        <div style={{ background: 'var(--vk-persimmon)', color: 'var(--vk-bone)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{emp.name}</div>
            <div style={{ fontSize: 11, opacity: 0.75, fontFamily: 'var(--vk-mono)', marginTop: 1 }}>{emp.code}{emp.isClerk ? ' · เสมียน' : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', color: 'var(--vk-bone)', padding: 6, display: 'flex', borderRadius: 4 }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {emp.isClerk ? (
            /* ── Clerk: OT hours ── */
            <>
              <div style={{ fontSize: 12, padding: '8px 12px', background: isHoliday ? 'var(--vk-marigold-tint)' : weekend ? 'rgba(91,33,182,0.07)' : 'var(--vk-marigold-tint)', border: `1px solid ${isHoliday ? 'var(--vk-marigold)' : weekend ? 'rgba(91,33,182,0.2)' : 'var(--vk-marigold)'}`, color: isHoliday ? '#6F4A0E' : weekend ? '#3b0764' : '#6F4A0E' }}>
                {weekend && !isHoliday ? 'เสมียนทำงานวันหยุด — ได้ OT 1 เท่าตามชั่วโมงที่กรอก' : 'เสมียนทำงาน 8 ชม./วัน — ชั่วโมงเกิน 8 คิด OT 1.5 เท่า'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="vk-eyebrow">{weekend ? 'ชั่วโมงทำงานวันหยุด' : 'ชั่วโมง OT วันนี้ (เกิน 8 ชม.)'}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" min="0" step="0.5" max="16" style={inputStyle}
                    value={emp.otHours || ''} placeholder="0"
                    onChange={e => onUpdate({ otHours: Number(e.target.value) || 0 })} />
                  <span style={{ fontSize: 13, color: 'var(--vk-ink-2)' }}>ชั่วโมง</span>
                </div>
              </div>
            </>
          ) : (
            /* ── Worker: hours + wood/film ── */
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="vk-eyebrow">ชั่วโมงทำงาน</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {/* Row 1: full options */}
                  <HourBtn label="12 ชม." sub={isHoliday ? 'OT ×2' : 'ปกติ+กะ'} icon={<Clock style={{ width: 15, height: 15 }} />}
                    active={!emp.isHalfShift && !isPartial} disabled={false}
                    onClick={() => onUpdate({ isHalfShift: false, partialHours: 0 })} />
                  <HourBtn label="8 ชม." sub={isHoliday ? 'OT ×2' : 'ไม่มีค่ากะ'} icon={<Clock4 style={{ width: 15, height: 15 }} />}
                    active={emp.isHalfShift && !isPartial} disabled={false}
                    onClick={() => onUpdate({ isHalfShift: true, partialHours: 0 })} />
                  {/* Row 2: partial options */}
                  <HourBtn label="8–12 ชม." sub="กลับก่อน" icon={<Clock4 style={{ width: 15, height: 15 }} />}
                    active={isPartial && earlyReturn} disabled={false}
                    onClick={() => { setEarlyReturn(true); onUpdate({ isHalfShift: false, partialHours: emp.partialHours >= 8 && emp.partialHours < 12 ? emp.partialHours : 10 }) }} />
                  <HourBtn label="< 8 ชม." sub="ลา/ป่วย" icon={<Clock4 style={{ width: 15, height: 15 }} />}
                    active={isPartial && !earlyReturn} disabled={false}
                    onClick={() => { setEarlyReturn(false); onUpdate({ isHalfShift: false, partialHours: emp.partialHours > 0 && emp.partialHours < 8 ? emp.partialHours : 4 }) }} />
                </div>
                {isPartial && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <input
                      type="number"
                      min={earlyReturn ? 8.5 : 0.5}
                      max={earlyReturn ? 11.5 : 7.5}
                      step="0.5"
                      style={inputStyle}
                      value={emp.partialHours || ''}
                      placeholder={earlyReturn ? '10' : '4'}
                      onChange={e => {
                        const val = Number(e.target.value) || 0
                        if (earlyReturn && (val <= 8 || val >= 12)) { toast.error('กลับก่อน: ต้องอยู่ระหว่าง 8.5–11.5 ชม.'); return }
                        if (!earlyReturn && val >= 8) { toast.error('ลา/ป่วย: ต้องน้อยกว่า 8 ชม.'); return }
                        onUpdate({ partialHours: val })
                      }} />
                    <span style={{ fontSize: 12, color: 'var(--vk-ink-3)' }}>ชม. ทำงานจริง</span>
                    {emp.partialHours > 0 && emp.rate_per_12h > 0 && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vk-persimmon)', fontFamily: 'var(--vk-mono)', whiteSpace: 'nowrap' }}>
                        = {Math.round((emp.rate_per_12h / 12) * emp.partialHours).toLocaleString()} ฿
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="vk-eyebrow">ค่าไม้ส่วนเกิน (฿)</label>
                  <input type="number" min="0" style={inputStyle} value={emp.woodExcess || ''} placeholder="0"
                    onChange={e => onUpdate({ woodExcess: Number(e.target.value) || 0 })} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="vk-eyebrow">ค่าฟิล์ม (฿)</label>
                  <input type="number" min="0" style={inputStyle} value={emp.filmAmount || ''} placeholder="0"
                    onChange={e => onUpdate({ filmAmount: Number(e.target.value) || 0 })} />
                </div>
              </div>

              {isHoliday && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', border: '1px solid var(--vk-rule)', background: 'var(--vk-bone)' }}>
                  <input type="checkbox" checked={emp.isHolidayOTExempt}
                    onChange={e => onUpdate({ isHolidayOTExempt: e.target.checked })}
                    style={{ marginTop: 2, accentColor: 'var(--vk-persimmon)' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vk-ink)' }}>ได้รับค่าจ้างปกติ (ไม่ได้เรท ×2)</div>
                    <div style={{ fontSize: 11, color: 'var(--vk-ink-3)', marginTop: 2 }}>คิดเงินเหมือนวันทำงานปกติ ไม่ใช่ค่า OT วันหยุด</div>
                  </div>
                </label>
              )}

              {/* Job Rotation */}
              <div style={{ borderTop: '1px solid var(--vk-rule-soft)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={emp.isCrossPosition}
                    onChange={e => onUpdate({ isCrossPosition: e.target.checked, ...(!e.target.checked ? { crossPositionTitle: '', crossPositionExtraPay: 0 } : {}) })}
                    style={{ accentColor: 'var(--vk-persimmon)' }} />
                  ทำงานข้ามตำแหน่ง (Job Rotation)
                </label>
                {emp.isCrossPosition && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label className="vk-eyebrow">ตำแหน่งที่ทำแทน *</label>
                      <input className="vk-input" placeholder="เช่น ขับรถโฟล์คลิฟท์" value={emp.crossPositionTitle}
                        onChange={e => onUpdate({ crossPositionTitle: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label className="vk-eyebrow">เงินพิเศษเพิ่ม (฿/วัน) *</label>
                      <input className="vk-input" type="number" placeholder="เช่น 300" value={emp.crossPositionExtraPay || ''}
                        onChange={e => onUpdate({ crossPositionExtraPay: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-bone)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="vk-btn vk-btn--primary" onClick={onClose}>ตกลง</button>
        </div>
      </div>
    </div>
  )
}

function HourBtn({ label, sub, icon, active, disabled, onClick }: {
  label: string; sub: string; icon: React.ReactNode
  active: boolean; disabled: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      padding: '10px 6px', border: `1.5px solid ${active ? 'var(--vk-persimmon)' : 'var(--vk-rule)'}`,
      background: active ? 'var(--vk-persimmon-tint)' : 'var(--vk-paper)',
      color: active ? 'var(--vk-persimmon-ink)' : disabled ? 'var(--vk-ink-3)' : 'var(--vk-ink-2)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 12, fontWeight: 700,
    }}>
      {icon}
      <span>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 400 }}>{sub}</span>
    </button>
  )
}
