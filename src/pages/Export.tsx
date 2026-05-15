import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { toast } from 'sonner'
import {
  Grid,
  Download,
  Settings,
  Lock,
  FileText,
  Loader2
} from 'lucide-react'
import { formatPeriodLabel } from '../lib/formatters'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import PayslipExportModal from '../components/payroll/PayslipExportModal'

interface PayrollPeriod {
  id: string
  period_start: string
  period_end: string
  status: string | null
  factory_id: string
}

export default function Export() {
  const { user } = useAppStore()

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [exportType, setExportType] = useState<'month' | 'period'>('month')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [isExportingSSO, setIsExportingSSO] = useState(false)
  const [isExportingPayroll, setIsExportingPayroll] = useState(false)
  const [isPayslipModalOpen, setIsPayslipModalOpen] = useState(false)

  // Fetch periods first so we know what is available
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
      return data as PayrollPeriod[]
    },
    enabled: !!user?.factory_id,
  })

  // Extract unique months from periods
  const uniqueMonths = Array.from(new Set(periods.map((p: PayrollPeriod) => {
    const d = new Date(p.period_start)
    const thaiYear = d.getFullYear() + 543
    return `${format(d, 'MMMM', { locale: th })} ${thaiYear}`
  })))

  useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      const approved = periods.find((p: PayrollPeriod) => p.status === 'approved')
      const frame = requestAnimationFrame(() => {
        setSelectedPeriodId(approved?.id || periods[0].id)
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [periods, selectedPeriodId])

  useEffect(() => {
    if (uniqueMonths.length > 0 && !selectedMonth) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      const frame = requestAnimationFrame(() => {
        setSelectedMonth(uniqueMonths[0])
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [uniqueMonths, selectedMonth])

  const getPeriodsToExport = () => {
    if (exportType === 'period') {
      return selectedPeriodId ? [selectedPeriodId] : []
    } else {
      return periods
        .filter((p: PayrollPeriod) => {
          const d = new Date(p.period_start)
          const thaiYear = d.getFullYear() + 543
          const mLabel = `${format(d, 'MMMM', { locale: th })} ${thaiYear}`
          return mLabel === selectedMonth
        })
        .map((p: PayrollPeriod) => p.id)
    }
  }

  const getExportLabel = () => {
    if (exportType === 'period') {
      const p = periods.find((p: PayrollPeriod) => p.id === selectedPeriodId)
      return p ? formatPeriodLabel(p.period_start, p.period_end) : '—'
    } else {
      return selectedMonth
    }
  }

  const handleExportSSO = async () => {
    const periodIds = getPeriodsToExport()
    if (periodIds.length === 0) {
      toast.error('กรุณาเลือกช่วงเวลาที่ต้องการส่งออก')
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
        .in('period_id', periodIds)

      if (error) throw error

      if (!data || data.length === 0) {
        toast.error('ไม่พบข้อมูลการจ่ายเงินในช่วงเวลานี้')
        return
      }

      interface SSORow {
        amount_normal: number
        deduct_social_security: number
        employee: {
          national_id: string
          prefix: string
          first_name: string
          last_name: string
          nationality: string
        }
      }

      interface SSOExportItem {
        nat: string
        emp: SSORow['employee']
        amount_normal: number
        deduct_social_security: number
      }

      const ssoMap: Record<string, SSOExportItem> = {}

      // Only Thai nationals are subject to social security
      const validRows = (data as unknown as SSORow[]).filter(row => {
        if (!row.employee) return false
        const nat = row.employee.nationality || 'ไทย'
        return nat === 'ไทย'
      })

      validRows.forEach((row) => {
        const emp = row.employee
        const code = emp.national_id || emp.first_name

        if (!ssoMap[code]) {
          ssoMap[code] = {
            nat: 'ไทย',
            emp,
            amount_normal: 0,
            deduct_social_security: 0
          }
        }

        ssoMap[code].amount_normal += (row.amount_normal || 0)
        ssoMap[code].deduct_social_security += (row.deduct_social_security || 0)
      })

      interface SSOExportRow {
        'เลขบัตรประชาชน': string
        'คำนำหน้า': string
        'ชื่อ': string
        'สกุล': string
        'ค่าจ้าง': number
        'เงินสมทบ': number
      }

      const thaiRows: SSOExportRow[] = Object.values(ssoMap).map(({ emp, amount_normal, deduct_social_security }) => ({
        'เลขบัตรประชาชน': emp.national_id || '',
        'คำนำหน้า': emp.prefix || '',
        'ชื่อ': emp.first_name || '',
        'สกุล': emp.last_name || '',
        'ค่าจ้าง': amount_normal,
        'เงินสมทบ': Math.abs(deduct_social_security)
      }))

      if (thaiRows.length === 0) {
        toast.error('ไม่พบพนักงานสัญชาติไทยในงวดนี้')
        return
      }

      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.json_to_sheet(thaiRows)
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ประกันสังคม')

      const exportLabel = getExportLabel()
      const filename = `SSO_${exportLabel.replace(/[\s/*?:[\]]/g, '_')}.xlsx`
      XLSX.writeFile(workbook, filename)

      toast.success('ดาวน์โหลดฟอร์มประกันสังคมสำเร็จ')
    } catch (err: unknown) {
      console.error(err)
      const error = err as Error
      toast.error('เกิดข้อผิดพลาดในการ Export', { description: error.message })
    } finally {
      setIsExportingSSO(false)
    }
  }

interface PayrollRow {
  amount_normal: number;
  amount_shift: number;
  amount_ot: number;
  amount_wood_excess: number;
  amount_film: number;
  amount_special: number;
  amount_diligence: number;
  amount_position: number;
  deduct_social_security: number;
  deduct_advance: number;
  deduct_safety_equipment: number;
  deduct_uniform: number;
  employee: {
    employee_code: string;
    first_name: string;
    last_name: string;
  };
}

const handleExportPayrollSummary = async () => {
    const periodIds = getPeriodsToExport()
    if (periodIds.length === 0) {
      toast.error('กรุณาเลือกช่วงเวลาที่ต้องการส่งออก')
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
        .in('period_id', periodIds)

      if (error) throw error

      if (!data || data.length === 0) {
        toast.error('ไม่พบข้อมูลการจ่ายเงินในช่วงเวลานี้')
        return
      }

      interface ExportItem {
        emp: PayrollRow['employee']
        normal: number; shift: number; ot: number; wood: number; film: number; special: number; diligence: number; position: number;
        socSec: number; advance: number; safety: number; uniform: number
      }

      const exportDataMap: Record<string, ExportItem> = {}

      const validRows = (data as unknown as PayrollRow[]).filter(row => row.employee)
      
      validRows.forEach((row) => {
        const emp = row.employee
        const code = emp.employee_code

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

        if (!exportDataMap[code]) {
          exportDataMap[code] = {
            emp,
            normal: 0, shift: 0, ot: 0, wood: 0, film: 0, special: 0, diligence: 0, position: 0,
            socSec: 0, advance: 0, safety: 0, uniform: 0
          }
        }

        exportDataMap[code].normal += normal
        exportDataMap[code].shift += shift
        exportDataMap[code].ot += ot
        exportDataMap[code].wood += wood
        exportDataMap[code].film += film
        exportDataMap[code].special += special
        exportDataMap[code].diligence += diligence
        exportDataMap[code].position += position
        exportDataMap[code].socSec += socSec
        exportDataMap[code].advance += advance
        exportDataMap[code].safety += safety
        exportDataMap[code].uniform += uniform
      })

      const exportData = Object.values(exportDataMap)
        .map((item) => {
          const emp = item.emp

          const wageTotal = item.normal + item.shift
          const incomeTotal = wageTotal + item.ot + item.wood + item.film + item.special + item.diligence + item.position
          const deductionTotal = item.socSec + item.advance + item.safety + item.uniform
          const netTotal = incomeTotal - deductionTotal

          return {
            'รหัสพนักงาน': emp.employee_code || '',
            'ชื่อ-นามสกุล': `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
            'ค่าจ้างรวม': wageTotal,
            'ค่าจ้างปกติ': item.normal,
            'ค่ากะ': item.shift,
            'OT': item.ot,
            'ค่าไม้เกิน': item.wood,
            'ค่าฟิล์ม': item.film,
            'ค่าพิเศษ': item.special,
            'เบี้ยขยัน': item.diligence,
            'ค่าตำแหน่ง': item.position,
            'ประกันสังคม': item.socSec,
            'เบิกล่วงหน้า': item.advance,
            'ค่าอุปกรณ์ความปลอดภัย': item.safety,
            'ค่าเสื้อพนักงาน': item.uniform,
            'รวม': netTotal
          }
        })

      interface ExportResult {
        'รหัสพนักงาน': string
        'ชื่อ-นามสกุล': string
        'ค่าจ้างรวม': number
        'ค่าจ้างปกติ': number
        'ค่ากะ': number
        'OT': number
        'ค่าไม้เกิน': number
        'ค่าฟิล์ม': number
        'ค่าพิเศษ': number
        'เบี้ยขยัน': number
        'ค่าตำแหน่ง': number
        'ประกันสังคม': number
        'เบิกล่วงหน้า': number
        'ค่าอุปกรณ์ความปลอดภัย': number
        'ค่าเสื้อพนักงาน': number
        'รวม': number
      }

      if (exportData.length === 0) {
        toast.error('ไม่พบพนักงานในงวดนี้')
        return
      }

      // Sort by Employee Code
      (exportData as unknown as ExportResult[]).sort((a, b) => {
        return String(a['รหัสพนักงาน']).localeCompare(String(b['รหัสพนักงาน']))
      })

      const exportLabel = getExportLabel()
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([[`ค่าแรง ${exportLabel}`]])
      XLSX.utils.sheet_add_json(worksheet, exportData, { origin: 'A2', skipHeader: false })
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Summary')

      const filename = `Payroll_Summary_${exportLabel.replace(/[\s/*?:[\]]/g, '_')}.xlsx`
      XLSX.writeFile(workbook, filename)

      toast.success('ดาวน์โหลดตาราง Payroll รวมสำเร็จ')
    } catch (err: unknown) {
      console.error(err)
      const error = err as Error
      toast.error('เกิดข้อผิดพลาดในการ Export', { description: error.message })
    } finally {
      setIsExportingPayroll(false)
    }
  }

  const displayLabel = getExportLabel()

  return (
    <>
      <TopBar
        title="Export ข้อมูล"
        action={
          <div className="bg-white border border-slate-200 px-5 py-2 rounded-full shadow-sm flex items-center min-h-[42px]">
            <span className="text-[15px] font-bold text-slate-700">
              งวด: {displayLabel}
            </span>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-5xl mx-auto">

        {/* ── Filter Bar ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <select 
            className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]"
            value={exportType}
            onChange={e => setExportType(e.target.value as 'month' | 'period')}
          >
            <option value="month">ส่งออกแบบรายเดือน</option>
            <option value="period">ส่งออกแบบรายงวด</option>
          </select>

          {exportType === 'month' ? (
            <select
              className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]"
              value={selectedMonth || ''}
              onChange={e => setSelectedMonth(e.target.value)}
            >
              {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <select
              className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]"
              value={selectedPeriodId || ''}
              onChange={e => setSelectedPeriodId(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatPeriodLabel(p.period_start, p.period_end)}
                  {p.status === 'approved' ? ' ✅' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ── 3 Cards Grid ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Card 1: Excel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 shadow-sm flex flex-col items-start">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center mb-3">
              <Grid className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">ตาราง Payroll รวม</h3>
            <p className="text-slate-500 text-xs mb-4 leading-relaxed">
              ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx
            </p>
            <Button
              variant="outline"
              className="mt-auto w-full h-9 px-3 bg-green-50 border-green-100 text-green-700 hover:bg-green-100 hover:text-green-800 text-xs font-semibold disabled:opacity-50"
              onClick={handleExportPayrollSummary}
              disabled={isExportingPayroll || (exportType === 'period' && !selectedPeriodId)}
            >
              {isExportingPayroll ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
              {isExportingPayroll ? 'กำลังสร้างไฟล์...' : 'Download Excel'}
            </Button>
          </div>

          {/* Card 2: PDF */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 shadow-sm flex flex-col items-start">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center mb-3">
              <FileText className="w-5 h-5 text-red-500" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">PDF - Pay Slip รายบุคคล</h3>
            <p className="text-slate-500 text-xs mb-4 leading-relaxed">
              สร้างไฟล์ PDF Pay Slip แยกตามรายชื่อพนักงาน หรือพิมพ์ทั้งบริษัท
            </p>
            <Button
              variant="outline"
              className="mt-auto w-full h-9 px-3 bg-red-50 border-red-100 text-red-600 hover:bg-red-100 hover:text-red-700 text-xs font-semibold"
              onClick={() => setIsPayslipModalOpen(true)}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Download PDF
            </Button>
          </div>

          {/* Card 3: SSO */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 shadow-sm flex flex-col items-start">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3">
              <Grid className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 mb-1">ฟอร์มประกันสังคม</h3>
            <p className="text-slate-500 text-xs mb-4 leading-relaxed">
              Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน
            </p>
            <Button
              variant="outline"
              className="mt-auto w-full h-9 px-3 bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100 hover:text-amber-800 text-xs font-semibold disabled:opacity-50"
              onClick={handleExportSSO}
              disabled={isExportingSSO || (exportType === 'period' && !selectedPeriodId)}
            >
              {isExportingSSO ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
              {isExportingSSO ? 'กำลังสร้างไฟล์...' : 'Download Excel'}
            </Button>
          </div>

        </div>

        {/* ── Settings ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
            <Settings className="w-5 h-5 text-slate-600 flex-shrink-0" />
            <h3 className="font-bold text-slate-800 flex-1 truncate">การตั้งค่าระบบ</h3>
            <Badge variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-50 border-none px-2.5 py-0.5 rounded-full flex-shrink-0">
              <Lock className="w-3 h-3 mr-1 inline" />
              Admin
            </Badge>
          </div>
          <div className="p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-base font-bold text-slate-800">อัตราประกันสังคม (ฝั่งลูกจ้าง)</h4>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">คำนวณจากคอลัมน์ "ปกติ" (ค่าจ้างปกติ)</p>
            </div>
            <div className="flex items-center gap-3 self-start sm:self-auto">
              <div className="relative">
                <Input defaultValue="5" className="w-20 sm:w-24 text-center pr-8 h-10 sm:h-12 text-base sm:text-lg font-bold border-slate-200 focus:border-[#1D9E75]" />
                <span className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">%</span>
              </div>
              <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
          </div>
        </div>

      </div>

      <PayslipExportModal 
        isOpen={isPayslipModalOpen} 
        onClose={() => setIsPayslipModalOpen(false)} 
        uniqueMonths={uniqueMonths}
      />
    </>
  )
}
