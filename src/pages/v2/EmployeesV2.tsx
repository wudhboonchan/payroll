import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import EmployeeFormModal from './EmployeeFormModalV2'
import EmployeeImportModalV2 from './EmployeeImportModalV2'
import { Plus, Upload, Search, AlertCircle, UserX, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import '../../styles/v2-tokens.css'

function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return 'ไทย'
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา/กะเหรี่ยง'
  return nationality
}

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string
  prefix: string | null; nationality: string | null; status: string
  rate_per_12h: number; payment_method: string; bank_name: string | null
  bank_account: string | null; position: string | null; job_title: string | null
  data_complete: boolean
}

type SortCol = 'employee_code' | 'name' | 'nationality' | 'rate' | 'position'

const POSITIONS: Record<string, string> = {
  worker: 'พนักงานทั่วไป', clerk: 'เสมียน', foreman: 'หัวหน้างาน',
  office: 'พนักงานออฟฟิศ', manager: 'ผู้จัดการ',
}

export default function EmployeesV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()

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
        .select('id,employee_code,first_name,last_name,prefix,nationality,status,rate_per_12h,payment_method,bank_name,bank_account,position,job_title,data_complete')
        .eq('factory_id', user?.factory_id ?? '').order('employee_code')
      if (error) throw error; return data
    },
    enabled: !!user?.factory_id,
    staleTime: 0,
  })

  const pendingCount  = employees.filter(e => e.data_complete === false).length
  const inactiveCount = employees.filter(e => e.status === 'inactive').length

  const filtered = employees.filter(emp => {
    const matchesSearch =
      emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(searchTerm.toLowerCase())
    if (showPendingOnly)  return matchesSearch && emp.data_complete === false
    if (showInactiveOnly) return matchesSearch && emp.status === 'inactive'
    if (!searchTerm.trim() && emp.status === 'inactive') return false
    return matchesSearch
  })

  const sorted = [...filtered].sort((a, b) => {
    let vA: string | number = '', vB: string | number = ''
    if (sortCol === 'employee_code') { vA = a.employee_code; vB = b.employee_code }
    else if (sortCol === 'name')     { vA = `${a.first_name} ${a.last_name}`; vB = `${b.first_name} ${b.last_name}` }
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
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="ฐานข้อมูลพนักงาน" subtitle={activeLabel} onMenuClick={onMenuClick} />

      <div className="vk-page">

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

        {/* Filters row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--vk-ink-3)' }} />
            <input className="vk-input" placeholder="ค้นหาชื่อหรือรหัสพนักงาน" value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 32, height: 36, fontSize: 13 }} />
          </div>

          {/* Pending filter */}
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

          {/* Inactive filter */}
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

        <hr className="vk-rule" />

        {isLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }} className="vk-eyebrow">กำลังโหลด...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div className="vk-eyebrow" style={{ marginBottom: 8 }}>ไม่พบพนักงาน</div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>ลองเปลี่ยนคำค้นหา หรือเพิ่มพนักงานใหม่</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  { label: 'รหัส',           col: 'employee_code' as SortCol, align: 'left'  },
                  { label: 'ชื่อ–นามสกุล',   col: 'name'          as SortCol, align: 'left'  },
                  { label: 'กลุ่มงาน',        col: 'position'      as SortCol, align: 'left'  },
                  { label: 'ตำแหน่ง',         col: null,                        align: 'left'  },
                  { label: 'สัญชาติ',         col: 'nationality'   as SortCol, align: 'left'  },
                  { label: 'วิธีรับเงิน',     col: null,                        align: 'left'  },
                  { label: 'ค่าจ้าง/เงินเดือน', col: 'rate'        as SortCol, align: 'right' },
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
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.prefix ? `${emp.prefix}` : ''}{emp.first_name} {emp.last_name}</div>
                    {emp.data_complete === false && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 11, color: '#6F4A0E', background: 'var(--vk-marigold-tint)', padding: '1px 7px', borderRadius: 999 }}>
                        <AlertCircle style={{ width: 10, height: 10 }} /> ข้อมูลไม่ครบ
                      </div>
                    )}
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
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', opacity: emp.status === 'inactive' ? 0.5 : 1 }}>
                    {Number(emp.rate_per_12h).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
      </div>

      {/* Reuse existing EmployeeFormModal — works the same as V1 */}
      {isModalOpen && (
        <EmployeeFormModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setSelectedEmployeeId(null) }}
          employeeId={selectedEmployeeId}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['employees'] }); queryClient.invalidateQueries({ queryKey: ['employees-all'] }) }}
        />
      )}

      <EmployeeImportModalV2
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
    </div>
  )
}
