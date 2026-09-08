import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import EmployeeFormModal from './EmployeeFormModal'
import EmployeeImportModal from './EmployeeImportModal'
import { Plus, Upload, Search, AlertCircle, UserX, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { isTpiCompany } from '../features/tpi/model'
import { formatEmployeeFullName, compareEmployeeCode } from '../lib/formatters'
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

type SortCol = 'employee_code' | 'name' | 'nationality' | 'rate' | 'position'

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

  const [searchTerm, setSearchTerm] = useState('')
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [showInactiveOnly, setShowInactiveOnly] = useState(false)
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
    const map = new Map<string, { rate_tier: string; skilled_from: string | null }>()
    for (const p of (tpiProfiles || [])) {
      map.set(p.employee_id, { rate_tier: p.rate_tier, skilled_from: p.skilled_from })
    }
    return map
  }, [tpiProfiles])

  const pendingCount  = employees.filter(e => e.data_complete === false).length
  const inactiveCount = employees.filter(e => e.status === 'inactive').length

  const filtered = employees.filter(emp => {
    const matchesSearch =
      (emp.employee_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
    if (showPendingOnly)  return matchesSearch && emp.data_complete === false
    if (showInactiveOnly) return matchesSearch && emp.status === 'inactive'
    if (!searchTerm.trim() && emp.status === 'inactive') return false
    return matchesSearch
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortCol === 'employee_code') {
      const cmp = compareEmployeeCode(a.employee_code, b.employee_code)
      return sortAsc ? cmp : -cmp
    }
    let vA: string | number = '', vB: string | number = ''
    if (sortCol === 'name')     { vA = `${a.first_name} ${a.last_name}`; vB = `${b.first_name} ${b.last_name}` }
    else if (sortCol === 'nationality') { vA = a.nationality||''; vB = b.nationality||'' }
    else if (sortCol === 'rate')     { vA = Number(a.rate_per_12h); vB = Number(b.rate_per_12h) }
    else if (sortCol === 'position') { vA = a.position||''; vB = b.position||'' }
    if (vA < vB) return sortAsc ? -1 : 1
    if (vA > vB) return sortAsc ? 1 : -1
    return 0
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

  const activeLabel = showPendingOnly ? `ข้อมูลไม่ครบ (${pendingCount})` : showInactiveOnly ? `พ้นสภาพ (${inactiveCount})` : `ปกติ (${filtered.length})`

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

        {/* Filters — row 2: filter buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => { setShowPendingOnly(p => !p); setShowInactiveOnly(false) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
              fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
              border: `1px solid ${showPendingOnly ? 'var(--vk-marigold)' : 'var(--vk-rule-soft)'}`,
              borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
              background: showPendingOnly ? 'var(--vk-marigold-tint)' : 'var(--vk-bone)',
              color: showPendingOnly ? '#6F4A0E' : 'var(--vk-ink-2)',
            }}>
            <AlertCircle style={{ width: 13, height: 13 }} />
            ข้อมูลไม่ครบ
            {pendingCount > 0 && (
              <span style={{ background: 'var(--vk-marigold)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{pendingCount}</span>
            )}
          </button>
          <button
            onClick={() => { setShowInactiveOnly(p => !p); setShowPendingOnly(false) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
              fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 13,
              border: `1px solid ${showInactiveOnly ? 'var(--vk-ink-2)' : 'var(--vk-rule-soft)'}`,
              borderRadius: 'var(--vk-r2)', cursor: 'pointer', whiteSpace: 'nowrap',
              background: showInactiveOnly ? 'var(--vk-ink-2)' : 'var(--vk-bone)',
              color: showInactiveOnly ? 'var(--vk-bone)' : 'var(--vk-ink-2)',
            }}>
            <UserX style={{ width: 13, height: 13 }} />
            พ้นสภาพ
            {inactiveCount > 0 && (
              <span style={{ background: showInactiveOnly ? 'rgba(255,255,255,0.25)' : 'var(--vk-ink-3)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '18px' }}>{inactiveCount}</span>
            )}
          </button>
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
                  { label: 'รหัส',           col: 'employee_code' as SortCol, align: 'left'  },
                  { label: 'ชื่อ–นามสกุล',   col: 'name'          as SortCol, align: 'left'  },
                  { label: 'กลุ่มงาน',        col: 'position'      as SortCol, align: 'left'  },
                  { label: 'ตำแหน่ง',         col: null,                        align: 'left'  },
                  { label: 'สัญชาติ',         col: 'nationality'   as SortCol, align: 'left'  },
                  { label: 'วิธีรับเงิน',     col: null,                        align: 'left'  },
                  { label: isTpi ? 'ประเภทค่าแรง' : 'ค่าจ้าง/เงินเดือน', col: isTpi ? null : ('rate' as SortCol), align: isTpi ? 'center' : 'right' },
                  { label: 'สถานะ',           col: null,                        align: 'right' },
                ].map((h, i) => (
                  <th key={i}
                    onClick={() => h.col && toggleSort(h.col)}
                    style={{
                      textAlign: h.align as any,
                      fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11,
                      textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)',
                      padding: '12px 14px', borderBottom: '1px solid var(--vk-rule)',
                      background: 'var(--vk-paper)', cursor: h.col ? 'pointer' : 'default',
                      whiteSpace: 'nowrap', userSelect: 'none',
                    }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {h.label}{h.col && <SortIcon col={h.col} />}
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
                      {emp.is_safety_officer && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }} title="เจ้าหน้าที่ความปลอดภัย (จป.) +500/เดือน">
                          จป.
                        </span>
                      )}
                      {emp.has_position_allowance && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }} title="มีค่าตำแหน่ง +1,000/เดือน">
                          ค่าตำแหน่ง
                        </span>
                      )}
                      {emp.nationality !== 'ไทย' && !emp.national_id && !emp.social_security_number ? (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }} title="ยังไม่มีเลข ปกส (ไม่หัก)">
                          รอ ปกส
                        </span>
                      ) : null}
                      {emp.exempt_social_security && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }} title="ได้รับการยกเว้นไม่ต้องหักประกันสังคม">
                          ยกเว้น ปกส
                        </span>
                      )}
                      {emp.data_complete === false && (emp.nationality === 'ไทย' || emp.national_id || emp.social_security_number) && (
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
                    {emp.job_title || '—'}
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
                      tpiProfileMap.get(emp.id)?.rate_tier === 'skilled' ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>
                          ค่าแรงฝีมือ
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
                          ค่าแรงปกติ
                        </span>
                      )
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
