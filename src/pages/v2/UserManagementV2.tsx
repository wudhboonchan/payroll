import { useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/v2-tokens.css'

const tempClient = createClient(
  `${window.location.origin}/supabase-api`,
  import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

export default function UserManagementV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', factory_id: '' })
  const [formError, setFormError] = useState('')

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id,full_name,role,factory_id,factory:factories(name)').eq('role','normalUser').order('full_name')
      if (error) throw error; return data
    },
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
      if (form.password.length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({ email: form.email, password: form.password })
      if (signUpError) throw signUpError
      if (!signUpData.user) throw new Error('ไม่สามารถสร้างบัญชีได้')
      const { error: profileError } = await supabase.from('profiles').upsert({ id: signUpData.user.id, full_name: form.full_name, role: 'normalUser', factory_id: form.factory_id })
      if (profileError) throw profileError
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-profiles'] }); toast.success('สร้างผู้ใช้เรียบร้อยแล้ว'); setIsModalOpen(false); setForm({ email:'',password:'',full_name:'',factory_id:'' }) },
    onError: (e: Error) => setFormError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-profiles'] }); toast.success('ลบผู้ใช้แล้ว') },
    onError: (e: Error) => toast.error('ลบไม่สำเร็จ', { description: e.message }),
  })

  if (user?.role !== 'admin') return null

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="จัดการผู้ใช้งาน" onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px', maxWidth: 760 }}>
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
                    {(p.factory as any)?.name || 'ไม่ระบุโรงงาน'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="vk-pill">User</span>
                <button className="vk-btn vk-btn--ghost" style={{ width: 30, height: 30, padding: 0 }}
                  onClick={() => { if (window.confirm(`ยืนยันการลบ "${p.full_name}"?`)) deleteMutation.mutate(p.id) }}
                  disabled={deleteMutation.isPending}>
                  <Trash2 style={{ width: 13, height: 13, color: 'var(--vk-crimson)' }} />
                </button>
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
                { label: 'รหัสผ่าน', key: 'password', placeholder: 'อย่างน้อย 6 ตัวอักษร', type: 'password' },
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
    </div>
  )
}
