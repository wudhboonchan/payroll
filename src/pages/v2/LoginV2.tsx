import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { toast } from 'sonner'
import '../../styles/v2-tokens.css'

export default function LoginV2() {
  const navigate = useNavigate()
  const { user } = useAppStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) navigate(user.role === 'normalUser' ? '/payslip' : '/dashboard', { replace: true })
  }, [user, navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { toast.error('เข้าสู่ระบบล้มเหลว', { description: error.message }); return }
      toast.success('เข้าสู่ระบบสำเร็จ')
    } catch { toast.error('เกิดข้อผิดพลาด') } finally { setLoading(false) }
  }

  const Logo = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 28, height: 28, background: 'var(--vk-persimmon)', borderRadius: 4, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" fill="none" viewBox="0 0 14 14">
          <rect x="1" y="1" width="5" height="5" rx="1" fill="white"/>
          <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity=".6"/>
          <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity=".6"/>
          <rect x="8" y="8" width="5" height="5" rx="1" fill="white" opacity=".3"/>
        </svg>
      </div>
      <span style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
        VIRANKORN · PAYROLL
      </span>
    </div>
  )

  return (
    <div className="vk-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Desktop layout ── */}
      <div className="hidden md:flex" style={{ flex: 1 }}>
        {/* Left panel — dark warm */}
        <div style={{
          width: '52%', background: 'var(--vk-ink-2)', flexShrink: 0,
          padding: '48px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          <div style={{ color: 'var(--vk-bone)' }}>
            <Logo />
          </div>

          <div>
            <div className="vk-eyebrow" style={{ color: 'var(--vk-persimmon)', marginBottom: 24 }}>PAYROLL MANAGEMENT SYSTEM</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 52, lineHeight: 1.1, color: 'var(--vk-bone)', letterSpacing: '-0.025em', marginBottom: 16 }}>
              หจก.<br />วิราญกร
            </div>
            <div style={{ fontFamily: 'var(--vk-thai)', fontSize: 18, color: 'var(--vk-ink-4)', lineHeight: 1.5 }}>
              ระบบจัดการค่าแรงพนักงาน
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)', letterSpacing: '0.08em' }}>
              หจก. วิราญกร · ระบบจัดการค่าแรง
            </span>
            <span style={{ fontFamily: 'var(--vk-mono)', fontSize: 11, color: 'var(--vk-ink-3)' }}>v 2.0</span>
          </div>
        </div>

        {/* Right panel — form */}
        <div style={{ flex: 1, background: 'var(--vk-paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
          <div style={{ width: '100%', maxWidth: 360 }}>
            <div className="vk-eyebrow" style={{ marginBottom: 6 }}>SIGN IN · เข้าสู่ระบบ</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 32, letterSpacing: '-0.02em', color: 'var(--vk-ink)', marginBottom: 32, lineHeight: 1.2 }}>
              ยินดีต้อนรับ<br />
              <span style={{ color: 'var(--vk-persimmon)' }}>อีกครั้ง</span>
            </div>
            <LoginForm email={email} setEmail={setEmail} password={password} setPassword={setPassword} loading={loading} onSubmit={handleLogin} />
          </div>
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <div className="flex flex-col md:hidden" style={{ flex: 1 }}>
        {/* Top brand strip */}
        <div style={{
          background: 'var(--vk-ink-2)',
          padding: '28px 24px 36px',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          <div style={{ color: 'var(--vk-bone)' }}>
            <Logo />
          </div>
          <div>
            <div className="vk-eyebrow" style={{ color: 'var(--vk-persimmon)', marginBottom: 10 }}>PAYROLL MANAGEMENT SYSTEM</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 34, lineHeight: 1.1, color: 'var(--vk-bone)', letterSpacing: '-0.025em' }}>
              หจก. วิราญกร
            </div>
            <div style={{ fontFamily: 'var(--vk-thai)', fontSize: 15, color: 'var(--vk-ink-4)', marginTop: 6 }}>
              ระบบจัดการค่าแรงพนักงาน
            </div>
          </div>
        </div>

        {/* Form card lifted over the dark strip */}
        <div style={{
          flex: 1,
          background: 'var(--vk-paper)',
          borderRadius: '20px 20px 0 0',
          marginTop: -16,
          padding: '32px 24px 40px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div className="vk-eyebrow" style={{ marginBottom: 4 }}>SIGN IN · เข้าสู่ระบบ</div>
          <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--vk-ink)', marginBottom: 28, lineHeight: 1.2 }}>
            ยินดีต้อนรับ <span style={{ color: 'var(--vk-persimmon)' }}>อีกครั้ง</span>
          </div>
          <LoginForm email={email} setEmail={setEmail} password={password} setPassword={setPassword} loading={loading} onSubmit={handleLogin} />
          <div style={{ flex: 1 }} />
          <p style={{ fontFamily: 'var(--vk-mono)', fontSize: 10, color: 'var(--vk-ink-4)', textAlign: 'center', letterSpacing: '0.06em', marginTop: 32 }}>
            VIRANKORN PAYROLL · v 2.0
          </p>
        </div>
      </div>

    </div>
  )
}

function LoginForm({ email, setEmail, password, setPassword, loading, onSubmit }: {
  email: string; setEmail: (v: string) => void
  password: string; setPassword: (v: string) => void
  loading: boolean; onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 6 }}>อีเมล</label>
        <input className="vk-input" type="email" placeholder="email@virankorn.co.th"
          value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="vk-eyebrow" style={{ display: 'block', marginBottom: 6 }}>รหัสผ่าน</label>
        <input className="vk-input" type="password" placeholder="••••••••"
          value={password} onChange={e => setPassword(e.target.value)} required />
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--vk-rule-soft)', margin: '4px 0' }} />

      <button type="submit" className="vk-btn vk-btn--primary" disabled={loading}
        style={{ width: '100%', height: 44, fontSize: 15, borderRadius: 8 }}>
        {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
      </button>

      <p className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 4, textAlign: 'center' }}>
        ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ
      </p>
    </form>
  )
}
