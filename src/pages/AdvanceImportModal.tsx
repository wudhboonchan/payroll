import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { FileDown, Upload, FileSpreadsheet, CheckCircle2, Loader2, ChevronRight, X, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { supabase } from '../lib/supabase'
import { advanceRoundKey, createAdvanceTemplate, parseAdvanceExcel, type AdvanceImportRow, type AdvanceEmployee } from '../lib/advanceExcel'

interface Props {
  period: { id: string; label: string }
  factoryId: string
  onClose: () => void
}

async function loadEmployees(factoryId: string): Promise<AdvanceEmployee[]> {
  const employees: AdvanceEmployee[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('employees')
      .select('id,employee_code,first_name,last_name').eq('factory_id', factoryId)
      .eq('status', 'active').order('id').range(from, from + 999)
    if (error) throw error
    employees.push(...(data || []))
    if (!data || data.length < 1000) return employees
  }
}

export default function AdvanceImportModal({ period, factoryId, onClose }: Props) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [rows, setRows] = useState<AdvanceImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? Math.round(row.amount * 100) : 0), 0) / 100
  const errorCount = rows.filter(row => row.errors.length).length

  async function processFile(file: File) {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const employees = await loadEmployees(factoryId)
      setRows(await parseAdvanceExcel(file, employees))
      setFileName(file.name)
      setAcknowledged(false)
      setStep('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      busy.current = false
      setLoading(false)
      if (input.current) input.current.value = ''
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (busy.current) throw new Error('กำลังดำเนินการ กรุณารอสักครู่')
      if (!rows.length || errorCount || !acknowledged) throw new Error('กรุณาตรวจสอบข้อมูลก่อนนำเข้า')
      busy.current = true
      try {
        const { data: activePeriod, error: periodError } = await supabase.from('payroll_periods')
          .select('id').eq('id', period.id).eq('factory_id', factoryId).single()
        if (periodError || !activePeriod) throw new Error('ไม่พบงวดของบริษัทนี้ กรุณาเปิดหน้ารายการใหม่')
        const employees = await loadEmployees(factoryId)
        const ids = new Map(employees.map(employee => [employee.employee_code.trim(), employee.id]))
        if (rows.some(row => ids.get(row.code) !== row.employee?.id)) throw new Error('ข้อมูลพนักงานเปลี่ยนแปลง กรุณาอัปโหลดไฟล์เพื่อตรวจสอบใหม่')
        const existing: { employee_id: string; advance_number: number | null }[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error: readError } = await supabase.from('advance_payments')
            .select('employee_id,advance_number').eq('period_id', period.id).not('advance_number', 'is', null)
            .order('id').range(from, from + 999)
          if (readError) throw readError
          existing.push(...(data || []))
          if (!data || data.length < 1000) break
        }
        const keys = new Set(existing.map(row => advanceRoundKey(row.employee_id, row.advance_number!)))
        const conflicts = rows.filter(row => keys.has(advanceRoundKey(row.employee!.id, row.advanceNumber)))
        if (conflicts.length) {
          throw new Error(`พบครั้งที่เบิกซ้ำในงวดนี้: ${conflicts.slice(0, 10).map(row => `แถว ${row.rowNumber} รหัส ${row.code} ครั้งที่ ${row.advanceNumber}`).join(' / ')} กรุณาแก้ไขไฟล์แล้วอัปโหลดใหม่`)
        }
        const { error: insertError } = await supabase.from('advance_payments').insert(rows.map(row => ({
          period_id: period.id, employee_id: row.employee!.id, amount: row.amount,
          notes: row.notes || null, is_carryover: false, advance_number: row.advanceNumber,
        })))
        if (insertError) throw new Error(insertError.code === '23505' ? 'มีการบันทึกครั้งที่เบิกนี้แล้ว กรุณาตรวจสอบรายการในงวดแล้วอัปโหลดใหม่' : insertError.message)
      } finally {
        busy.current = false
      }
    },
    onSuccess: () => {
      setStep('done')
      for (const key of ['advances-v2', 'advances', 'v2-stats', 'payment-channel-stats', 'dashboard-stats']) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
      toast.success(`นำเข้าเบิกล่วงหน้าสำเร็จ ${rows.length} รายการ`)
    },
    onError: (cause: Error) => setError(cause.message),
  })
  const pending = loading || mutation.isPending

  const steps = ['upload', 'preview', 'done']
  const stepLabels = ['1. อัปโหลดไฟล์', '2. ตรวจสอบข้อมูล', '3. สำเร็จ']
  const resetFile = () => { setStep('upload'); setError(''); setRows([]); setFileName(''); setAcknowledged(false) }

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose() }}>
      <DialogContent className="vk-root" showCloseButton={false} style={{ width: 'calc(100% - 48px)', maxWidth: 760, padding: 0, gap: 0, borderRadius: 0, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}>
        <header style={{ padding: '24px 28px 20px', flexShrink: 0, background: 'var(--vk-persimmon)', color: 'var(--vk-bone)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileSpreadsheet size={26} style={{ opacity: 0.9, flexShrink: 0 }} />
              <div>
                <DialogTitle style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', margin: 0 }}>นำเข้าเบิกล่วงหน้าจาก Excel</DialogTitle>
                <DialogDescription style={{ color: 'inherit', fontSize: 12, opacity: 0.75, marginTop: 3 }}>ดาวน์โหลด Template → กรอกข้อมูล → อัปโหลดไฟล์ → ตรวจสอบ → นำเข้า</DialogDescription>
              </div>
            </div>
            <button aria-label="ปิดหน้าต่างนำเข้า" disabled={pending} onClick={onClose} style={{ background: 'none', border: 'none', cursor: pending ? 'wait' : 'pointer', color: 'rgba(255,255,255,0.7)', padding: 4, display: 'flex' }}><X size={18} /></button>
          </div>
          <div aria-label="ขั้นตอนนำเข้า" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {steps.map((value, index) => {
              const active = step === value
              const done = steps.indexOf(step) > index
              return <span key={value} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-current={active ? 'step' : undefined} style={{ padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: active ? 'var(--vk-bone)' : done ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)', color: active ? 'var(--vk-persimmon)' : done ? 'var(--vk-bone)' : 'rgba(255,255,255,0.45)' }}>{stepLabels[index]}</span>
                {index < 2 && <ChevronRight size={12} style={{ opacity: 0.4 }} />}
              </span>
            })}
          </div>
        </header>
        <div style={{ flex: 1, padding: '28px 32px', overflowY: 'auto', minHeight: 0, background: 'var(--vk-bone)' }}>
          {error && <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fef2f2', border: '1px solid #fca5a5', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#b91c1c' }}><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />{error}</div>}
          {step === 'upload' && <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>ขั้นตอนที่ 1 · ดาวน์โหลด Template</div>
                <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 3 }}>ไฟล์ Excel พร้อมหัวคอลัมน์สำหรับกรอกข้อมูลเบิกล่วงหน้า</div>
              </div>
              <button className="vk-btn" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--vk-persimmon)', color: 'var(--vk-persimmon)', background: 'transparent', whiteSpace: 'nowrap' }} onClick={() => XLSX.writeFile(createAdvanceTemplate(), 'Template_เบิกล่วงหน้า.xlsx')}><FileDown size={14} /> ดาวน์โหลด Template</button>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>ขั้นตอนที่ 2 · อัปโหลดไฟล์ที่กรอกข้อมูลแล้ว</div>
              <div onDragOver={event => { event.preventDefault(); if (!pending) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!pending && event.dataTransfer.files[0]) void processFile(event.dataTransfer.files[0]) }} style={{ position: 'relative' }}>
                <button type="button" disabled={pending} aria-busy={loading} onClick={() => input.current?.click()} style={{ width: '100%', border: `2px dashed ${dragging ? 'var(--vk-persimmon)' : 'var(--vk-rule)'}`, background: dragging ? 'rgba(177,71,41,0.04)' : 'var(--vk-paper)', padding: '48px 32px', textAlign: 'center', cursor: pending ? 'wait' : 'pointer', transition: 'all 150ms', fontFamily: 'inherit' }}>
                  {loading ? <Loader2 size={40} className="animate-spin" style={{ color: 'var(--vk-persimmon)', margin: '0 auto 14px' }} /> : <Upload size={40} style={{ color: 'var(--vk-rule)', margin: '0 auto 14px' }} />}
                  <span style={{ display: 'block', fontWeight: 500, color: 'var(--vk-ink-2)' }}>{loading ? 'กำลังตรวจสอบข้อมูล...' : 'คลิกเพื่อเลือกไฟล์ หรือลากมาวางที่นี่'}</span>
                  <span className="vk-small" style={{ display: 'block', color: 'var(--vk-ink-3)', marginTop: 4 }}>รองรับ .xlsx และ .xls · ไม่เกิน 10 MB · สูงสุด 5,000 รายการ</span>
                </button>
                <input ref={input} type="file" accept=".xlsx,.xls" aria-label="ไฟล์เบิกล่วงหน้า" hidden onChange={event => { if (event.target.files?.[0]) void processFile(event.target.files[0]) }} />
              </div>
            </div>
            <details style={{ color: 'var(--vk-ink-3)', fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--vk-ink-2)' }}>คำแนะนำการกรอกข้อมูล · งวด {period.label}</summary>
              <div style={{ lineHeight: 1.8, marginTop: 8 }}>
                <p>กรอกรหัสพนักงานและยอดเงิน หมายเหตุเว้นว่างได้ ระบบจะดึงชื่อจากฐานข้อมูลให้ตรวจสอบ</p>
                <p>คอลัมน์ “ครั้งที่ 2”: Yes / YES / Y = ครั้งที่ 2 ส่วนช่องว่าง / No / N = ครั้งที่ 1 ไม่สนตัวพิมพ์ใหญ่เล็ก แต่ละแถวเลือกต่างกันได้</p>
                <p>เริ่มกรอกแถวที่ 2 เก็บรหัสพนักงานเป็นข้อความเพื่อรักษาเลขศูนย์ด้านหน้า ยอดเงินต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง</p>
              </div>
            </details>
          </div>}
          {step === 'preview' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {[{ label: 'แถวทั้งหมด', value: rows.length, color: 'var(--vk-ink)' }, { label: 'พร้อมนำเข้า', value: rows.length - errorCount, color: 'var(--vk-jade)' }, { label: 'มีข้อผิดพลาด', value: errorCount, color: errorCount ? '#dc2626' : 'var(--vk-ink-3)' }].map(card => <div key={card.label} style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: 16, textAlign: 'center' }}><div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 28, color: card.color }}>{card.value}</div><div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 4 }}>{card.label}</div></div>)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '8px 14px', fontSize: 12, color: 'var(--vk-ink-3)' }}>
              <FileSpreadsheet size={14} style={{ flexShrink: 0 }} /><span style={{ flex: 1, overflowWrap: 'anywhere' }}>{fileName}</span><button aria-label="เลือกไฟล์ใหม่" disabled={pending} onClick={resetFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', display: 'flex' }}><X size={14} /></button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--vk-ink-2)' }}>งวด <strong>{period.label}</strong> · ยอดรวม <strong style={{ fontFamily: 'var(--vk-mono)' }}>฿ {total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong></div>
            {errorCount > 0 && <div role="alert" style={{ display: 'flex', gap: 8, background: '#fef2f2', border: '1px solid #fca5a5', padding: '14px 16px', fontSize: 13, color: '#b91c1c' }}><AlertCircle size={16} style={{ flexShrink: 0 }} />พบข้อผิดพลาด {errorCount} แถว ต้องแก้ไขไฟล์แล้วอัปโหลดใหม่ก่อนนำเข้า</div>}
            <div style={{ border: '1px solid var(--vk-rule)', overflow: 'hidden' }}>
              <div className="vk-eyebrow" style={{ background: 'var(--vk-paper)', padding: '8px 14px', borderBottom: '1px solid var(--vk-rule)' }}>ตัวอย่างข้อมูลที่จะนำเข้า</div>
              <div style={{ overflow: 'auto', maxHeight: 260 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: 'var(--vk-bone)', position: 'sticky', top: 0 }}>{['แถว', 'รหัสพนักงาน', 'ชื่อจากระบบ', 'ครั้งที่เบิก', 'หมายเหตุ', 'ยอดเงิน', 'ผลตรวจสอบ'].map(label => <th key={label} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--vk-ink-2)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--vk-rule)' }}>{label}</th>)}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.rowNumber} style={{ background: row.errors.length ? '#fef2f2' : 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule-soft)' }}>
                  {[row.rowNumber, row.code, row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : '-', row.advanceNumber, row.notes || '-', Number.isFinite(row.amount) ? row.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-', row.errors.join(' / ') || 'พร้อมนำเข้า'].map((value, index) => <td key={index} style={{ padding: '7px 12px', color: index === 6 && row.errors.length ? '#b91c1c' : 'var(--vk-ink-2)', fontFamily: [0, 1, 3, 5].includes(index) ? 'var(--vk-mono)' : undefined, whiteSpace: [1, 2, 5].includes(index) ? 'nowrap' : undefined, minWidth: index === 6 ? 120 : undefined, overflowWrap: 'anywhere' }}>{value}</td>)}
                </tr>)}</tbody>
              </table></div>
            </div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>ระบบจะหยุดหากรหัสพนักงานและครั้งที่เบิกซ้ำในงวดเดียวกัน แม้ยอดเงินหรือหมายเหตุเปลี่ยนไป</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--vk-ink-2)' }}><input type="checkbox" checked={acknowledged} disabled={pending || !!errorCount} onChange={event => setAcknowledged(event.target.checked)} /> ตรวจสอบงวด ชื่อพนักงาน ครั้งที่เบิก และยอดเงินแล้ว</label>
          </div>}
          {step === 'done' && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(40,167,98,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}><CheckCircle2 size={36} style={{ color: 'var(--vk-jade)' }} /></div>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', marginBottom: 6 }}>นำเข้าสำเร็จ!</div>
            <div style={{ color: 'var(--vk-ink-3)', fontSize: 14 }}>นำเข้าเบิกล่วงหน้าทั้งหมด <strong style={{ color: 'var(--vk-jade)' }}>{rows.length} รายการ</strong> เรียบร้อยแล้ว</div>
            <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 8 }}>งวด {period.label} · รวม ฿ {total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
          </div>}
        </div>
        <footer style={{ padding: '16px 32px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button className="vk-btn" disabled={pending} onClick={onClose}>{step === 'done' ? 'ปิด' : 'ยกเลิก'}</button>
          {step === 'preview' && <button className="vk-btn vk-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingLeft: 28, paddingRight: 28 }} disabled={pending || !!errorCount || !rows.length || !acknowledged} onClick={() => mutation.mutate()}>{mutation.isPending ? <><Loader2 size={14} className="animate-spin" />กำลังนำเข้า...</> : `ยืนยันนำเข้า ${rows.length} รายการ`}</button>}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
