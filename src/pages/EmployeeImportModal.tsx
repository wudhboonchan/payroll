import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { toast } from 'sonner'
import {
  FileDown, Upload, AlertCircle, CheckCircle2,
  X, FileSpreadsheet, Loader2, ChevronRight,
} from 'lucide-react'
import {
  downloadEmployeeTemplate,
  parseEmployeeExcel,
  type ParsedRow,
} from '../lib/employeeExcel'
import { normalizePrefix, formatEmployeeFullName } from '../lib/formatters'
import { isTpiCompany } from '../features/tpi/model'
import '../styles/tokens.css'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Step = 'upload' | 'preview' | 'done'

export default function EmployeeImportModal({ isOpen, onClose }: Props) {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')

  const { data: factories = [] } = useQuery({
    queryKey: ['factories-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('factories').select('id, name')
      if (error) return []
      return data || []
    },
    staleTime: 60000,
  })
  const currentFactoryName = factories.find(f => f.id === user?.factory_id)?.name || ''
  const isTpi = isTpiCompany(currentFactoryName)

  const validRows = parsedRows.filter(r => r.errors.length === 0)
  const errorRows = parsedRows.filter(r => r.errors.length > 0)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setParseError('กรุณาเลือกไฟล์ .xlsx หรือ .xls เท่านั้น')
      return
    }
    setParseError(null)
    setFileName(file.name)
    try {
      const rows = await parseEmployeeExcel(file, { isTpi })
      if (rows.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตั้งแต่แถวที่ 7')
        return
      }
      setParsedRows(rows)
      setStep('preview')
    } catch (err: unknown) {
      setParseError((err as Error).message)
    }
  }, [isTpi])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id) throw new Error('ไม่พบ factory context')
      const payload = validRows.map(r => ({
        employee_code: r.data.employee_code,
        prefix: normalizePrefix(r.data.prefix, r.data.nationality, r.data.first_name, isTpi) || null,
        first_name: r.data.first_name,
        last_name: r.data.last_name?.trim() || '',
        nationality: r.data.nationality || 'ไทย',
        national_id: r.data.national_id || null,
        position: (r.data.position || 'worker') as 'worker' | 'clerk',
        job_title: r.data.job_title || null,
        wage_type: (isTpi ? 'daily' : (r.data.position === 'clerk' ? 'monthly' : 'daily')) as 'daily' | 'monthly',
        rate_per_12h: isTpi ? 0 : (Number(r.data.rate_per_12h) || 0),
        payment_method: (r.data.payment_method || 'bank_transfer') as 'cash' | 'bank_transfer',
        bank_name: r.data.payment_method === 'bank_transfer' ? r.data.bank_name || null : null,
        bank_account: r.data.payment_method === 'bank_transfer' ? r.data.bank_account || null : null,
        status: (r.data.status || 'active') as 'active' | 'inactive',
        is_safety_officer: r.data.is_safety_officer === 'true',
        has_position_allowance: r.data.has_position_allowance === 'true',
        exempt_social_security: r.data.exempt_social_security === 'true',
        data_complete: r.data.data_complete === 'true',
        notes: r.data.notes || null,
        factory_id: user.factory_id,
      }))
      const { data: upsertedEmps, error } = await supabase
        .from('employees')
        .upsert(payload, { onConflict: 'employee_code,factory_id', ignoreDuplicates: false })
        .select('id, employee_code')
      if (error) throw error

      // In TPI, upsert wage profiles for each imported employee
      if (isTpi && upsertedEmps && upsertedEmps.length > 0) {
        const codeToId = new Map(upsertedEmps.map(e => [e.employee_code, e.id]))
        const profilePayload = validRows.map(r => {
          const empId = codeToId.get(r.data.employee_code)
          if (!empId) return null
          return {
            employee_id: empId,
            factory_id: user.factory_id,
            rate_tier: r.data.rate_tier === 'skilled' ? 'skilled' : 'normal',
            updated_at: new Date().toISOString(),
          }
        }).filter(Boolean)
        if (profilePayload.length > 0) {
          const { error: profileErr } = await supabase
            .from('tpi_employee_wage_profiles')
            .upsert(profilePayload, { onConflict: 'factory_id,employee_id' })
          if (profileErr) console.error('Error saving tpi profiles:', profileErr)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['employees-all'] })
      queryClient.invalidateQueries({ queryKey: ['tpi-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(`นำเข้าพนักงานสำเร็จ ${validRows.length} คน`)
      setStep('done')
    },
    onError: (err: unknown) => {
      toast.error('นำเข้าไม่สำเร็จ', { description: (err as Error).message })
    },
  })

  const handleClose = () => {
    setStep('upload'); setParsedRows([]); setParseError(null); setFileName('')
    onClose()
  }

  if (!isOpen) return null

  const STEPS: Step[] = ['upload', 'preview', 'done']
  const STEP_LABELS = ['1. อัปโหลดไฟล์', '2. ตรวจสอบข้อมูล', '3. สำเร็จ']

  return (
    <div
      className="vk-root"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(22,19,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}>

        {/* ── Header ── */}
        <div style={{ background: 'var(--vk-persimmon)', color: 'var(--vk-bone)', padding: '24px 28px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileSpreadsheet style={{ width: 26, height: 26, opacity: 0.9 }} />
              <div>
                <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>นำเข้าพนักงานจาก Excel</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 3 }}>ดาวน์โหลด Template → กรอกข้อมูล → อัปโหลดไฟล์ → ตรวจสอบ → นำเข้า</div>
              </div>
            </div>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 4, display: 'flex' }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            {STEPS.map((s, i) => {
              const isActive = step === s
              const isDone = STEPS.indexOf(step) > i
              return (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: isActive ? 'var(--vk-bone)' : isDone ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)',
                    color: isActive ? 'var(--vk-persimmon)' : isDone ? 'var(--vk-bone)' : 'rgba(255,255,255,0.45)',
                  }}>{STEP_LABELS[i]}</span>
                  {i < 2 && <ChevronRight style={{ width: 12, height: 12, opacity: 0.4 }} />}
                </span>
              )
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: 'var(--vk-bone)' }}>

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Download template */}
              <div style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>ขั้นตอนที่ 1 — ดาวน์โหลด Template</div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 3 }}>ดาวน์โหลดไฟล์ Excel พร้อม Column Headers และข้อมูลตัวอย่าง</div>
                </div>
                <button
                  className="vk-btn"
                  style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--vk-persimmon)', color: 'var(--vk-persimmon)', background: 'transparent', whiteSpace: 'nowrap' }}
                  onClick={() => downloadEmployeeTemplate({ isTpi, factoryName: currentFactoryName })}
                >
                  <FileDown style={{ width: 14, height: 14 }} />
                  ดาวน์โหลด Template
                </button>
              </div>

              {/* Upload area */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>ขั้นตอนที่ 2 — อัปโหลดไฟล์ที่กรอกข้อมูลแล้ว</div>
                <div
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--vk-persimmon)' : 'var(--vk-rule)'}`,
                    background: isDragging ? 'rgba(177,71,41,0.04)' : 'var(--vk-paper)',
                    padding: '48px 32px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Upload style={{ width: 40, height: 40, color: 'var(--vk-rule)', margin: '0 auto 14px' }} />
                  <div style={{ fontWeight: 500, color: 'var(--vk-ink-2)' }}>คลิกเพื่อเลือกไฟล์ หรือลากมาวางที่นี่</div>
                  <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 4 }}>รองรับ .xlsx และ .xls</div>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
                </div>

                {parseError && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fef2f2', border: '1px solid #fca5a5', padding: '12px 16px' }}>
                    <AlertCircle style={{ width: 16, height: 16, color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 13, color: '#b91c1c' }}>{parseError}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {[
                  { label: 'แถวทั้งหมด', value: parsedRows.length, color: 'var(--vk-ink)' },
                  { label: 'พร้อมนำเข้า', value: validRows.length, color: 'var(--vk-jade)' },
                  { label: 'มีข้อผิดพลาด', value: errorRows.length, color: errorRows.length > 0 ? '#dc2626' : 'var(--vk-ink-3)' },
                ].map(c => (
                  <div key={c.label} style={{ background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, fontSize: 28, color: c.color }}>{c.value}</div>
                    <div className="vk-small" style={{ color: 'var(--vk-ink-3)', marginTop: 4 }}>{c.label}</div>
                  </div>
                ))}
              </div>

              {/* File name bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--vk-paper)', border: '1px solid var(--vk-rule)', padding: '8px 14px', fontSize: 12, color: 'var(--vk-ink-3)' }}>
                <FileSpreadsheet style={{ width: 14, height: 14 }} />
                <span style={{ flex: 1 }}>{fileName}</span>
                <button onClick={() => { setStep('upload'); setParsedRows([]); setFileName('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-3)', display: 'flex' }}>
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>

              {/* Error rows */}
              {errorRows.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>
                    <AlertCircle style={{ width: 14, height: 14 }} />
                    แถวที่มีข้อผิดพลาด (จะไม่นำเข้า)
                  </div>
                  <div style={{ maxHeight: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {errorRows.map(r => (
                      <div key={r.rowNum} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#dc2626' }}>
                        <span style={{ fontFamily: 'var(--vk-mono)', fontWeight: 700, width: 56, flexShrink: 0 }}>แถว {r.rowNum}:</span>
                        <span>{r.errors.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div style={{ border: '1px solid var(--vk-rule)', overflow: 'hidden' }}>
                <div style={{ background: 'var(--vk-paper)', padding: '8px 14px', borderBottom: '1px solid var(--vk-rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="vk-eyebrow">ตัวอย่างข้อมูลที่จะนำเข้า</span>
                  <span style={{ fontSize: 11, color: 'var(--vk-ink-3)' }}>
                    {isTpi ? 'ระบบคำนวณค่าแรงตามรหัสงานและประเภทค่าแรง' : ''}
                  </span>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 260 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--vk-bone)', position: 'sticky', top: 0 }}>
                        {[
                          'สถานะ', 'รหัส', 'ชื่อ-นามสกุล', 'สัญชาติ', 'กลุ่มงาน', 'ตำแหน่งงาน',
                          isTpi ? 'ประเภทค่าแรง' : 'ค่าแรง', 'สิทธิพิเศษ/เงื่อนไข', 'วิธีรับเงิน'
                        ].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--vk-ink-2)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--vk-rule)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.map(r => {
                        const isForeignWaitSS = r.data.nationality !== 'ไทย' && !r.data.national_id
                        return (
                          <tr key={r.rowNum} style={{ background: r.errors.length > 0 ? '#fef2f2' : 'var(--vk-paper)', borderBottom: '1px solid var(--vk-rule-soft)' }}>
                            <td style={{ padding: '7px 12px' }}>
                              {r.errors.length === 0
                                ? <CheckCircle2 style={{ width: 14, height: 14, color: 'var(--vk-jade)' }} />
                                : <AlertCircle style={{ width: 14, height: 14, color: '#dc2626' }} />}
                            </td>
                            <td style={{ padding: '7px 12px', fontFamily: 'var(--vk-mono)', fontWeight: 600, color: 'var(--vk-ink)' }}>{r.data.employee_code}</td>
                            <td style={{ padding: '7px 12px', color: 'var(--vk-ink-2)', whiteSpace: 'nowrap' }}>{formatEmployeeFullName(r.data, isTpi)}</td>
                            <td style={{ padding: '7px 12px', color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>{r.data.nationality}</td>
                            <td style={{ padding: '7px 12px', color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>
                              {r.data.position === 'clerk' ? 'เสมียน' : 'พนักงานทั่วไป'}
                            </td>
                            <td style={{ padding: '7px 12px', color: 'var(--vk-ink-2)', whiteSpace: 'nowrap' }}>
                              {r.data.job_title || '—'}
                            </td>
                            <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                              {isTpi ? (
                                r.data.rate_tier === 'skilled' ? (
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>
                                    ค่าแรงฝีมือ
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
                                    ค่าแรงปกติ
                                  </span>
                                )
                              ) : (
                                <span style={{ fontFamily: 'var(--vk-mono)' }}>{r.data.rate_per_12h || '—'}</span>
                              )}
                            </td>
                            <td style={{ padding: '7px 12px' }}>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {r.data.is_safety_officer === 'true' && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>จป.</span>
                                )}
                                {r.data.has_position_allowance === 'true' && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>ค่าตำแหน่ง</span>
                                )}
                                {r.data.exempt_social_security === 'true' && (
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>ยกเว้น ปกส</span>
                                )}
                                {isForeignWaitSS && (
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>รอ ปกส</span>
                                )}
                                {r.data.data_complete !== 'true' && !isForeignWaitSS && (
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>ข้อมูลไม่ครบ</span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '7px 12px', color: 'var(--vk-ink-3)', whiteSpace: 'nowrap' }}>
                              {r.data.payment_method === 'bank_transfer' ? 'โอนบัญชี' : 'เงินสด'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(40,167,98,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <CheckCircle2 style={{ width: 36, height: 36, color: 'var(--vk-jade)' }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', marginBottom: 6 }}>นำเข้าสำเร็จ!</div>
              <div style={{ color: 'var(--vk-ink-3)', fontSize: 14 }}>
                นำเข้าพนักงานทั้งหมด <strong style={{ color: 'var(--vk-jade)' }}>{validRows.length} คน</strong> เรียบร้อยแล้ว
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '16px 32px', borderTop: '1px solid var(--vk-rule)', background: 'var(--vk-paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <button className="vk-btn" onClick={handleClose}>
            {step === 'done' ? 'ปิด' : 'ยกเลิก'}
          </button>

          {step === 'preview' && validRows.length > 0 && (
            <button
              className="vk-btn vk-btn--primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingLeft: 28, paddingRight: 28 }}
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending
                ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />กำลังนำเข้า...</>
                : <>นำเข้า {validRows.length} คน</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
