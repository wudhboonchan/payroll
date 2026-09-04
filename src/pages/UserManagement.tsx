import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import '../styles/tokens.css'

const ROLE_PRIORITY: Record<string, number> = {
  superUser: 0,
  admin: 1,
  normalUser: 2,
}

export default function UserManagement() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', factory_id: '', role: 'normalUser' })
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; full_name: string | null; role: string | null } | null>(null)

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id,full_name,role,factory_id,factory:factories(name)').order('full_name')
      if (error) throw error
      return [...(data ?? [])].sort((a, b) => {
        const roleDifference = (ROLE_PRIORITY[a.role ?? ''] ?? 99) - (ROLE_PRIORITY[b.role ?? ''] ?? 99)
        if (roleDifference !== 0) return roleDifference
        return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'th')
      })
    },
    staleTime: 0,
  })

  const { data: factories = [] } = useQuery<any[]>({
    queryKey: ['all-factories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('id,name').order('name')
      if (error) throw error; return data
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      setFormError('')
      if (!form.email || !form.password || !form.full_name || !form.factory_id) throw new Error('กรุณากรอกข้อมูลให้ครบทุกช่อง')
      if (form.password.length < 8) throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
      const response = await fetch('/api/admin-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'ไม่สามารถสร้างบัญชีได้')
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['user-profiles'] })
      toast.success('สร้างผู้ใช้เรียบร้อยแล้ว')
      setIsModalOpen(false)
      setForm({ email: '', password: '', full_name: '', factory_id: '', role: 'normalUser' })
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
      const response = await fetch('/api/admin-users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'ลบผู้ใช้ไม่สำเร็จ')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
      toast.success('ลบผู้ใช้แล้ว')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('ลบไม่สำเร็จ', { description: e.message }),
  })

  if (user?.role !== 'admin' && user?.role !== 'superUser') return null

  return (
    <>
      <TopBar title="จัดการผู้ใช้งาน" onMenuClick={onMenuClick} />

      <div className="vk-page" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>USER MANAGEMENT · จัดการผู้ใช้งาน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              ผู้ใช้งานทั้งหมด <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 600, color: 'var(--vk-ink-3)', fontSize: 20 }}>{profiles.length} คน</span>
            </div>
          </div>
          <button className="vk-btn vk-btn--primary" onClick={() => { setFormError(''); setIsModalOpen(true) }}>
            <Plus style={{ width: 15, height: 15 }} /> เพิ่มผู้ใช้ใหม่
          </button>
        </div>

        <div style={{ border: '1px solid var(--vk-rule)', background: 'var(--vk-bone)' }}>
          {profiles.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center' }} className="vk-eyebrow">ยังไม่มีผู้ใช้งาน</div>
          ) : profiles.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: i < profiles.length-1 ? '1px solid var(--vk-rule-soft)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--vk-persimmon-tint)', color: 'var(--vk-persimmon-ink)', display: 'grid', placeItems: 'center', fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {p.full_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.full_name || '—'}</div>
                  <div style={{ fontFamily: 'var(--vk-sans)', fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 1 }}>
                    {p.role === 'superUser' ? 'ทุกโรงงาน' : (p.factory as any)?.name || 'ไม่ระบุโรงงาน'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="vk-pill">{p.role === 'superUser' ? 'ผู้ดูแลระบบสูงสุด' : p.role === 'admin' ? 'ผู้ดูแลโรงงาน' : p.role === 'normalUser' ? 'ผู้ใช้ทั่วไป' : 'บทบาทไม่ถูกต้อง'}</span>
                {(p.role === 'normalUser' || (user?.role === 'superUser' && p.role === 'admin')) && p.id !== user?.id && <button aria-label={`ลบผู้ใช้ ${p.full_name || ''}`} className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }}
                  onClick={() => setDeleteTarget({ id: p.id, full_name: p.full_name, role: p.role })}
                  disabled={deleteMutation.isPending}>
                  <Trash2 style={{ width: 13, height: 13, color: 'var(--vk-crimson)' }} />
                </button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,19,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setIsModalOpen(false)}>
          <div style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule)', padding: '32px', width: '100%', maxWidth: 400 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>เพิ่มผู้ใช้งานใหม่</div>
              <button className="vk-btn vk-btn--ghost" style={{ width: 28, height: 28, padding: 0 }} onClick={() => setIsModalOpen(false)}><X style={{ width: 15, height: 15 }} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'ชื่อ-นามสกุล', key: 'full_name', placeholder: 'เช่น สมชาย ใจดี', type: 'text' },
                { label: 'อีเมล', key: 'email', placeholder: 'email@example.com', type: 'email' },
                { label: 'รหัสผ่าน', key: 'password', placeholder: 'อย่างน้อย 8 ตัวอักษร', type: 'password' },
              ].map(f => (
                <div key={f.key}>
                  <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>{f.label} <span style={{ color: 'var(--vk-crimson)' }}>*</span></label>
                  <input className="vk-input" type={f.type} placeholder={f.placeholder} value={(form as any)[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>โรงงาน <span style={{ color: 'var(--vk-crimson)' }}>*</span></label>
                <select className="vk-input" value={form.factory_id} onChange={e => setForm(f => ({ ...f, factory_id: e.target.value }))}>
                  <option value="">-- เลือกโรงงาน --</option>
                  {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              {user?.role === 'superUser' && (
                <div>
                  <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 5 }}>ระดับผู้ใช้งาน <span style={{ color: 'var(--vk-crimson)' }}>*</span></label>
                  <select className="vk-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="normalUser">ผู้ใช้ทั่วไป</option>
                    <option value="admin">ผู้ดูแลโรงงาน</option>
                  </select>
                </div>
              )}
            </div>
            {formError && <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--vk-crimson-tint)', border: '1px solid var(--vk-crimson)', fontSize: 13, color: 'var(--vk-crimson)' }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="vk-btn vk-btn--primary" style={{ flex: 1 }} disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
              </button>
              <button className="vk-btn" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(22,19,17,0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!deleteMutation.isPending) setDeleteTarget(null) }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" aria-describedby="delete-user-description"
            style={{ background: 'var(--vk-bone)', border: '1px solid var(--vk-rule)', width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(22,19,17,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '24px 24px 18px', borderBottom: '1px solid var(--vk-rule-soft)' }}>
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--vk-crimson-tint)', color: 'var(--vk-crimson)' }}>
                  <Trash2 style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <div className="vk-eyebrow" style={{ color: 'var(--vk-crimson)', marginBottom: 4 }}>DELETE USER · ลบบัญชีผู้ใช้</div>
                  <div id="delete-user-title" style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 20, color: 'var(--vk-ink)' }}>ยืนยันการลบบัญชี</div>
                </div>
              </div>
              <button aria-label="ปิด" className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0, flexShrink: 0 }}
                onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>

            <div style={{ padding: '20px 24px 24px' }}>
              <div style={{ padding: '14px 16px', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule-soft)', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--vk-ink)' }}>{deleteTarget.full_name || 'ไม่ระบุชื่อ'}</div>
                <div style={{ fontSize: 12, color: 'var(--vk-ink-3)', marginTop: 3 }}>
                  {deleteTarget.role === 'admin' ? 'ผู้ดูแลโรงงาน' : 'ผู้ใช้ทั่วไป'}
                </div>
              </div>
              <p id="delete-user-description" style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--vk-ink-2)' }}>
                บัญชีนี้จะไม่สามารถเข้าสู่ระบบได้อีก และการลบไม่สามารถย้อนกลับได้
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
                <button className="vk-btn" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>ยกเลิก</button>
                <button className="vk-btn" style={{ background: 'var(--vk-crimson)', borderColor: 'var(--vk-crimson)', color: '#fff' }}
                  onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
                  <Trash2 style={{ width: 14, height: 14 }} />
                  {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบบัญชี'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
