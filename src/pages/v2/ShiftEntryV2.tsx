import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Save } from 'lucide-react'
import '../../styles/v2-tokens.css'

function parseLocal(s: string) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
function fmtDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
function fmtDisplay(s: string) { const d=parseLocal(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }

interface Period { id: string; label: string; period_start: string; period_end: string; status: string }
interface Employee { id: string; employee_code: string; first_name: string; last_name: string }
interface Assignment { id?: string; employee_id: string; shift_type: string; is_holiday_ot: boolean; actual_hours: number; is_holiday_ot_exempt: boolean }

const SHIFTS = [
  { key: 'morning',   label: 'กะเช้า',  hours: '06:00 — 18:00' },
  { key: 'afternoon', label: 'กะบ่าย',  hours: '14:00 — 02:00' },
  { key: 'night',     label: 'กะดึก',   hours: '22:00 — 10:00' },
]

export default function ShiftEntryV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isHoliday, setIsHoliday] = useState(false)

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

  const isAtStart = fmtDate(activeDate) <= fmtDate(periodStart)
  const isAtEnd   = fmtDate(activeDate) >= fmtDate(periodEnd)

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['shifts-v2', currentPeriod?.id, activeDateStr],
    queryFn: async () => {
      if (!currentPeriod) return []
      const { data, error } = await supabase.from('shift_assignments').select('id,employee_id,shift_type,is_holiday_ot,actual_hours,is_holiday_ot_exempt')
        .eq('period_id', currentPeriod.id).eq('work_date', activeDateStr)
      if (error) throw error; return data
    }, enabled: !!currentPeriod,
  })

  const assignedIds = new Set(assignments.map(a => a.employee_id))
  const pool = employees.filter(e => !assignedIds.has(e.id))

  const [selected, setSelected] = useState<Employee | null>(null)

  const saveMutation = useMutation({
    mutationFn: async ({ emp, shiftKey }: { emp: Employee; shiftKey: string }) => {
      const { error } = await supabase.from('shift_assignments').upsert({
        period_id: currentPeriod!.id, work_date: activeDateStr,
        employee_id: emp.id, shift_type: shiftKey,
        is_holiday_ot: isHoliday, actual_hours: 12, is_holiday_ot_exempt: false,
      }, { onConflict: 'period_id,work_date,employee_id' })
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts-v2'] }); setSelected(null) },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const removeMutation = useMutation({
    mutationFn: async (empId: string) => {
      const { error } = await supabase.from('shift_assignments').delete().eq('period_id', currentPeriod!.id).eq('work_date', activeDateStr).eq('employee_id', empId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shifts-v2'] }),
  })

  const navigate = (dir: -1 | 1) => {
    const d = new Date(activeDate)
    d.setDate(d.getDate() + dir)
    if (fmtDate(d) < fmtDate(periodStart) || fmtDate(d) > fmtDate(periodEnd)) return
    setCurrentDate(d)
  }

  if (!currentPeriod) return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="กรอกกะรายวัน" onMenuClick={onMenuClick} />
      <div style={{ padding: '60px 36px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีงวด — กรุณาสร้างงวดที่ Dashboard ก่อน</div>
    </div>
  )

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="กรอกกะรายวัน" subtitle={currentPeriod.label} onMenuClick={onMenuClick} />

      {/* Period date strip */}
      <div style={{ borderBottom: '1px solid var(--vk-rule)', background: 'var(--vk-bone)', padding: '12px 36px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button className="vk-btn vk-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={isAtStart} onClick={() => navigate(-1)}>
          <ChevronLeft style={{ width: 15, height: 15 }} />
        </button>
        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', minWidth: 140, textAlign: 'center' }}>
          {fmtDisplay(activeDateStr)}
        </div>
        <button className="vk-btn vk-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={isAtEnd} onClick={() => navigate(1)}>
          <ChevronRight style={{ width: 15, height: 15 }} />
        </button>
        <div style={{ height: 24, width: 1, background: 'var(--vk-rule-soft)' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 12px', border: `1px solid ${isHoliday ? 'var(--vk-marigold)' : 'var(--vk-rule-soft)'}`, borderRadius: 6, background: isHoliday ? 'var(--vk-marigold-tint)' : 'transparent', fontSize: 13, fontWeight: 600, color: isHoliday ? '#6F4A0E' : 'var(--vk-ink-2)' }}>
          <input type="checkbox" checked={isHoliday} onChange={e => setIsHoliday(e.target.checked)} style={{ accentColor: 'var(--vk-marigold)' }} />
          วันหยุดนักขัตฤกษ์ (OT ×2)
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 0, flex: 1 }}>
        {/* Pool */}
        <div style={{ borderRight: '1px solid var(--vk-rule)', padding: '20px 16px', background: 'var(--vk-bone)' }}>
          <div className="vk-eyebrow" style={{ marginBottom: 12 }}>POOL · ยังไม่ได้กรอก ({pool.length})</div>
          <hr className="vk-rule-soft" style={{ marginBottom: 12 }} />
          {pool.length === 0 ? (
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)', padding: '12px 0' }}>กรอกครบทุกคนแล้ว ✓</div>
          ) : pool.map(emp => (
            <div key={emp.id}
              onClick={() => setSelected(s => s?.id === emp.id ? null : emp)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 4, borderRadius: 4, cursor: 'pointer', background: selected?.id === emp.id ? 'var(--vk-persimmon-tint)' : 'transparent', border: `1px solid ${selected?.id === emp.id ? 'var(--vk-persimmon)' : 'transparent'}`, transition: 'all 120ms' }}>
              <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)' }}>{emp.employee_code}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{emp.first_name} {emp.last_name}</span>
            </div>
          ))}
        </div>

        {/* Shift columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '20px 24px', gap: 16 }}>
          {SHIFTS.map(sh => {
            const shiftEmps = assignments.filter(a => a.shift_type === sh.key)
              .map(a => employees.find(e => e.id === a.employee_id)).filter(Boolean) as Employee[]
            const canDrop = !!selected
            return (
              <div key={sh.key}
                onClick={() => { if (selected) saveMutation.mutate({ emp: selected, shiftKey: sh.key }) }}
                style={{ background: 'var(--vk-bone)', border: `1px solid ${canDrop ? 'var(--vk-persimmon)' : 'var(--vk-rule-soft)'}`, padding: 16, minHeight: 180, cursor: canDrop ? 'pointer' : 'default', transition: 'border-color 160ms', borderRadius: 4 }}>
                <div className="vk-eyebrow" style={{ color: 'var(--vk-persimmon-ink)', marginBottom: 2 }}>{sh.label}</div>
                <div style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', marginBottom: 14 }}>{sh.hours}</div>
                {shiftEmps.map(emp => (
                  <div key={emp.id}
                    onClick={e => { e.stopPropagation(); removeMutation.mutate(emp.id) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', borderRadius: 999, fontSize: 12, fontWeight: 500, marginRight: 5, marginBottom: 5, cursor: 'pointer' }}>
                    <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-3)' }}>{emp.employee_code}</span>
                    {emp.first_name}
                    <span style={{ color: 'var(--vk-ink-3)', fontSize: 11 }}>×</span>
                  </div>
                ))}
                {canDrop && (
                  <div style={{ marginTop: 10, padding: 8, border: '1px dashed var(--vk-persimmon)', borderRadius: 4, color: 'var(--vk-persimmon-ink)', fontSize: 12, textAlign: 'center' }}>
                    + วางที่นี่
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--vk-ink)', color: 'var(--vk-bone)', padding: '10px 20px', borderRadius: 999, fontSize: 13, fontFamily: 'var(--vk-sans)', fontWeight: 500, display: 'flex', gap: 14, alignItems: 'center', zIndex: 100 }}>
          เลือก <b>{selected.first_name} {selected.last_name}</b> — คลิกที่กะที่ต้องการ
          <span style={{ cursor: 'pointer', opacity: 0.7, fontSize: 16 }} onClick={() => setSelected(null)}>×</span>
        </div>
      )}
    </div>
  )
}
