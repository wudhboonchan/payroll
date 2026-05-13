import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, eachDayOfInterval, parseISO } from 'date-fns'
import { th } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../components/ui/table'
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '../components/ui/dialog'
import { Badge } from '../components/ui/badge'
import { Check, User, Clock, Calendar as CalendarIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip"

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix: string
  nationality: string
  position: string
}

interface ShiftAssignment {
  id: string
  employee_id: string
  work_date: string
  shift_type: 'morning' | 'afternoon' | 'night'
  is_half_shift: boolean
  is_holiday_ot: boolean
}

interface PayrollPeriod {
  id: string
  label: string
  period_start: string
  period_end: string
}

export default function AttendanceOverview() {
  const { user } = useAppStore()
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)

  // 1. Fetch all periods for selection
  const { data: allPeriods = [] } = useQuery({
    queryKey: ['all-periods', user?.factory_id],
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
    enabled: !!user?.factory_id
  })

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)

  const currentPeriod = useMemo(() => {
    if (selectedPeriodId) {
      return allPeriods.find(p => p.id === selectedPeriodId) || allPeriods[0]
    }
    return allPeriods[0]
  }, [allPeriods, selectedPeriodId])



  // 2. Fetch all employees
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-all', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, prefix, nationality, position')
        .eq('factory_id', user.factory_id)
        .neq('status', 'inactive')
        .order('employee_code', { ascending: true })
      if (error) throw error
      return data as Employee[]
    },
    enabled: !!user?.factory_id
  })

  // 3. Fetch all assignments for this period
  const { data: assignments = [] } = useQuery({
    queryKey: ['all-assignments-period', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('id, employee_id, work_date, shift_type, is_half_shift, is_holiday_ot')
        .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data as ShiftAssignment[]
    },
    enabled: !!currentPeriod?.id
  })

  // 4. Generate days of the period
  const periodDays = useMemo(() => {
    if (!currentPeriod) return []
    try {
      return eachDayOfInterval({
        start: parseISO(currentPeriod.period_start),
        end: parseISO(currentPeriod.period_end)
      })
    } catch (e) {
      return []
    }
  }, [currentPeriod])

  // 5. Build lookup map: employeeId -> dateStr -> assignment
  const assignmentMap = useMemo(() => {
    const map = new Map<string, Map<string, ShiftAssignment>>()
    assignments.forEach(a => {
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, new Map())
      }
      map.get(a.employee_id)?.set(a.work_date, a)
    })
    return map
  }, [assignments])

  const getShiftLabel = (type: string) => {
    switch (type) {
      case 'morning': return 'กะเช้า'
      case 'afternoon': return 'กะบ่าย'
      case 'night': return 'กะดึก'
      default: return type
    }
  }

  // Identify which dates are holidays (if any assignment on that date has is_holiday_ot = true)
  const holidayDates = useMemo(() => {
    const set = new Set<string>()
    assignments.forEach(a => {
      if (a.is_holiday_ot) {
        set.add(a.work_date)
      }
    })
    return set
  }, [assignments])

  // Summary for selected employee in modal
  const employeeSchedule = useMemo(() => {
    if (!selectedEmployee || !currentPeriod) return []
    const empMap = assignmentMap.get(selectedEmployee.id)
    return periodDays.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      return {
        date: day,
        assignment: empMap?.get(dateStr)
      }
    })
  }, [selectedEmployee, periodDays, assignmentMap, currentPeriod])

  if (!currentPeriod) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
          <CalendarIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800">ยังไม่มีงวดการจ่ายเงิน</h2>
          <p className="text-slate-500 mt-2">กรุณาสร้างงวดการจ่ายเงินก่อนเพื่อดูภาพรวมการเข้างาน</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full bg-white overflow-hidden">
        <TopBar 
          title="ภาพรวมการเข้างาน" 
          action={
            <div className="flex items-center gap-3">
              <div className="bg-white border border-slate-200 pl-4 pr-1 py-1.5 rounded-full shadow-sm flex items-center gap-1 min-h-[42px]">
                <CalendarIcon className="w-4 h-4 text-emerald-600 ml-1" />
                <span className="text-[15px] font-bold text-slate-700 ml-2 whitespace-nowrap">งวด:</span>
                <select 
                  className="bg-transparent text-[15px] font-bold text-slate-900 outline-none cursor-pointer pr-8 py-1 appearance-none relative"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%230f172a\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'3\' d=\'M19 9l-7 7-7-7\'%3E%3C/path%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right center', backgroundSize: '1em' }}
                  value={selectedPeriodId || allPeriods[0]?.id || ''}
                  onChange={(e) => setSelectedPeriodId(e.target.value)}
                >
                  {allPeriods.map(p => {
                    const start = parseISO(p.period_start)
                    const end = parseISO(p.period_end)
                    const thaiYear = start.getFullYear() + 543
                    const range = format(start, 'MMMM', { locale: th }) === format(end, 'MMMM', { locale: th }) 
                      ? `${format(start, 'd')} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                      : `${format(start, 'd MMMM', { locale: th })} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                    
                    return (
                      <option key={p.id} value={p.id} className="text-sm font-medium text-slate-700 bg-white">
                        {range}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>
          }
        />

        <div className="flex-1 overflow-auto p-6 bg-slate-50/30">
          <div className="max-w-[1600px] mx-auto space-y-6">
            
            {/* Legend */}
            <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm w-fit">
              <div className="flex items-center gap-2 pr-4 border-r border-slate-100">
                <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-sm" />
                <span className="text-xs font-bold text-slate-600">8 ชม. / เสมียน</span>
              </div>
              <div className="flex items-center gap-2 pr-4 border-r border-slate-100">
                <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                  <Check className="w-4 h-4 text-white" strokeWidth={4} />
                </div>
                <span className="text-xs font-bold text-slate-600">12 ชม. (เต็มกะ)</span>
              </div>
              <div className="flex items-center gap-2 pr-4 border-r border-slate-100">
                <div className="w-4 h-4 rounded bg-amber-100 border border-amber-300" />
                <span className="text-xs font-bold text-amber-700">วันหยุดนักขัตฤกษ์</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-slate-200 border border-slate-300" />
                <span className="text-xs font-bold text-slate-500">วันเสาร์ - อาทิตย์</span>
              </div>
            </div>

            {/* Attendance Spreadsheet */}
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <TooltipProvider delay={100}>
                  <Table className="border-collapse">
                    <TableHeader className="bg-slate-50/50">
                      <TableRow className="hover:bg-transparent border-b-2 border-slate-100">
                        <TableHead className="sticky left-0 z-30 bg-white min-w-[200px] w-[240px] border-r border-slate-200 shadow-[4px_0_8px_rgba(0,0,0,0.03)] px-6 py-5">
                          <span className="text-xs font-black text-slate-400 uppercase tracking-widest">รายชื่อพนักงาน</span>
                        </TableHead>
                        {periodDays.map(day => {
                          const dateStr = format(day, 'yyyy-MM-dd')
                          const isHoliday = holidayDates.has(dateStr)
                          const dayOfWeek = day.getDay()
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                          return (
                            <TableHead 
                              key={day.toISOString()} 
                              className={`text-center min-w-[50px] p-0 border-r border-slate-100 ${
                                isHoliday ? 'bg-amber-100/50' : isWeekend ? 'bg-slate-200/50' : ''
                              }`}
                            >
                              <div className="flex flex-col items-center justify-center py-2">
                                <span className={`text-[12px] font-black uppercase tracking-normal mb-0.5 ${
                                  isHoliday ? 'text-amber-700' : isWeekend ? 'text-slate-600' : 'text-slate-900'
                                }`}>
                                  {format(day, 'EEE', { locale: th })}
                                </span>
                                <span className={`text-sm font-black w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                                  isHoliday ? 'bg-amber-200 text-amber-900' : isWeekend ? 'bg-slate-300 text-slate-800' : 'text-slate-950'
                                }`}>
                                  {format(day, 'd')}
                                </span>
                              </div>
                            </TableHead>
                          )
                        })}
                        <TableHead className="text-center font-black text-slate-400 bg-slate-50 border-l border-slate-200 w-[60px] text-[10px] uppercase">รวม</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.map(emp => {
                        const empMap = assignmentMap.get(emp.id)
                        const isClerk = emp.position === 'clerk'
                        let workCount = 0

                        return (
                          <TableRow key={emp.id} className="hover:bg-slate-50/50 group">
                            <TableCell 
                              className="sticky left-0 z-10 bg-white border-r border-slate-100 font-medium text-slate-900 group-hover:bg-slate-50 cursor-pointer transition-colors"
                              onClick={() => setSelectedEmployee(emp)}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-lg ${isClerk ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
                                  <User className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold leading-none truncate max-w-[150px]">{emp.first_name} {emp.last_name}</span>
                                  <span className="text-[10px] text-slate-400 font-mono mt-1">{emp.employee_code} {isClerk && '• เสมียน'}</span>
                                </div>
                              </div>
                            </TableCell>
                            
                            {periodDays.map(day => {
                              const dateStr = format(day, 'yyyy-MM-dd')
                              const assignment = empMap?.get(dateStr)
                              const isHoliday = holidayDates.has(dateStr)
                              const dayOfWeek = day.getDay()
                              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
                              if (assignment) workCount++

                              return (
                                <TableCell 
                                  key={dateStr} 
                                  className={`p-0 border-r border-slate-50 h-16 transition-colors text-center ${
                                    isHoliday ? 'bg-amber-100/30' : isWeekend ? 'bg-slate-200/40' : 'group-hover:bg-slate-50/80'
                                  }`}
                                >
                                  {assignment ? (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <div className="w-full h-full flex items-center justify-center cursor-default">
                                          { (assignment.is_half_shift || isClerk) ? (
                                            /* 8 Hours - Solid Dot */
                                            <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] animate-in zoom-in-50 duration-300" />
                                          ) : (
                                            /* 12 Hours - Dot with Check */
                                            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-in zoom-in-50 duration-300">
                                              <Check className="w-3.5 h-3.5 text-white" strokeWidth={4} />
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent 
                                        side="top" 
                                        className="bg-slate-900 text-white border-none px-3 py-1.5 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                                      >
                                        <p className="text-xs font-black tracking-wide">{getShiftLabel(assignment.shift_type)}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <div className="w-full h-full" /> 
                                  )}
                                </TableCell>
                              )
                            })}

                            <TableCell className="text-center font-bold text-emerald-700 bg-emerald-50/30 border-l border-slate-100">
                              {workCount}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </div>

        {/* Individual Summary Modal */}
        <Dialog open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
          <DialogContent className="max-w-md p-0 overflow-hidden border-none shadow-2xl rounded-2xl">
            <div className="bg-[#1D9E75] p-6 text-white">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <Clock className="w-6 h-6" />
                  สรุปการเข้างานรายบุคคล
                </DialogTitle>
                <p className="text-emerald-100 mt-1 text-sm">
                  {selectedEmployee?.employee_code} — {selectedEmployee?.first_name} {selectedEmployee?.last_name}
                </p>
              </DialogHeader>
            </div>

            <div className="p-8 bg-white overflow-hidden flex flex-col">
              {/* Summary Stats Grid */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-emerald-50/50 border border-emerald-100 p-5 rounded-3xl">
                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest block mb-2">จำนวนวันทำงาน</span>
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-black text-emerald-700 leading-none">
                      {employeeSchedule.filter(s => s.assignment).length}
                    </span>
                    <span className="text-sm font-bold text-emerald-500 mb-1">/ {employeeSchedule.length} วัน</span>
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-5 rounded-3xl">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">กะที่เข้าบ่อย</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-700 leading-none">
                      {(() => {
                        const counts: Record<string, number> = {}
                        employeeSchedule.forEach(s => {
                          if (s.assignment && s.assignment.shift_type !== 'night') {
                            counts[s.assignment.shift_type] = (counts[s.assignment.shift_type] || 0) + 1
                          }
                        })
                        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
                        return top ? getShiftLabel(top[0]) : '---'
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Shift Distribution Summary */}
              <div className="mb-8 space-y-3 px-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">สัดส่วนช่วงเวลางาน</span>
                </div>
                <div className="h-8 w-full bg-slate-100 rounded-2xl flex overflow-hidden shadow-sm">
                  {(() => {
                    const total = employeeSchedule.filter(s => s.assignment).length
                    if (total === 0) return <div className="w-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">ไม่มีข้อมูลการเข้างาน</div>
                    
                    const shifts = [
                      { type: 'morning', color: 'bg-[#FFB020]', label: 'เช้า' },
                      { type: 'afternoon', color: 'bg-[#A855F7]', label: 'บ่าย' }
                    ]
                    
                    return shifts.map((item) => {
                      const count = employeeSchedule.filter(s => s.assignment?.shift_type === item.type).length
                      if (count === 0) return null
                      return (
                        <div 
                          key={item.type} 
                          className={`${item.color} h-full transition-all flex items-center justify-center min-w-max px-4`} 
                          style={{ width: `${(count / total) * 100}%` }}
                        >
                          <span className="text-xs font-black text-slate-900 whitespace-nowrap">
                             {item.label}: {count} วัน
                          </span>
                        </div>
                      )
                    })
                  })()}
                </div>
                <div className="flex gap-6 text-xs font-bold mt-2">
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#FFB020]" /> <span className="text-slate-600">กะเช้า</span></div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-[#A855F7]" /> <span className="text-slate-600">กะบ่าย</span></div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4 px-1">
                <CalendarIcon className="w-5 h-5 text-slate-400" />
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">รายการรายวัน</span>
              </div>

              <div className="flex flex-col gap-1 max-h-[45vh] overflow-y-auto pr-2 custom-scrollbar">
                {employeeSchedule.map((item, idx) => {
                  const hasWork = !!item.assignment
                  
                  return (
                    <div 
                      key={idx} 
                      className={`flex items-center justify-between px-5 py-4 rounded-2xl transition-all ${
                        hasWork 
                          ? 'bg-white border border-slate-100 shadow-sm hover:border-emerald-200' 
                          : 'opacity-30'
                      }`}
                    >
                      <div className="flex items-center gap-6">
                        {/* Day info */}
                        <div className="flex items-center gap-4 w-16">
                          <span className={`text-xl font-black w-6 text-center ${hasWork ? 'text-slate-900' : 'text-slate-400'}`}>
                            {format(item.date, 'd')}
                          </span>
                          <span className={`text-sm font-bold ${
                            hasWork ? 'text-slate-500' : 'text-slate-300'
                          }`}>
                            {format(item.date, 'EEE', { locale: th })}
                          </span>
                        </div>

                        {/* Shift Info */}
                        {hasWork ? (
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              item.assignment?.shift_type === 'morning' ? 'bg-[#FFB020]' : 'bg-[#A855F7]'
                            }`} />
                            <span className="text-sm font-bold text-slate-800">
                              {getShiftLabel(item.assignment?.shift_type || '')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 font-bold uppercase">ไม่มีกะ</span>
                        )}
                      </div>
                      
                      {hasWork && (
                        <div className="flex items-center gap-3">
                          {(() => {
                            const hours = (item.assignment?.is_half_shift || selectedEmployee?.position === 'clerk') ? '8 ชม.' : '12 ชม.'
                            const isEight = hours === '8 ชม.'
                            return (
                              <span className={`text-xs font-black px-3 py-1.5 rounded-xl border ${
                                isEight 
                                  ? 'bg-purple-50 text-purple-700 border-amber-200' 
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              }`}>
                                {hours}
                              </span>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setSelectedEmployee(null)}
                className="px-6 py-2 bg-[#1D9E75] text-white rounded-xl font-bold text-sm shadow-md hover:bg-[#157a5a] transition-all"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
