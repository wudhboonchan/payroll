import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isTpiCompany } from './model'

type AuditEntry = {
  id: string; action: string; work_date: string; shift_index: number; created_at: string; changed_by: string | null
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null
  employee: { employee_code: string; first_name: string; last_name: string } | null
}

export function NonBillableAudit({ factoryId, start, end }: { factoryId: string; start: string; end: string }) {
  const { data: isTpi } = useQuery({
    queryKey: ['tpi-factory-boundary', factoryId],
    queryFn: async () => {
      const factory = await supabase.from('factories').select('name').eq('id', factoryId).single()
      if (factory.error) throw factory.error
      return isTpiCompany(factory.data.name)
    },
  })
  const { data = [], isPending, error } = useQuery({
    queryKey: ['tpi-non-billable-audit', factoryId, start, end],
    queryFn: async () => {
      const factory = await supabase.from('factories').select('name').eq('id', factoryId).single()
      if (factory.error) throw factory.error
      if (!isTpiCompany(factory.data.name)) return []
      const { data, error } = await supabase.from('tpi_non_billable_audit' as never)
        .select('*,employee:employees(employee_code,first_name,last_name)')
        .eq('factory_id', factoryId).gte('work_date', start).lte('work_date', end)
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as unknown as AuditEntry[]
    },
    enabled: isTpi === true,
    refetchInterval: 30_000,
  })
  if (isTpi !== true) return null
  return <section className="tpi-non-billable-panel" aria-label="แจ้งเตือนงานไม่ตั้งเบิก">
    <strong>งานไม่ตั้งเบิก สำหรับ SuperUser</strong>
    <small>ประวัติการบันทึกและการเปลี่ยนแปลงในงวด แสดงล่าสุดไม่เกิน 100 รายการ</small>
    {isPending ? <p role="status">กำลังโหลด...</p> : error ? <p role="alert">โหลดประวัติไม่สำเร็จ กรุณาตรวจโครงสร้างข้อมูลและสิทธิ์</p> : data.length === 0 ? <p>ยังไม่มีรายการในงวดนี้</p> : data.map(row => {
      const value = row.after_data || row.before_data || {}
      return <details key={row.id}><summary>{row.action === 'DELETE' ? 'ลบ' : row.action === 'UPDATE' ? 'แก้ไข' : 'บันทึก'} · {row.employee?.employee_code} {row.employee?.first_name} {row.employee?.last_name} · {row.work_date} · กะ {row.shift_index + 1} · ค่าแรง {Number(value.rate_snapshot || 0).toLocaleString()} บาท</summary>
        <p>{value.is_pending ? 'รอยืนยันเข้างาน' : 'ยืนยันเข้างานแล้ว'} · {String(value.position_snapshot || '')} · {String(value.non_billable_reason || '')} · ผู้รับต้นทุน: {String(value.cost_owner || '')}</p>
        {row.action === 'UPDATE' && <p>ค่าแรงเดิม {Number(row.before_data?.rate_snapshot || 0)} → ค่าแรงใหม่ {Number(row.after_data?.rate_snapshot || 0)} บาท</p>}
        <small>ผู้บันทึก: {row.changed_by || 'ระบบ'} · {new Date(row.created_at).toLocaleString('th-TH')} · รายการ {row.id}</small>
      </details>
    })}
  </section>
}
