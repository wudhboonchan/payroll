import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  Grid,
  Download,
  Link2,
  Settings,
  Lock,
  FileText,
  ArrowRight,
  Loader2
} from 'lucide-react'
import { formatPeriodLabel } from '../lib/formatters'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'

export default function Export() {
  const { user } = useAppStore()
  const navigate = useNavigate()

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [isExportingSSO, setIsExportingSSO] = useState(false)
  const [isExportingPayroll, setIsExportingPayroll] = useState(false)

  const handleExportSSO = async () => {
    if (!selectedPeriodId) {
      toast.error('กรุณาเลือกงวดการจ่ายเงิน')
      return
    }

    setIsExportingSSO(true)
    try {
      const XLSX = await import('xlsx')

      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          amount_normal,
          deduct_social_security,
          employee:employees(
            national_id,
            prefix,
            first_name,
            last_name,
            nationality
          )
        `)
        .eq('period_id', selectedPeriodId)

      if (error) throw error

      if (!data || data.length === 0) {
        toast.error('ไม่พบข้อมูลการจ่ายเงินในงวดนี้')
        return
      }

      const groupedData: Record<string, any[]> = {}

      data.filter((row: any) => row.employee).forEach((row: any) => {
        const emp = row.employee
        const nat = emp.nationality || 'ไทย'

        if (!groupedData[nat]) {
          groupedData[nat] = []
        }

        groupedData[nat].push({
          'เลขบัตรประชาชน': emp.national_id || '',
          'คำนำหน้า': emp.prefix || '',
          'ชื่อ': emp.first_name || '',
          'สกุล': emp.last_name || '',
          'ค่าจ้าง': row.amount_normal || 0,
          'เงินสมทบ': row.deduct_social_security || 0
        })
      })

      if (Object.keys(groupedData).length === 0) {
        toast.error('ไม่พบพนักงานในงวดนี้')
        return
      }

      const workbook = XLSX.utils.book_new()

      for (const [nationality, employeesData] of Object.entries(groupedData)) {
        // Sanitize sheet name: Excel allows max 31 characters and restricts some symbols
        let safeSheetName = nationality.replace(/[\\/*?:[\]]/g, '').substring(0, 31)
        if (!safeSheetName) safeSheetName = 'Sheet'

        const worksheet = XLSX.utils.json_to_sheet(employeesData)
        XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName)
      }

      const filename = `SSO_${periodLabel.replace(/\\s+/g, '_')}.xlsx`
      XLSX.writeFile(workbook, filename)

      toast.success('ดาวน์โหลดฟอร์มประกันสังคมสำเร็จ')
    } catch (err: any) {
      console.error(err)
      toast.error('เกิดข้อผิดพลาดในการ Export', { description: err.message })
    } finally {
      setIsExportingSSO(false)
    }
  }

  const handleExportPayrollSummary = async () => {
    if (!selectedPeriodId) {
      toast.error('กรุณาเลือกงวดการจ่ายเงิน')
      return
    }
    
    setIsExportingPayroll(true)
    try {
      const XLSX = await import('xlsx')
      
      const { data, error } = await supabase
        .from('payroll_entries')
        .select(`
          amount_normal,
          amount_shift,
          amount_ot,
          amount_wood_excess,
          amount_film,
          amount_special,
          amount_diligence,
          amount_position,
          deduct_social_security,
          deduct_advance,
          deduct_safety_equipment,
          deduct_uniform,
          employee:employees(
            employee_code,
            first_name,
            last_name
          )
        `)
        .eq('period_id', selectedPeriodId)

      if (error) throw error

      if (!data || data.length === 0) {
        toast.error('ไม่พบข้อมูลการจ่ายเงินในงวดนี้')
        return
      }

      const exportData = data
        .filter((row: any) => row.employee) 
        .map((row: any) => {
          const emp = row.employee

          // Get values or default to 0
          const normal = row.amount_normal || 0
          const shift = row.amount_shift || 0
          const ot = row.amount_ot || 0
          const wood = row.amount_wood_excess || 0
          const film = row.amount_film || 0
          const special = row.amount_special || 0
          const diligence = row.amount_diligence || 0
          const position = row.amount_position || 0

          const socSec = Math.abs(row.deduct_social_security || 0)
          const advance = Math.abs(row.deduct_advance || 0)
          const safety = Math.abs(row.deduct_safety_equipment || 0)
          const uniform = Math.abs(row.deduct_uniform || 0)

          const wageTotal = normal + shift
          const incomeTotal = wageTotal + ot + wood + film + special + diligence + position
          const deductionTotal = socSec + advance + safety + uniform
          const netTotal = incomeTotal - deductionTotal

          return {
            'รหัสพนักงาน': emp.employee_code || '',
            'ชื่อ-นามสกุล': `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
            'ค่าจ้างรวม': wageTotal,
            'ค่าจ้างปกติ': normal,
            'ค่ากะ': shift,
            'OT': ot,
            'ค่าไม้เกิน': wood,
            'ค่าฟิล์ม': film,
            'ค่าพิเศษ': special,
            'เบี้ยขยัน': diligence,
            'ค่าตำแหน่ง': position,
            'ประกันสังคม': socSec,
            'เบิกล่วงหน้า': advance,
            'ค่าอุปกรณ์ความปลอดภัย': safety,
            'ค่าเสื้อพนักงาน': uniform,
            'รวม': netTotal
          }
        })

      if (exportData.length === 0) {
        toast.error('ไม่พบพนักงานในงวดนี้')
        return
      }

      // Sort by Employee Code
      exportData.sort((a, b) => {
        return String(a['รหัสพนักงาน']).localeCompare(String(b['รหัสพนักงาน']))
      })

      // Start JSON data at row 2 so we can add a title on row 1
      const worksheet = XLSX.utils.json_to_sheet(exportData, { origin: 'A2' })
      XLSX.utils.sheet_add_aoa(worksheet, [[`ค่าแรง ${periodLabel}`]], { origin: 'A1' })

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Summary')

      const filename = `Payroll_Summary_${periodLabel.replace(/[\\s/\\*?:[\]]/g, '_')}.xlsx`
      XLSX.writeFile(workbook, filename)

      toast.success('ดาวน์โหลดตาราง Payroll รวมสำเร็จ')
    } catch (err: any) {
      console.error(err)
      toast.error('เกิดข้อผิดพลาดในการ Export', { description: err.message })
    } finally {
      setIsExportingPayroll(false)
    }
  }

  const { data: periods = [] } = useQuery({
    queryKey: ['periods', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .eq('factory_id', user.factory_id)
        .order('period_start', { ascending: false })
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.factory_id,
  })

  useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) {
      const approved = periods.find((p: any) => p.status === 'approved')
      setSelectedPeriodId(approved?.id || periods[0].id)
    }
  }, [periods, selectedPeriodId])

  const selectedPeriod = periods.find((p: any) => p.id === selectedPeriodId)
  const periodLabel = selectedPeriod
    ? formatPeriodLabel(selectedPeriod.period_start, selectedPeriod.period_end)
    : '—'

  // Extract unique months from periods
  const uniqueMonths = Array.from(new Set(periods.map((p: any) => {
    return format(new Date(p.period_start), 'MMM yyyy', { locale: th })
  })))

  return (
    <>
      <TopBar
        title="Export ข้อมูล"
        action={
          <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 text-sm font-medium border-slate-200">
            <Calendar className="w-4 h-4 mr-2" />
            งวด {periodLabel}
          </Badge>
        }
      />

      <div className="p-8 space-y-8 max-w-5xl mx-auto">

        {/* ── Filter Bar ─────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-6">
          <select className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]">
            {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]"
            value={selectedPeriodId || ''}
            onChange={e => setSelectedPeriodId(e.target.value)}
          >
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {formatPeriodLabel(p.period_start, p.period_end)}
                {p.status === 'approved' ? ' ✅' : ''}
              </option>
            ))}
          </select>

          <select className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]">
            <option>พนักงานทุกคน</option>
          </select>
        </div>

        {/* ── 3 Cards Grid ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Card 1: Excel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
              <Grid className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">ตาราง Payroll รวม</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx
            </p>
            <Button 
              variant="outline" 
              className="mt-auto h-11 px-6 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50"
              onClick={handleExportPayrollSummary}
              disabled={isExportingPayroll || !selectedPeriodId}
            >
              {isExportingPayroll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} 
              {isExportingPayroll ? 'กำลังสร้างไฟล์...' : 'Download Excel'}
            </Button>
          </div>

          {/* Card 2: PDF */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-5">
              <FileText className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">PDF - Pay Slip รายบุคคล</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              สร้างไฟล์ PDF Pay Slip แยกตามรายชื่อพนักงาน หรือรวมเป็นไฟล์เดียว
            </p>
            <Button variant="outline" className="mt-auto h-11 px-6 bg-red-50 border-red-100 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold" onClick={() => toast.info('ฟีเจอร์นี้กำลังพัฒนา')}>
              <Download className="w-4 h-4 mr-2" /> Download PDF
            </Button>
          </div>



          {/* Card 4: SSO */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-5">
              <FileText className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">ฟอร์มประกันสังคม</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน
            </p>
            <Button
              variant="outline"
              className="mt-auto h-11 px-6 bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100 hover:text-amber-800 font-semibold disabled:opacity-50"
              onClick={handleExportSSO}
              disabled={isExportingSSO || !selectedPeriodId}
            >
              {isExportingSSO ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              {isExportingSSO ? 'กำลังสร้างไฟล์...' : 'Download'}
            </Button>
          </div>

        </div>

        {/* ── Settings ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
            <Settings className="w-5 h-5 text-slate-600" />
            <h3 className="font-bold text-slate-800">การตั้งค่าระบบ</h3>
            <Badge variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-50 border-none px-2.5 py-0.5 rounded-full">
              <Lock className="w-3 h-3 mr-1 inline" />
              Admin only
            </Badge>
          </div>
          <div className="p-6 flex items-center justify-between">
            <div>
              <h4 className="text-base font-bold text-slate-800">อัตราประกันสังคม (ฝั่งลูกจ้าง)</h4>
              <p className="text-sm text-slate-500 mt-1">คำนวณจากคอลัมน์ "ปกติ" (ค่าจ้างปกติ)</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Input defaultValue="5" className="w-24 text-center pr-8 h-12 text-lg font-bold border-slate-200 focus:border-[#1D9E75]" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">%</span>
              </div>
              <Lock className="w-5 h-5 text-blue-400" />
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
