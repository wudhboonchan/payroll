import { useState, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import {
  FileDown, Upload, AlertCircle, CheckCircle2,
  X, FileSpreadsheet, Loader2, ChevronRight
} from 'lucide-react'
import {
  downloadEmployeeTemplate,
  parseEmployeeExcel,
  type ParsedRow,
} from '../../lib/employeeExcel'

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
  const [fileName, setFileName] = useState<string>('')

  const validRows = parsedRows.filter(r => r.errors.length === 0)
  const errorRows = parsedRows.filter(r => r.errors.length > 0)

  // ── File processing ─────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setParseError('กรุณาเลือกไฟล์ .xlsx หรือ .xls เท่านั้น')
      return
    }
    setParseError(null)
    setFileName(file.name)
    try {
      const rows = await parseEmployeeExcel(file)
      if (rows.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตั้งแต่แถวที่ 4')
        return
      }
      setParsedRows(rows)
      setStep('preview')
    } catch (err: unknown) {
      const error = err as Error
      setParseError(error.message)
    }
  }, [])

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

  // ── Import mutation ──────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id) throw new Error('ไม่พบ factory context')
      const payload = validRows.map(r => ({
        employee_code: r.data.employee_code,
        prefix: r.data.prefix || null,
        first_name: r.data.first_name,
        last_name: r.data.last_name?.trim() || '',
        nationality: r.data.nationality || 'ไทย',
        national_id: r.data.national_id || null,
        position: r.data.position || 'worker',
        wage_type: r.data.position === 'clerk' ? 'monthly' : 'daily',
        rate_per_12h: Number(r.data.rate_per_12h),
        payment_method: r.data.payment_method as 'cash' | 'bank_transfer',
        bank_name: r.data.payment_method === 'bank_transfer' ? r.data.bank_name || null : null,
        bank_account: r.data.payment_method === 'bank_transfer' ? r.data.bank_account || null : null,
        status: (r.data.status || 'active') as 'active' | 'inactive',
        notes: r.data.notes || null,
        factory_id: user.factory_id,
      }))

      const { error } = await supabase
        .from('employees')
        .upsert(payload, { onConflict: 'employee_code,factory_id', ignoreDuplicates: false })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(`นำเข้าพนักงานสำเร็จ ${validRows.length} คน`)
      setStep('done')
    },
    onError: (err: unknown) => {
      const error = err as Error
      toast.error('นำเข้าไม่สำเร็จ', { description: error.message })
    }
  })

  const handleClose = () => {
    setStep('upload')
    setParsedRows([])
    setParseError(null)
    setFileName('')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-none shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#1D9E75] p-6 text-white flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <FileSpreadsheet className="w-7 h-7" />
              นำเข้าพนักงานจาก Excel
            </DialogTitle>
            <p className="text-emerald-100 mt-1 text-sm">
              ดาวน์โหลด Template → กรอกข้อมูล → อัปโหลดไฟล์ → ตรวจสอบ → นำเข้า
            </p>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-4 text-sm">
            {(['upload', 'preview', 'done'] as Step[]).map((s, i) => {
              const labels = ['1. อัปโหลดไฟล์', '2. ตรวจสอบข้อมูล', '3. สำเร็จ']
              const isActive = step === s
              const isDone = ['upload', 'preview', 'done'].indexOf(step) > i
              return (
                <span key={s} className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    isActive ? 'bg-white text-[#1D9E75]' :
                    isDone ? 'bg-white/30 text-white' : 'bg-white/10 text-white/50'
                  }`}>{labels[i]}</span>
                  {i < 2 && <ChevronRight className="w-3 h-3 text-white/40" />}
                </span>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-8 bg-white">

          {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Download template */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800">ขั้นตอนที่ 1 — ดาวน์โหลด Template</p>
                  <p className="text-sm text-slate-500 mt-1">
                    ดาวน์โหลดไฟล์ Excel พร้อม Column Headers และข้อมูลตัวอย่าง
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="flex-shrink-0 border-[#1D9E75] text-[#1D9E75] hover:bg-[#1D9E75]/5"
                  onClick={downloadEmployeeTemplate}
                >
                  <FileDown className="w-4 h-4 mr-2" />
                  ดาวน์โหลด Template
                </Button>
              </div>

              {/* Upload area */}
              <div>
                <p className="font-semibold text-slate-800 mb-3">ขั้นตอนที่ 2 — อัปโหลดไฟล์ที่กรอกข้อมูลแล้ว</p>
                <div
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-[#1D9E75] bg-[#1D9E75]/5'
                      : 'border-slate-200 hover:border-[#1D9E75] hover:bg-slate-50'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 font-medium">คลิกเพื่อเลือกไฟล์ หรือลากมาวางที่นี่</p>
                  <p className="text-slate-400 text-sm mt-1">รองรับ .xlsx และ .xls</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>

                {parseError && (
                  <div className="mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{parseError}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Preview ────────────────────────────────────────────── */}
          {step === 'preview' && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-slate-800">{parsedRows.length}</p>
                  <p className="text-sm text-slate-500 mt-1">แถวทั้งหมด</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-700">{validRows.length}</p>
                  <p className="text-sm text-emerald-600 mt-1">พร้อมนำเข้า</p>
                </div>
                <div className={`rounded-xl p-4 text-center ${errorRows.length > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <p className={`text-3xl font-bold ${errorRows.length > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {errorRows.length}
                  </p>
                  <p className={`text-sm mt-1 ${errorRows.length > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    มีข้อผิดพลาด
                  </p>
                </div>
              </div>

              {/* File name */}
              <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-4 py-2 rounded-lg">
                <FileSpreadsheet className="w-4 h-4" />
                {fileName}
                <button
                  className="ml-auto text-slate-400 hover:text-slate-700"
                  onClick={() => { setStep('upload'); setParsedRows([]); setFileName('') }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Error list */}
              {errorRows.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                  <p className="font-semibold text-red-700 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    แถวที่มีข้อผิดพลาด (จะไม่นำเข้า)
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {errorRows.map(r => (
                      <div key={r.rowNum} className="text-xs text-red-600 flex gap-2">
                        <span className="font-mono font-bold w-16 flex-shrink-0">แถว {r.rowNum}:</span>
                        <span>{r.errors.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">ตัวอย่างข้อมูลที่จะนำเข้า</p>
                </div>
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-white sticky top-0">
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">สถานะ</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">รหัส</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">ชื่อ-นามสกุล</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">สัญชาติ</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">ค่าแรง/วัน</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">วิธีรับเงิน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsedRows.map(r => (
                        <tr key={r.rowNum} className={r.errors.length > 0 ? 'bg-red-50' : 'hover:bg-slate-50'}>
                          <td className="px-3 py-2">
                            {r.errors.length === 0
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              : <AlertCircle className="w-4 h-4 text-red-400" />
                            }
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800">{r.data.employee_code}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {r.data.prefix} {r.data.first_name} {r.data.last_name}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{r.data.nationality}</td>
                          <td className="px-3 py-2 text-slate-700">{r.data.rate_per_12h}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {r.data.payment_method === 'bank_transfer' ? 'โอนบัญชี' : 'เงินสด'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ───────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-2">นำเข้าสำเร็จ!</h3>
              <p className="text-slate-500">
                นำเข้าพนักงานทั้งหมด <strong className="text-emerald-600">{validRows.length} คน</strong> เรียบร้อยแล้ว
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t bg-white flex justify-between items-center flex-shrink-0">
          <Button variant="outline" onClick={handleClose} className="border-2">
            {step === 'done' ? 'ปิด' : 'ยกเลิก'}
          </Button>

          {step === 'preview' && validRows.length > 0 && (
            <Button
              className="bg-[#1D9E75] hover:bg-[#157a5a] px-10 font-bold"
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />กำลังนำเข้า...</>
              ) : (
                <>นำเข้า {validRows.length} คน</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
