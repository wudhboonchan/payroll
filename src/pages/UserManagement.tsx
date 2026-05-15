import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { toast } from 'sonner'
import { Plus, Trash2, X, Users, Building2 } from 'lucide-react'

interface Profile {
  id: string
  full_name: string | null
  role: string | null
  factory_id: string | null
  factory?: { name: string } | null
}

interface Factory {
  id: string
  name: string
}

// Separate client with no session persistence — for creating users without affecting admin session
const tempClient = createClient(
  `${window.location.origin}/supabase-api`,
  import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

export default function UserManagement() {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', factory_id: '' })
  const [formError, setFormError] = useState('')

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, factory_id, factory:factories(name)')
        .eq('role', 'normalUser')
        .order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const { data: factories = [] } = useQuery({
    queryKey: ['all-factories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factories')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data as Factory[]
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      setFormError('')
      if (!form.email || !form.password || !form.full_name || !form.factory_id) {
        throw new Error('กรุณากรอกข้อมูลให้ครบทุกช่อง')
      }
      if (form.password.length < 6) {
        throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      }

      // Sign up via temp client (won't affect current admin session)
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
        email: form.email,
        password: form.password,
      })
      if (signUpError) throw signUpError
      if (!signUpData.user) throw new Error('ไม่สามารถสร้างบัญชีได้')

      // Upsert profile
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: signUpData.user.id,
          full_name: form.full_name,
          role: 'normalUser',
          factory_id: form.factory_id,
        })
      if (profileError) throw profileError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
      toast.success('สร้างผู้ใช้เรียบร้อยแล้ว')
      setIsModalOpen(false)
      setForm({ email: '', password: '', full_name: '', factory_id: '' })
    },
    onError: (e: Error) => {
      setFormError(e.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profileId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profiles'] })
      toast.success('ลบผู้ใช้เรียบร้อยแล้ว')
    },
    onError: (e: Error) => toast.error('ลบไม่สำเร็จ', { description: e.message }),
  })

  const handleDelete = (p: Profile) => {
    if (!window.confirm(`ยืนยันการลบผู้ใช้ "${p.full_name || p.id}"?\n\nผู้ใช้จะไม่สามารถล็อกอินได้อีก`)) return
    deleteMutation.mutate(p.id)
  }

  if (user?.role !== 'admin') {
    return null
  }

  const roleLabel = (role: string | null) => {
    if (role === 'superUser') return { label: 'SuperAdmin', cls: 'bg-purple-100 text-purple-700 border-purple-200' }
    return { label: 'User', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  }

  return (
    <>
      <TopBar title="จัดการผู้ใช้งาน" />

      <div className="p-4 md:p-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-slate-500">ผู้ใช้งานระดับ User และ SuperAdmin ทั้งหมด ({profiles.length} คน)</p>
          <Button
            onClick={() => { setFormError(''); setIsModalOpen(true) }}
            className="bg-[#1D9E75] hover:bg-[#157a5a] h-10 px-5"
          >
            <Plus className="w-4 h-4 mr-2" />
            เพิ่มผู้ใช้ใหม่
          </Button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm">กำลังโหลด...</div>
          ) : profiles.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              ยังไม่มีผู้ใช้งาน
            </div>
          ) : (
            profiles.map(p => {
              const { label, cls } = roleLabel(p.role)
              return (
                <div key={p.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-slate-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 text-sm">{p.full_name || '—'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        <span className="text-xs text-slate-500">
                          {(p.factory as any)?.name || 'ไม่ระบุโรงงาน'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={`text-xs ${cls}`}>{label}</Badge>
                    {p.role !== 'superUser' && (
                      <button
                        onClick={() => handleDelete(p)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Create User Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">เพิ่มผู้ใช้งานใหม่</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">ชื่อ-นามสกุล <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="เช่น สมชาย ใจดี"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">อีเมล <span className="text-red-500">*</span></Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">รหัสผ่าน <span className="text-red-500">*</span></Label>
                <Input
                  type="password"
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">โรงงาน <span className="text-red-500">*</span></Label>
                <select
                  value={form.factory_id}
                  onChange={e => setForm(f => ({ ...f, factory_id: e.target.value }))}
                  className="w-full h-9 border border-slate-200 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30"
                >
                  <option value="">-- เลือกโรงงาน --</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
            )}

            <Button
              className="w-full bg-[#1D9E75] hover:bg-[#157a5a]"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
