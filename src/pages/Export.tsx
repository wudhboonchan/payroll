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
  ArrowRight
} from 'lucide-react'

export default function Export() {
  const { user } = useAppStore()
  const navigate = useNavigate()

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)

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
    ? `${selectedPeriod.label || selectedPeriod.period_start + ' – ' + selectedPeriod.period_end}`
    : '—'

  // Mockup Data for Filters
  const months = ['ม.ค. 2569', 'ก.พ. 2569', 'มี.ค. 2569', 'เม.ย. 2569']

  return (
    <>
      <TopBar 
        title="Export ข้อมูล" 
        action={
          <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 text-sm font-medium border-slate-200">
            <Calendar className="w-4 h-4 mr-2" />
            ค่าแรง {periodLabel}
          </Badge>
        }
      />

      <div className="p-8 space-y-8 max-w-5xl mx-auto">

        {/* ── Filter Bar ─────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-6">
          <select className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]">
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          
          <select 
            className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]"
            value={selectedPeriodId || ''}
            onChange={e => setSelectedPeriodId(e.target.value)}
          >
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.label || `${p.period_start} – ${p.period_end}`}
                {p.status === 'approved' ? ' ✅' : ' (ร่าง)'}
              </option>
            ))}
          </select>

          <select className="h-12 rounded-xl border border-slate-200 px-4 text-base bg-white font-medium shadow-sm outline-none focus:border-[#1D9E75]">
            <option>พนักงานทุกคน</option>
          </select>
        </div>

        {/* ── 4 Cards Grid ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          
          {/* Card 1: Excel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
              <Grid className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Excel - ตาราง Payroll รวม</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx เหมือน DB_FormPayroll ต้นฉบับ
            </p>
            <Button variant="outline" className="mt-auto h-11 px-6 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50" onClick={() => toast.info('ฟีเจอร์นี้กำลังพัฒนา')}>
              <Download className="w-4 h-4 mr-2" /> Download Excel
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

          {/* Card 3: Link */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-5">
              <Link2 className="w-6 h-6 text-blue-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Shareable Link สำหรับพนักงาน</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              Generate ลิงก์ส่วนตัวให้พนักงานแต่ละคนเข้าดู Pay Slip ของตัวเอง
            </p>
            <Button 
              variant="outline" 
              className="mt-auto h-11 px-6 bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 hover:text-blue-700 font-semibold"
              onClick={() => navigate('/share-links')}
            >
              ไปที่เมนูสร้างลิงก์ <ArrowRight className="w-4 h-4 ml-2" /> 
            </Button>
          </div>

          {/* Card 4: SSO */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-start">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-5">
              <FileText className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">ฟอร์ม ปกส.</h3>
            <p className="text-slate-500 text-sm mb-8 min-h-[40px]">
              Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน
            </p>
            <Button variant="outline" className="mt-auto h-11 px-6 bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100 hover:text-amber-800 font-semibold" onClick={() => toast.info('ฟีเจอร์นี้กำลังพัฒนา')}>
              <Download className="w-4 h-4 mr-2" /> Download
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
              SuperUser only
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
