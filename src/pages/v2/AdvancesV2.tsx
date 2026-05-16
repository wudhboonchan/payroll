import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/v2-tokens.css'

function fmtNationality(nationality: string | null) {
  if (!nationality || nationality === 'ไทย') return null
  if (nationality === 'เมียนมา' || nationality.toLowerCase().includes('myanmar') || nationality.toLowerCase().includes('burma')) return 'เมียนมา/กะเหรี่ยง'
  return nationality
}

export default function AdvancesV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingEmp, setEditingEmp] = useState<{ employee_code: string; first_name: string; last_name: string; nationality?: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', amount: '', notes: '' })

  const isEdit = !!editingId

  const openCreate = () => {
    setEditingId(null)
    setForm({ employee_id: '', amount: '', notes: '' })
    setIsModalOpen(true)
  }

  const openEdit = (a: any) => {
    setEditingId(a.id)
    // employee_id may come from the row directly or from the joined employee object
    const empId = a.employee_id || ''
    setForm({ employee_id: empId, amount: String(a.amount), notes: a.notes || '' })
    setEditingEmp(a.employee as any)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setEditingEmp(null)
    setForm({ employee_id: '', amount: '', notes: '' })
  }

  const { data: periods = [] } = useQuery<any[]>({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('factory_id', user?.factory_id ?? '').order('period_start', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })
  const currentPeriod = periods[0]

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
      const { data, error } = await supabase.from('advance_payments').select('id,employee_id,amount,notes,created_at,employee:employees(employee_code,first_name,last_name,nationality)').eq('period_id', currentPeriod.id).order('created_at', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!currentPeriod,
  })

  const totalAdv = advances.reduce((s, a) => s + Number(a.amount), 0)

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('advance_payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['advances-v2'] }); toast.success('ลบรายการแล้ว') },
  })

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="เบิกล่วงหน้า" subtitle={currentPeriod?.label} onMenuClick={onMenuClick} />

      <div className="vk-page">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12 }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>ADVANCES · เบิกล่วงหน้า</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              รวม <span style={{ fontFamily: 'var(--vk-mono)', color: 'var(--vk-crimson)' }}>฿ {totalAdv.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          <button className="vk-btn vk-btn--primary" onClick={openCreate} disabled={!currentPeriod}>
            <Plus style={{ width: 15, height: 15 }} /> เพิ่มรายการ
          </button>
        </div>

        <hr className="vk-rule" />
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['รหัส','ชื่อ–นามสกุล','หมายเหตุ','จำนวนเงิน',''].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)', padding: '12px 14px', borderBottom: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {advances.map(a => {
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
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }}
                        onClick={e => { e.stopPropagation(); openEdit(a) }}>
                        <Pencil style={{ width: 13, height: 13, color: 'var(--vk-ink-3)' }} />
                      </button>
                      <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }}
                        onClick={e => { e.stopPropagation(); setDeleteTarget({ id: a.id, name: `${a.employee?.first_name ?? ''} ${a.employee?.last_name ?? ''}`.trim() }) }}>
                        <Trash2 style={{ width: 13, height: 13, color: 'var(--vk-crimson)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {advances.length === 0 && <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีรายการเบิกล่วงหน้า</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="vk-root" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeModal}>
          <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 400, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ background: 'var(--vk-persimmon)', color: 'var(--vk-bone)', padding: '16px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{isEdit ? 'แก้ไขรายการเบิกล่วงหน้า' : 'เพิ่มรายการเบิกล่วงหน้า'}</div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{isEdit ? 'แก้ไขจำนวนเงินหรือหมายเหตุ' : 'กรอกข้อมูลพนักงานและจำนวนเงิน'}</div>
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
                  <select className="vk-input" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                    <option value="">-- เลือกพนักงาน --</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}{fmtNationality(e.nationality) ? ` (${fmtNationality(e.nationality)})` : ''}</option>)}
                  </select>
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
