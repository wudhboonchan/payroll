import { useOutletContext } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { toast } from 'sonner'
import { Plus, Search } from 'lucide-react'
import '../../styles/v2-tokens.css'

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string
  rate_per_12h: number; payment_method: string; bank_name: string | null
  bank_account: string | null; status: string; nationality: string | null
}

export default function EmployeesV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()
  const { user } = useAppStore()
  const [q, setQ] = useState('')

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_code,first_name,last_name,rate_per_12h,payment_method,bank_name,bank_account,status,nationality')
        .eq('factory_id', user?.factory_id ?? '').order('employee_code')
      if (error) throw error
      return data
    },
    enabled: !!user?.factory_id,
  })

  const filtered = employees.filter(e =>
    !q || `${e.first_name}${e.last_name}${e.employee_code}`.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="ฐานข้อมูลพนักงาน" subtitle={`${employees.length} คน`} onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="vk-eyebrow" style={{ marginBottom: 4 }}>EMPLOYEES · ฐานข้อมูลพนักงาน</div>
            <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
              พนักงาน <span style={{ fontWeight: 400, color: 'var(--vk-ink-3)' }}>ทั้งหมด</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--vk-ink-3)' }} />
              <input className="vk-input" placeholder="ค้นหาชื่อหรือรหัส" value={q} onChange={e => setQ(e.target.value)}
                style={{ paddingLeft: 32, width: 220, height: 34, fontSize: 13 }} />
            </div>
          </div>
        </div>

        <hr className="vk-rule" />

        {isLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }} className="vk-eyebrow">กำลังโหลด...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['รหัส','ชื่อ–นามสกุล','สัญชาติ','วิธีรับเงิน','ธนาคาร · บัญชี','ค่าจ้าง/12ชม.','สถานะ'].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 5 ? 'right' : 'left', fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--vk-ink-3)', padding: '12px 14px', borderBottom: '1px solid var(--vk-rule)', background: 'var(--vk-paper)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--vk-rule-soft)' }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--vk-bone-2)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '14px', fontFamily: 'var(--vk-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{e.employee_code}</td>
                  <td style={{ padding: '14px', fontWeight: 600, fontSize: 14 }}>{e.first_name} {e.last_name}</td>
                  <td style={{ padding: '14px', fontSize: 13, color: 'var(--vk-ink-3)' }}>{e.nationality || 'ไทย'}</td>
                  <td style={{ padding: '14px', fontSize: 13, color: 'var(--vk-ink-3)' }}>{e.payment_method === 'bank' ? 'โอนธนาคาร' : 'เงินสด'}</td>
                  <td style={{ padding: '14px', fontSize: 13, color: 'var(--vk-ink-3)', fontFamily: 'var(--vk-mono)', fontSize: 12 }}>
                    {e.payment_method === 'bank' ? `${e.bank_name || '—'} · ${e.bank_account || '—'}` : '—'}
                  </td>
                  <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--vk-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {Number(e.rate_per_12h).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '14px', textAlign: 'right' }}>
                    <span className="vk-pill" data-tone={e.status === 'active' ? 'approved' : 'draft'}>
                      ● {e.status === 'active' ? 'ทำงาน' : 'ลาออก'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
