import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { FileText, Search, User, Calendar, CheckSquare, Square } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { PaySlipPreview, type PaySlipData } from './PaySlipPreview'

type Props = {
  isOpen: boolean
  onClose: () => void
  uniqueMonths: string[]
}

export default function PayslipExportModal({ isOpen, onClose, uniqueMonths }: Props) {
  const { user } = useAppStore()
  const [exportTarget, setExportTarget] = useState<'all' | 'individual'>('individual')
  const [selectedMonthAll, setSelectedMonthAll] = useState<string>(uniqueMonths[0] || '')
  
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [selectedMonthsIndiv, setSelectedMonthsIndiv] = useState<string[]>([])
  
  const [isGenerating, setIsGenerating] = useState(false)

  // We need to fetch periods again to map month names back to period IDs
  const { data: periods = [] } = useQuery({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data } = await supabase.from('payroll_periods').select('*').eq('factory_id', user.factory_id)
      return data as any[]
    },
    enabled: isOpen && !!user?.factory_id
  })

  // Fetch active employees for selection
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name')
        .eq('factory_id', user.factory_id)
        .eq('status', 'active')
        .order('first_name')
      if (error) throw error
      return data
    },
    enabled: isOpen && !!user?.factory_id && exportTarget === 'individual'
  })

  const filteredEmployees = employees.filter(e => 
    e.first_name.includes(searchQuery) || 
    (e.last_name && e.last_name.includes(searchQuery)) || 
    (e.employee_code && e.employee_code.includes(searchQuery))
  )

  const toggleMonth = (month: string) => {
    setSelectedMonthsIndiv(prev => 
      prev.includes(month) 
        ? prev.filter(m => m !== month)
        : [...prev, month]
    )
  }

  const selectLastNMonths = (n: number) => {
    setSelectedMonthsIndiv(uniqueMonths.slice(0, n))
  }

  const handleExport = async () => {
    let targetMonths: string[] = []

    if (exportTarget === 'all') {
      if (!selectedMonthAll) {
        toast.error('กรุณาเลือกเดือนที่ต้องการพิมพ์')
        return
      }
      targetMonths = [selectedMonthAll]
    } else {
      if (!selectedEmployeeId) {
        toast.error('กรุณาเลือกพนักงาน')
        return
      }
      if (selectedMonthsIndiv.length === 0) {
        toast.error('กรุณาเลือกเดือนอย่างน้อย 1 เดือน')
        return
      }
      targetMonths = selectedMonthsIndiv
    }

    setIsGenerating(true)
    try {
      const targetPeriodIds = periods
        .filter((p: any) => targetMonths.includes(format(new Date(p.period_start), 'MMM yyyy', { locale: th })))
        .map((p: any) => p.id)

      if (targetPeriodIds.length === 0) {
        toast.error('ไม่พบรอบการจ่ายเงินในเดือนที่เลือก')
        setIsGenerating(false)
        return
      }

      let query = supabase
        .from('payroll_entries')
        .select(`
          *,
          employee:employees(
            id, employee_code, first_name, last_name, payment_method, bank_name, bank_account, position
          ),
          period:payroll_periods(
            period_start, period_end
          )
        `)
        .in('period_id', targetPeriodIds)

      if (exportTarget === 'individual') {
        query = query.eq('employee_id', selectedEmployeeId)
      }

      const { data: entries, error } = await query
      if (error) throw error
      if (!entries || entries.length === 0) {
        toast.error('ไม่พบข้อมูลสลิปในเดือนที่เลือก')
        setIsGenerating(false)
        return
      }

      let advanceQuery = supabase.from('advance_payments').select('employee_id, amount').in('period_id', targetPeriodIds)
      if (exportTarget === 'individual') advanceQuery = advanceQuery.eq('employee_id', selectedEmployeeId)
      const { data: advances } = await advanceQuery

      const slips: PaySlipData[] = entries.map((entry: any) => {
        const emp = entry.employee
        const period = entry.period
        const empAdvances = (advances || []).filter((a: any) => a.employee_id === emp.id)
        const totalAdvance = empAdvances.reduce((sum: number, a: any) => sum + Number(a.amount), 0)

        const amount_normal = Number(entry.amount_normal || 0)
        const amount_shift = Number(entry.amount_shift || 0)
        const amount_ot = Number(entry.amount_ot || 0)
        const amount_wood_excess = Number(entry.amount_wood_excess || 0)
        const amount_film = Number(entry.amount_film || 0)
        const amount_special = Number(entry.amount_special || 0)
        const amount_diligence = Number(entry.amount_diligence || 0)
        const amount_position = Number(entry.amount_position || 0)
        const deduct_social_security = Number(entry.deduct_social_security || 0)
        const deduct_safety_equipment = Number(entry.deduct_safety_equipment || 0)
        const deduct_uniform = Number(entry.deduct_uniform || 0)
        const total_income = amount_normal + amount_shift + amount_ot + amount_wood_excess + amount_film + amount_special + amount_diligence + amount_position
        const total_deductions = deduct_social_security + totalAdvance + deduct_safety_equipment + deduct_uniform

        return {
          employee_code: emp.employee_code,
          first_name: emp.first_name,
          last_name: emp.last_name,
          factory_name: 'บริษัท ผลิตภัณฑ์ตราเพชร จำกัด (มหาชน)',
          period_start: period.period_start,
          period_end: period.period_end,
          generated_at: new Date().toISOString(),
          position: emp.position || 'worker',
          amount_normal, amount_shift, amount_ot, amount_wood_excess, amount_film, amount_special, amount_diligence, amount_position,
          deduct_social_security, deduct_advance: totalAdvance, deduct_safety_equipment, deduct_uniform,
          total_income, total_deductions,
          net_pay: total_income - total_deductions,
          payment_method: emp.payment_method || 'cash',
          bank_name: emp.bank_name,
          bank_account: emp.bank_account,
        }
      })

      slips.sort((a, b) => {
        if (a.employee_code !== b.employee_code) return String(a.employee_code).localeCompare(String(b.employee_code))
        return new Date(a.period_start).getTime() - new Date(b.period_start).getTime()
      })

      // Build filename
      const mm = String(new Date(slips[0].period_start).getMonth() + 1).padStart(2, '0')
      const yyyy = new Date(slips[0].period_start).getFullYear()
      const filename = exportTarget === 'individual'
        ? `${slips[0].employee_code}_${slips[0].first_name}_${slips[0].last_name}_${mm}${yyyy}`
        : `All_Payslip_${mm}${yyyy}`

      // Serialize slips to HTML using renderToStaticMarkup
      const { renderToStaticMarkup } = await import('react-dom/server')
      const { PaySlipPreview } = await import('./PaySlipPreview')
      const createElement = (await import('react')).createElement

      const slipsHtml = slips.map(slip =>
        `<div style="page-break-after:always;padding:0;margin:0;">
          ${renderToStaticMarkup(createElement(PaySlipPreview, { data: slip }))}
        </div>`
      ).join('')

      const win = window.open('', '_blank', 'width=900,height=700')
      if (!win) { alert('กรุณาอนุญาต popup สำหรับการพิมพ์'); setIsGenerating(false); return }

      win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: white; font-family: sans-serif; }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print {
      html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      div[style*="page-break-after:always"]:last-child { page-break-after: auto !important; }
    }
  </style>
</head>
<body>${slipsHtml}</body>
</html>`)
      win.document.close()
      win.focus()
      setTimeout(() => {
        win.print()
        win.close()
      }, 500)

    } catch (error) {
      console.error(error)
      toast.error('เกิดข้อผิดพลาดในการดึงข้อมูล')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden border-none shadow-2xl rounded-2xl flex flex-col max-h-[90vh]">
          
          {/* Header */}
          <div className="bg-[#1D9E75] p-6 text-white flex-shrink-0">
            <DialogHeader>
              <DialogTitle className="text-xl md:text-2xl font-bold flex items-center gap-3">
                <FileText className="w-6 h-6 md:w-7 md:h-7" />
                พิมพ์ใบสลิปเงินเดือน (PDF)
              </DialogTitle>
              <p className="text-emerald-100 mt-1 text-sm">
                สร้างไฟล์ PDF สลิปเงินเดือน สามารถเลือกพิมพ์รายบุคคลย้อนหลัง หรือพิมพ์ทั้งบริษัทได้
              </p>
            </DialogHeader>
          </div>

        {/* Body */}
        <div className="p-6 md:p-8 bg-slate-50 flex-1 overflow-y-auto space-y-8">
          
          {/* Target Selection */}
          <div className="space-y-4">
            <Label className="text-base font-bold text-slate-800">รูปแบบการพิมพ์</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${exportTarget === 'individual' ? 'border-[#1D9E75] bg-emerald-50/50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}>
                <input 
                  type="radio" 
                  name="export_target" 
                  value="individual"
                  checked={exportTarget === 'individual'}
                  onChange={() => setExportTarget('individual')}
                  className="mt-1 w-4 h-4 accent-[#1D9E75]"
                />
                <div>
                  <div className="font-bold text-slate-800">พนักงานรายบุคคล</div>
                  <div className="text-xs text-slate-500 mt-1">ขอสลิปย้อนหลัง 3 เดือน, 6 เดือน</div>
                </div>
              </label>
              
              <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${exportTarget === 'all' ? 'border-[#1D9E75] bg-emerald-50/50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}>
                <input 
                  type="radio" 
                  name="export_target" 
                  value="all"
                  checked={exportTarget === 'all'}
                  onChange={() => setExportTarget('all')}
                  className="mt-1 w-4 h-4 accent-[#1D9E75]"
                />
                <div>
                  <div className="font-bold text-slate-800">พนักงานทุกคน</div>
                  <div className="text-xs text-slate-500 mt-1">พิมพ์สลิปของทุกคนในเดือนเดียว</div>
                </div>
              </label>
            </div>
          </div>

          {/* Settings based on target */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
            
            {exportTarget === 'all' ? (
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-slate-700">เลือกเดือนที่ต้องการพิมพ์</Label>
                <select 
                  className="w-full h-12 rounded-xl border border-slate-200 px-4 text-base bg-white focus:border-[#1D9E75] outline-none"
                  value={selectedMonthAll}
                  onChange={e => setSelectedMonthAll(e.target.value)}
                >
                  {uniqueMonths.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-2">
                  <User className="w-3.5 h-3.5" />
                  ระบบจะสร้าง PDF 1 ไฟล์ที่มีสลิปของพนักงานทุกคนในเดือน {selectedMonthAll} เรียงตามรหัสพนักงาน
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                
                {/* 1. Employee Search */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-slate-700">1. เลือกพนักงาน</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      placeholder="ค้นหาชื่อ, นามสกุล หรือรหัสพนักงาน..." 
                      className="pl-9 h-11 border-slate-200 focus:border-[#1D9E75]"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                  
                  <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto bg-slate-50 divide-y divide-slate-100">
                    {filteredEmployees.length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-500">ไม่พบข้อมูลพนักงาน</div>
                    ) : (
                      filteredEmployees.map(emp => (
                        <div 
                          key={emp.id}
                          className={`p-3 text-sm cursor-pointer hover:bg-emerald-50 transition-colors flex items-center justify-between ${selectedEmployeeId === emp.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'}`}
                          onClick={() => setSelectedEmployeeId(emp.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${selectedEmployeeId === emp.id ? 'bg-emerald-200 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {emp.employee_code || '-'}
                            </div>
                            {emp.first_name} {emp.last_name}
                          </div>
                          {selectedEmployeeId === emp.id && (
                            <CheckSquare className="w-5 h-5 text-emerald-500" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 2. Month Selection */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold text-slate-700">2. เลือกเดือน (เลือกได้หลายเดือน)</Label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => selectLastNMonths(3)} className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-md text-slate-600 font-medium transition-colors">3 เดือนล่าสุด</button>
                      <button type="button" onClick={() => selectLastNMonths(6)} className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-md text-slate-600 font-medium transition-colors">6 เดือนล่าสุด</button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {uniqueMonths.map(m => {
                      const isSelected = selectedMonthsIndiv.includes(m)
                      return (
                        <div 
                          key={m}
                          onClick={() => toggleMonth(m)}
                          className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all select-none ${isSelected ? 'border-[#1D9E75] bg-emerald-50/50 text-emerald-700' : 'border-slate-200 bg-white hover:border-emerald-200 text-slate-600'}`}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#1D9E75] flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium">{m}</span>
                        </div>
                      )
                    })}
                  </div>
                  {selectedMonthsIndiv.length > 0 && (
                    <p className="text-xs text-emerald-600 font-medium mt-2">
                      เลือกแล้ว {selectedMonthsIndiv.length} เดือน
                    </p>
                  )}
                </div>
                
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 md:px-6 md:py-4 border-t border-slate-100 bg-white flex-shrink-0">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1 md:flex-none border-slate-200 hover:bg-slate-50"
          >
            ยกเลิก
          </Button>
          <Button 
            onClick={handleExport}
            disabled={isGenerating}
            className="flex-1 md:flex-none bg-[#1D9E75] hover:bg-[#157a5a] text-white shadow-lg shadow-[#1D9E75]/20 border-none"
          >
            {isGenerating ? 'กำลังสร้างไฟล์ PDF...' : 'ดาวน์โหลด PDF'}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  </>
  )
}
