import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/v2-tokens.css'

export default function AdvancesV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState({ employee_id: '', amount: '', note: '' })

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
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name').eq('factory_id', user?.factory_id ?? '').eq('status','active').order('employee_code')
      if (error) throw error; return data
    }, enabled: !!user?.factory_id,
  })

  const { data: advances = [] } = useQuery<any[]>({
    queryKey: ['advances-v2', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod) return []
      const { data, error } = await supabase.from('advance_payments').select('id,amount,note,created_at,employee:employees(employee_code,first_name,last_name)').eq('period_id', currentPeriod.id).order('created_at', { ascending: false })
      if (error) throw error; return data
    }, enabled: !!currentPeriod,
  })

  const totalAdv = advances.reduce((s, a) => s + Number(a.amount), 0)

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.employee_id || !form.amount) throw new Error('กรุณากรอกข้อมูลให้ครบ')
      const { error } = await supabase.from('advance_payments').insert({
        period_id: currentPeriod.id, employee_id: form.employee_id,
        amount: parseFloat(form.amount), note: form.note || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances-v2'] })
      toast.success('บันทึกการเบิกล่วงหน้าแล้ว')
      setIsModalOpen(false); setForm({ employee_id: '', amount: '', note: '' })
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

      <div style={{ padding: '28px 36px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12 }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>ADVANCES · เบิกล่วงหน้า</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              รวม <span style={{ fontFamily: 'var(--vk-mono)', color: 'var(--vk-crimson)' }}>฿ {totalAdv.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          <button className="vk-btn vk-btn--primary" onClick={() => setIsModalOpen(true)} disabled={!currentPeriod}>
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
                <tr key={a.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}>
                  <td style={{ padding: '13px 14px', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>{emp?.employee_code}</td>
                  <td style={{ padding: '13px 14px', fontWeight: 600, fontSize: 14 }}>{emp?.first_name} {emp?.last_name}</td>
                  <td style={{ padding: '13px 14px', fontSize: 13, color: 'var(--vk-ink-3)' }}>{a.note || '—'}</td>
                  <td style={{ padding: '13px 14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--vk-crimson)' }}>
                    – {Number(a.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={() => { if (window.confirm('ยืนยันการลบ?')) deleteMutation.mutate(a.id) }}>
                      <Trash2 style={{ width: 13, height: 13, color: 'var(--vk-crimson)' }} />
                    </button>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setIsModalOpen(false)}>
          <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule)', padding: '32px', width: '100%', maxWidth: 400 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', marginBottom: 24 }}>เพิ่มรายการเบิกล่วงหน้า</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>พนักงาน</label>
                <select className="vk-input" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">-- เลือกพนักงาน --</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} · {e.first_name} {e.last_name}</option>)}
                </select>
              </div>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>จำนวนเงิน (บาท)</label>
                <input className="vk-input vk-input--mono" type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>หมายเหตุ</label>
                <input className="vk-input" placeholder="เช่น ค่ารักษาพยาบาล" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }} disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button className="vk-btn" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
