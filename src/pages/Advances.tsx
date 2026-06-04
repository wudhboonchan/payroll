import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState } from 'react'
import { Plus, Trash2, Pencil, AlertTriangle, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import '../styles/tokens.css'

function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return null
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา/กะเหรี่ยง'
  return nationality
}

export default function Advances() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'advance' | 'carryover'>('advance')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingEmp, setEditingEmp] = useState<{ employee_code: string; first_name: string; last_name: string; nationality?: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', amount: '', notes: '' })
  const [empSearch, setEmpSearch] = useState('')

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
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name,nationality').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const { data: advances = [] } = useQuery<any[]>({
    queryKey: ['advances-v2', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod) return []
      const { data, error } = await supabase.from('advance_payments').select('id,employee_id,amount,notes,is_carryover,created_at,employee:employees(employee_code,first_name,last_name,nationality)').eq('period_id', currentPeriod.id).order('is_carryover', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!currentPeriod,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      queryClient.invalidateQueries({ queryKey: ['advances'] })
      toast.success(`บันทึกยอดตกค้าง ${pendingCarryovers.length} รายการแล้ว`)
    },
    onError: (e: Error) => toast.error('บันทึกไม่สำเร็จ', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('advance_payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['advances-v2'] }); toast.success('ลบรายการแล้ว') },
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
          <div style={{ display: 'flex', gap: 8 }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: 90 }} />
            <col />
            <col />
            <col style={{ width: 160 }} />
            <col style={{ width: 80 }} />
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
                      <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14, color: '#78350f' }}>
                        {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                      </td>
                      <td style={{ padding: '13px 14px', fontSize: 13, color: '#92400e', fontStyle: 'italic' }}>ยอดเบิกเกินค้างจากงวดก่อน</td>
                      <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: '#b45309', fontWeight: 700 }}>
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
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14, color: '#78350f' }}>
                    {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: '#92400e' }}>{a.notes || '—'}</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: '#b45309', fontWeight: 700 }}>
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
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14 }}>
                    {emp?.first_name} {emp?.last_name}{fmtNationality(emp?.nationality) ? ` (${fmtNationality(emp?.nationality)})` : ''}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)' }}>{a.notes || '—'}</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-crimson)' }}>
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
