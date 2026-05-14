import { useState, useMemo, useEffect } from 'react'
import { format, addDays, subDays, isWeekend } from 'date-fns'
import { th } from 'date-fns/locale'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Save,
  Search,
  Sun,
  Sunset,
  Moon,
  X,
  AlertCircle,
  Clock,
  Clock4,
  CheckCircle2
} from 'lucide-react'
import { formatEmployeeName } from '../lib/formatters'

import { ShiftColumn, type AssignedEmployee, type ShiftType } from '../components/shifts/ShiftColumn'

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  prefix: string
  nationality: string
  position: string
}

interface RawShiftAssignment {
  id: string
  employee_id: string
  shift_type: string
  is_holiday_ot: boolean
  is_half_shift: boolean
  wood_excess: number
  film_amount: number
  ot_hours: number
  is_cross_position: boolean
  cross_position_title: string
  cross_position_extra_pay: number
  employee: {
    employee_code: string
    first_name: string
    last_name: string
    prefix: string
    nationality: string
  }
}

export default function ShiftEntry() {
  const { user, companyContext } = useAppStore()
  const queryClient = useQueryClient()
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [isHolidayOT, setIsHolidayOT] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])
  const [assignments, setAssignments] = useState<AssignedEmployee[]>([])
  // Employee detail modal (item 7 & 8)
  const [detailModalEmp, setDetailModalEmp] = useState<AssignedEmployee | null>(null)
  // Tra Phet has only 2 shifts — hide night shift (item 3)
  // factoryName = "ผลิตภัณฑ์ตราเพชร", type = "Headquarters" (not useful for filtering)
  const isTraPhet =
    companyContext?.factoryName?.includes('ตราเพชร') ||
    companyContext?.factoryName?.toLowerCase().includes('diamond') ||
    companyContext?.name?.includes('ตราเพชร')

  // Reset holiday flag automatically when navigating to a new day
  const handleDateChange = (newDate: Date) => {
    setCurrentDate(newDate)
    setIsHolidayOT(false)
    setSelectedEmployeeIds([])
  }

  const formattedDate = format(currentDate, 'EEEEที่ d MMMM yyyy', { locale: th })
  const workDateStr = format(currentDate, 'yyyy-MM-dd')

  // Fetch all active employees for this factory
  const { data: employees = [] } = useQuery({
    queryKey: ['active-employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, prefix, nationality, position')
        .eq('factory_id', user.factory_id)
        .neq('status', 'inactive')
      if (error) throw error
      return data as Employee[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch the period that encompasses the selected date (item 6)
  const { data: periods = [] } = useQuery({
    queryKey: ['periods-for-date', workDateStr, user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const PERIOD_COLS = 'id, factory_id, label, period_start, period_end, status'

      // Find period where workDate is between start and end
      const { data, error } = await supabase
        .from('payroll_periods')
        .select(PERIOD_COLS)
        .eq('factory_id', user.factory_id)
        .lte('period_start', workDateStr)
        .gte('period_end', workDateStr)
        .order('period_start', { ascending: false })

      if (error) throw error

      // If no period found for this specific date, fallback to the latest one
      if (!data || data.length === 0) {
        const { data: latest, error: latestErr } = await supabase
          .from('payroll_periods')
          .select(PERIOD_COLS)
          .eq('factory_id', user.factory_id)
          .order('period_start', { ascending: false })
          .limit(1)
        if (latestErr) throw latestErr
        return latest || []
      }

      return data
    },
    enabled: !!user?.factory_id
  })

  const currentPeriod = periods[0]

  // Fetch existing assignments for the selected date
  const { data: existingAssignments = [], isLoading: isLoadingAssignments } = useQuery({
    queryKey: ['shifts-for-date', workDateStr, user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('shift_assignments' as any)
        .select(`
          id, employee_id, shift_type, is_holiday_ot,
          is_half_shift, wood_excess, film_amount, ot_hours,
          is_cross_position, cross_position_title, cross_position_extra_pay,
          employee:employees(employee_code, first_name, last_name, prefix, nationality)
        `)
        .eq('work_date', workDateStr)

      if (error) throw error
      return data as unknown as RawShiftAssignment[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch shift progress for the bottom bar
  const { data: progressData } = useQuery({
    queryKey: ['period-progress', currentPeriod?.id],
    queryFn: async () => {
      if (!currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('work_date')
        .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data
    },
    enabled: !!currentPeriod?.id
  })

  const filledDaysSet = new Set(
    progressData
      ?.filter(d => d.work_date !== workDateStr)
      .map(d => d.work_date) || []
  )

  if (assignments.length > 0) {
    filledDaysSet.add(workDateStr)
  }

  const daysFilled = filledDaysSet.size
  const totalDaysInPeriod = 15 // Assuming 15-day cycle
  const progressPercent = (daysFilled / totalDaysInPeriod) * 100

  // Synchronize state with database
  useEffect(() => {
    if (isLoadingAssignments || employees.length === 0 || !currentPeriod) {
      return
    }

    const frame = requestAnimationFrame(() => {
      const mapped = (existingAssignments && existingAssignments.length > 0)
        ? existingAssignments
          .filter((a) => !(isTraPhet && a.shift_type === 'night')) // กรองกะดึกออกถ้าเป็นตราเพชร
          .map((a) => {
            const emp = employees.find(e => e.id === a.employee_id)
            return {
              employee_id: a.employee_id,
              code: a.employee?.employee_code || emp?.employee_code || '?',
              name: formatEmployeeName({
                prefix: a.employee?.prefix || emp?.prefix,
                first_name: a.employee?.first_name || emp?.first_name || '',
                last_name: a.employee?.last_name || emp?.last_name || '',
                nationality: a.employee?.nationality || emp?.nationality,
              }),
              shift: a.shift_type as ShiftType,
              isNew: false,
              isHolidayOT: a.is_holiday_ot,
              isHalfShift: a.is_half_shift ?? false,
              woodExcess: Number(a.wood_excess ?? 0),
              filmAmount: Number(a.film_amount ?? 0),
              otHours: Number(a.ot_hours ?? 0),
              isClerk: emp?.position === 'clerk',
              isCrossPosition: a.is_cross_position ?? false,
              crossPositionTitle: a.cross_position_title || '',
              crossPositionExtraPay: Number(a.cross_position_extra_pay ?? 0),
            }
          })
        : []

      setAssignments(prev => {
        // Only update if the data actually changed (Deep compare to avoid loops)
        const currentSignature = JSON.stringify(mapped.map(m => m.employee_id + m.shift + m.isHalfShift + m.otHours + m.woodExcess))
        const prevSignature = JSON.stringify(prev.map(p => p.employee_id + p.shift + p.isHalfShift + p.otHours + p.woodExcess))

        if (currentSignature === prevSignature) {
          return prev
        }
        return mapped
      })

      if (existingAssignments && existingAssignments.length > 0) {
        setIsHolidayOT(existingAssignments[0].is_holiday_ot)
      } else {
        setIsHolidayOT(false)
      }
    });

    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDateStr, existingAssignments, employees.length, currentPeriod?.id])

  // Derived state: available pool (employees not in assignments, or assigned to hidden shifts)
  const availablePool = useMemo(() => {
    return employees.filter(emp => {
      const assignment = assignments.find(a => a.employee_id === emp.id)
      if (!assignment) return true  // not assigned → show in pool
      // If assigned to a hidden shift (night for isTraPhet), still show in pool
      if (isTraPhet && assignment.shift === 'night') return true
      return false  // assigned to a visible shift → hide from pool
    })
      .filter(emp =>
        (emp.employee_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (`${emp.first_name || ''} ${emp.last_name || ''}`).toLowerCase().includes(searchTerm.toLowerCase())
      )
  }, [employees, assignments, searchTerm, isTraPhet])

  const handleSelectEmployee = (id: string) => {
    setSelectedEmployeeIds(prev =>
      prev.includes(id) ? prev.filter(empId => empId !== id) : [...prev, id]
    )
  }

  const handleAssignToShift = (shift: ShiftType) => {
    if (selectedEmployeeIds.length === 0) return

    const empsToAssign = employees.filter(e => selectedEmployeeIds.includes(e.id))
    if (empsToAssign.length === 0) return

    if (isHolidayOT) {
      const hasClerk = empsToAssign.some(e => e.position === 'clerk')
      if (hasClerk) {
        toast.error("ไม่อนุญาตให้ลงกะพนักงานกลุ่ม 'เสมียน' ในวันหยุดนักขัตฤกษณ์")
        return
      }
    }

    const newAssignments = empsToAssign.map(emp => {
      const isClerk = emp.position === 'clerk'
      return {
        employee_id: emp.id,
        code: emp.employee_code,
        name: formatEmployeeName(emp),
        shift,
        isNew: true,
        isHolidayOT: isHolidayOT,
        isHalfShift: isClerk ? true : false,  // clerks always 8h
        woodExcess: 0,
        filmAmount: 0,
        otHours: 0,
        isClerk,
        isCrossPosition: false,
        crossPositionTitle: '',
        crossPositionExtraPay: 0,
      }
    })

    setAssignments(prev => [...prev, ...newAssignments])
    setSelectedEmployeeIds([])

    // Auto-open modal for the first clerk if it's a weekend
    if (isWeekend(currentDate)) {
      const firstClerk = newAssignments.find(a => a.isClerk)
      if (firstClerk) {
        setDetailModalEmp(firstClerk)
      }
    }
  }

  const handleRemoveAssignment = (employeeId: string) => {
    setAssignments(prev => prev.filter(a => a.employee_id !== employeeId))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user?.factory_id || !currentPeriod?.id) throw new Error("กรุณาสร้างงวดการจ่ายเงินก่อน")

      if (isHolidayOT) {
        const hasClerk = assignments.some(a => a.isClerk)
        if (hasClerk) {
          throw new Error("ไม่อนุญาตให้บันทึกพนักงานกลุ่ม 'เสมียน' ในวันหยุดนักขัตฤกษณ์")
        }
      }

      // Check Cross-Position Validation
      const invalidCrossPos = assignments.find(a => 
        a.isCrossPosition && (!a.crossPositionTitle || !a.crossPositionExtraPay)
      )
      if (invalidCrossPos) {
        throw new Error("กรุณาระบุข้อมูลตำแหน่งและเงินพิเศษให้ครบถ้วนสำหรับพนักงานที่มีการสลับตำแหน่ง")
      }

      // SAFETY GUARD: Prevent accidental deletion if UI state is empty or invalid
      if (assignments.length === 0) {
        const confirmClear = window.confirm("คุณกำลังจะลบข้อมูลกะทั้งหมดของวันนี้ ยืนยันหรือไม่?")
        if (!confirmClear) throw new Error("ยกเลิกการบันทึก")
      }

      if (assignments.length === 0) {
        // User cleared all assignments
        const { error } = await supabase
          .from('shift_assignments')
          .delete()
          .eq('period_id', currentPeriod?.id)
          .eq('work_date', workDateStr)
        if (error) throw error
        return
      }

      const payload = assignments.map(a => ({
        period_id: currentPeriod?.id,
        employee_id: a.employee_id,
        work_date: workDateStr,
        shift_type: a.shift,
        is_holiday_ot: isHolidayOT,
        is_half_shift: a.isHalfShift,
        wood_excess: a.isClerk ? 0 : a.woodExcess,
        film_amount: a.isClerk ? 0 : a.filmAmount,
        ot_hours: a.otHours,
        is_cross_position: a.isCrossPosition ?? false,
        cross_position_title: a.crossPositionTitle || '',
        cross_position_extra_pay: a.crossPositionExtraPay || 0,
        entered_by: user?.id
      }))

      // Upsert current assignments
      const { error: upsertError } = await supabase
        .from('shift_assignments' as any)
        .upsert(payload, { onConflict: 'employee_id, work_date' })

      if (upsertError) throw upsertError

      // Delete removed assignments
      const employeeIdsToKeep = assignments.map(a => a.employee_id)
      const { error: deleteError } = await supabase
        .from('shift_assignments')
        .delete()
        .eq('period_id', currentPeriod.id)
        .eq('work_date', workDateStr)
        .not('employee_id', 'in', `(${employeeIdsToKeep.join(',')})`)

      if (deleteError) throw deleteError
    },
    onSuccess: () => {
      // Invalidate all shift-related queries to keep PayrollEntry in sync
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
      queryClient.invalidateQueries({ queryKey: ['all-period-shifts'] })
      queryClient.invalidateQueries({ queryKey: ['shifts-for-date', workDateStr] })
      queryClient.invalidateQueries({ queryKey: ['period-progress', currentPeriod?.id] })
      
      toast.success(`บันทึกข้อมูลวันที่ ${formattedDate} สำเร็จ`)
    },
    onError: (error: Error) => {
      toast.error('เกิดข้อผิดพลาดในการบันทึก', { description: error.message })
    }
  })

  // Group assignments by shift
  const morningShifts = assignments.filter(a => a.shift === 'morning')
  const afternoonShifts = assignments.filter(a => a.shift === 'afternoon')
  const nightShifts = assignments.filter(a => a.shift === 'night')

  // Update a specific assignment field
  const updateAssignment = (empId: string, patch: Partial<AssignedEmployee>) => {
    setAssignments(prev => prev.map(a => a.employee_id === empId ? { ...a, ...patch } : a))
    setDetailModalEmp(prev => prev?.employee_id === empId ? { ...prev, ...patch } : prev)
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden bg-white">
        <TopBar
          title="ตารางลงกะการทำงาน"
          action={
            <div className="bg-white border border-slate-200 px-5 py-2 rounded-full shadow-sm flex items-center min-h-[42px]">
              <span className="text-[15px] font-bold text-slate-700">
                งวด: {currentPeriod ? (
                  (() => {
                    const start = new Date(currentPeriod.period_start)
                    const end = new Date(currentPeriod.period_end)
                    const thaiYear = start.getFullYear() + 543
                    return format(start, 'MMMM', { locale: th }) === format(end, 'MMMM', { locale: th })
                      ? `${format(start, 'd', { locale: th })} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                      : `${format(start, 'd MMMM', { locale: th })} - ${format(end, 'd MMMM', { locale: th })} ${thaiYear}`
                  })()
                ) : (
                  'ยังไม่ได้สร้างงวด'
                )}
              </span>
            </div>
          }
        />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Date Navigator & Action Controls */}
          <div className={`px-4 md:px-8 py-2 md:py-3 border-b flex flex-col lg:flex-row justify-between items-center gap-4 transition-colors shrink-0 ${isHolidayOT ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" onClick={() => handleDateChange(subDays(currentDate, 1))}>
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div className={`w-[260px] md:w-[320px] text-center px-2 py-2 rounded-xl font-bold text-lg md:text-xl transition-colors ${isHolidayOT
                  ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300'
                  : 'bg-[#1D9E75]/10 text-[#1D9E75] ring-2 ring-[#1D9E75]/30'
                }`}>
                {formattedDate}
              </div>
              <Button variant="outline" size="icon" onClick={() => handleDateChange(addDays(currentDate, 1))}>
                <ChevronRight className="w-5 h-5" />
              </Button>

              {isWeekend(currentDate) && (
                <Badge variant="outline" className="border-purple-400 text-purple-700 bg-purple-100/50 px-3 py-1.5 ml-2 whitespace-nowrap">
                  วันเสาร์-อาทิตย์
                </Badge>
              )}

              {isHolidayOT && (
                <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-100/50 px-3 py-1.5 ml-2 whitespace-nowrap">
                  คิดเรท OT วันหยุด (x2)
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                <Button
                  variant={!isHolidayOT ? 'default' : 'ghost'}
                  size="sm"
                  className={`rounded-lg px-4 ${!isHolidayOT ? 'bg-white text-slate-900 shadow-sm hover:bg-white' : 'text-slate-500'}`}
                  onClick={() => setIsHolidayOT(false)}
                >
                  วันปกติ
                </Button>
                <Button
                  variant={isHolidayOT ? 'default' : 'ghost'}
                  size="sm"
                  className={`rounded-lg px-4 ${isHolidayOT ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600' : 'text-slate-500'}`}
                  onClick={() => {
                    const hasClerk = assignments.some(a => a.isClerk)
                    if (hasClerk) {
                      toast.error("มีพนักงานกลุ่ม 'เสมียน' อยู่ในกะปัจจุบัน ไม่อนุญาตให้เปิด OT วันหยุด กรุณานำเสมียนออกก่อน")
                      return
                    }
                    setIsHolidayOT(true)
                  }}
                >
                  วันหยุดนักขัตฤกษ์
                </Button>
              </div>

              <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block" />

              <Button
                className="bg-[#1D9E75] hover:bg-[#157a5a] shadow-md px-6 py-2.5 rounded-xl text-base font-bold"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                <Save className="w-5 h-5 mr-2" />
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกวันนี้'}
              </Button>
            </div>
          </div>

          {/* Main Work Area */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

            {/* Left Panel: Employee Pool */}
            <div className="w-full md:w-80 border-b md:border-b-0 md:border-r bg-white flex flex-col h-[40vh] md:h-auto shrink-0">
              <div className="p-4 border-b shrink-0">
                <h3 className="font-semibold text-slate-800 mb-3">รายชื่อพนักงาน ({availablePool.length})</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    placeholder="ค้นหาพนักงาน..."
                    className="pl-9 bg-slate-50 h-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/30">
                {availablePool.map(emp => {
                  const isSelected = selectedEmployeeIds.includes(emp.id)

                  return (
                    <div
                      key={emp.id}
                      onClick={() => handleSelectEmployee(emp.id)}
                      className={`
                      relative p-3 pl-4 rounded-xl border cursor-pointer transition-all flex flex-col gap-1
                      ${isSelected
                          ? 'border-[#1D9E75] bg-[#1D9E75]/5 shadow-sm ring-1 ring-[#1D9E75]'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                        }
                    `}
                    >
                      {/* Selected Indicator Bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${isSelected ? 'bg-[#1D9E75]' : 'bg-slate-200'}`} />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {emp.position === 'clerk' ? '👩🏻‍🏫 ' : ''}{formatEmployeeName(emp)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 tabular-nums uppercase tracking-wider">{emp.employee_code}</span>
                          {emp.position === 'clerk' && (
                            <Badge className="bg-red-50 text-red-500 hover:bg-red-50 border-none text-[8px] px-1 py-0 h-3.5 font-bold uppercase">
                              เสมียน
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {availablePool.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-20 text-[#1D9E75]" />
                    <p className="text-sm">ลงกะครบทุกคนแล้ว</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Shift Columns */}
            <div className="flex-1 bg-slate-50/50 p-4 md:p-6 overflow-y-auto">

              {selectedEmployeeIds.length > 0 && (
                <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-800 px-3 md:px-4 py-3 rounded-lg flex items-start md:items-center shadow-sm animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-5 h-5 mr-3 text-blue-500 shrink-0 mt-0.5 md:mt-0" />
                  <span className="font-medium text-sm md:text-base">เลือกพนักงาน {selectedEmployeeIds.length} คน — คลิกที่กล่องกะด้านล่างเพื่อเพิ่มพร้อมกัน</span>
                </div>
              )}

              <div className={`grid grid-cols-1 gap-4 md:gap-6 md:h-full ${isTraPhet ? 'md:grid-cols-2' : 'md:grid-cols-3'
                }`}>
                {/* Morning Shift */}
                <ShiftColumn
                  title="กะเช้า"
                  time={isTraPhet ? '08:00 - 20:00' : '06:00 - 18:00'}
                  icon={<Sun className="w-5 h-5 text-amber-500" />}
                  assignments={morningShifts}
                  onAssign={() => handleAssignToShift('morning')}
                  onRemove={handleRemoveAssignment}
                  onClickEmployee={(emp: AssignedEmployee) => setDetailModalEmp(emp)}
                  isSelecting={selectedEmployeeIds.length > 0}
                />

                {/* Afternoon Shift */}
                <ShiftColumn
                  title="กะบ่าย"
                  time={isTraPhet ? '20:00 - 08:00' : '14:00 - 02:00'}
                  icon={<Sunset className="w-5 h-5 text-orange-500" />}
                  assignments={afternoonShifts}
                  onAssign={() => handleAssignToShift('afternoon')}
                  onRemove={handleRemoveAssignment}
                  onClickEmployee={(emp: AssignedEmployee) => setDetailModalEmp(emp)}
                  isSelecting={selectedEmployeeIds.length > 0}
                />

                {/* Night Shift — hidden for Tra Phet */}
                {!isTraPhet && (
                  <ShiftColumn
                    title="กะดึก"
                    time="22:00 - 10:00"
                    icon={<Moon className="w-5 h-5 text-indigo-500" />}
                    assignments={nightShifts}
                    onAssign={() => handleAssignToShift('night')}
                    onRemove={handleRemoveAssignment}
                    onClickEmployee={(emp: AssignedEmployee) => setDetailModalEmp(emp)}
                    isSelecting={selectedEmployeeIds.length > 0}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Completeness Indicator Bottom Bar */}
          <div className="h-auto md:h-14 bg-white border-t px-4 md:px-8 py-3 md:py-0 flex flex-col md:flex-row items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-10 gap-3 md:gap-0 shrink-0">
            <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
              <span className="text-xs md:text-sm font-medium text-slate-600">ความคืบหน้างวดนี้:</span>
              <div className="flex-1 md:w-64 h-2.5 bg-slate-100 rounded-full overflow-hidden mx-2 md:mx-0">
                <div
                  className="h-full bg-[#1D9E75] transition-all duration-500 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <span className="text-xs md:text-sm font-bold text-slate-800 shrink-0">{daysFilled} / {totalDaysInPeriod} วัน</span>
            </div>

            <div className="flex gap-1 md:gap-1.5 flex-wrap justify-center hidden sm:flex">
              {/* Real dots based on assignments in period */}
              {Array.from({ length: totalDaysInPeriod }).map((_, i) => {
                // This is simplified; in a full version we'd match the specific date index
                const isFilled = i < daysFilled;
                return (
                  <div
                    key={i}
                    className={`w-2 md:w-2.5 h-2 md:h-2.5 rounded-full transition-colors ${isFilled ? 'bg-[#1D9E75]' : 'bg-slate-200'}`}
                    title={`วันที่ ${i + 1}`}
                  />
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Employee Detail Modal */}
      {detailModalEmp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setDetailModalEmp(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-slate-900 text-xl leading-tight">
                  {detailModalEmp.isClerk ? '👩🏻‍🏫 ' : ''}{detailModalEmp.name}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold text-slate-400 tabular-nums">
                    รหัส: {detailModalEmp.code}
                  </span>
                  {detailModalEmp.isClerk && (
                    <span className="text-[10px] bg-red-50 text-red-500 font-bold px-2 py-0.5 rounded uppercase tracking-wider border border-red-100">เสมียน</span>
                  )}
                </div>
              </div>
              <button onClick={() => setDetailModalEmp(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailModalEmp.isClerk ? (
              /* ── Clerk Modal: OT hours only ── */
              <>
                {isWeekend(currentDate) ? (
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-700">
                    ✨ <strong>เสมียนทำงานวันหยุด (เสาร์-อาทิตย์)</strong><br />
                    จะได้รับค่าล่วงเวลาเป็น <strong>OT 1 เท่า</strong> ตามจำนวนชั่วโมงที่กรอก
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                    👩🏻‍🏫 เสมียนทำงาน <strong>8 ชม./วัน</strong> โดยอัตโนมัติ ไม่มีค่ากะ<br />
                    ชั่วโมงเกิน 8 ชม. คิดเป็น OT 1.5 เท่า
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">
                    {isWeekend(currentDate) ? 'ชั่วโมงทำงานวันหยุด (ได้เรท OT 1 เท่า)' : 'ชั่วโมง OT วันนี้ (เกิน 8 ชม.)'}
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      max="16"
                      value={detailModalEmp.otHours || ''}
                      onChange={e => updateAssignment(detailModalEmp.employee_id, { otHours: Number(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-28 h-10 text-center text-lg font-bold"
                    />
                    <span className="text-slate-500 text-sm">ชั่วโมง</span>
                  </div>
                </div>
              </>
            ) : (
              /* ── Worker Modal: 8/12h toggle + wood/film ── */
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">ชั่วโมงทำงาน</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateAssignment(detailModalEmp.employee_id, { isHalfShift: false })}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${!detailModalEmp.isHalfShift
                          ? 'border-[#1D9E75] bg-[#1D9E75]/10 text-[#1D9E75]'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                    >
                      <Clock className="w-5 h-5" />
                      <span className="text-xs font-bold">{isHolidayOT ? '12 ชม. (OT วันหยุด)' : '12 ชม. (เต็ม)'}</span>
                      <span className="text-[10px]">{isHolidayOT ? 'ได้เรท OT 2 เท่า' : 'ปกติ + ค่ากะ'}</span>
                    </button>
                    <button
                      onClick={() => updateAssignment(detailModalEmp.employee_id, { isHalfShift: true })}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${detailModalEmp.isHalfShift
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                    >
                      <Clock4 className="w-5 h-5" />
                      <span className="text-xs font-bold">{isHolidayOT ? '8 ชม. (OT วันหยุด)' : '8 ชม. เท่านั้น'}</span>
                      <span className="text-[10px]">{isHolidayOT ? 'ได้เรท OT 2 เท่า' : 'ค่าปกติ (ไม่มีค่ากะ)'}</span>
                    </button>
                  </div>
                  {detailModalEmp.isHalfShift && (
                    <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                      ⚠️ วันนี้จะไม่ถูกนับค่ากะ (4 ชม.)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">ชั่วโมง OT (ถ้ามี)</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min="0" step="0.5"
                      value={detailModalEmp.otHours || ''}
                      onChange={e => updateAssignment(detailModalEmp.employee_id, { otHours: Number(e.target.value) || 0 })}
                      placeholder="0" className="w-24 h-9 text-center font-bold"
                    />
                    <span className="text-slate-500 text-xs">ชม.</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">ค่าไม้ส่วนเกิน (บาท)</Label>
                    <Input
                      type="number" min="0"
                      value={detailModalEmp.woodExcess || ''}
                      onChange={e => updateAssignment(detailModalEmp.employee_id, { woodExcess: Number(e.target.value) || 0 })}
                      placeholder="0" className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">ค่าฟิล์ม (บาท)</Label>
                    <Input
                      type="number" min="0"
                      value={detailModalEmp.filmAmount || ''}
                      onChange={e => updateAssignment(detailModalEmp.employee_id, { filmAmount: Number(e.target.value) || 0 })}
                      placeholder="0" className="h-9"
                    />
                  </div>
                </div>

                {/* ── Job Rotation (Cross-position) ── */}
                <div className="pt-2 border-t space-y-3">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="cross-pos"
                      checked={detailModalEmp.isCrossPosition}
                      onChange={e => {
                        const isChecked = e.target.checked
                        updateAssignment(detailModalEmp.employee_id, { 
                          isCrossPosition: isChecked,
                          // Clear data if unchecked
                          ...(isChecked ? {} : { crossPositionTitle: '', crossPositionExtraPay: 0 })
                        })
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#1D9E75] focus:ring-[#1D9E75]"
                    />
                    <Label htmlFor="cross-pos" className="text-sm font-bold text-slate-700 cursor-pointer">ทำงานข้ามตำแหน่ง (Job Rotation)</Label>
                  </div>
                  
                  {detailModalEmp.isCrossPosition && (
                    <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-1">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-500">ตำแหน่งที่ทำแทน <span className="text-red-500">*</span></Label>
                        <Input 
                          placeholder="ระบุตำแหน่ง เช่น ขับรถโฟล์คลิฟท์"
                          value={detailModalEmp.crossPositionTitle || ''}
                          onChange={e => updateAssignment(detailModalEmp.employee_id, { crossPositionTitle: e.target.value })}
                          className={`h-9 ${!detailModalEmp.crossPositionTitle ? 'border-red-200 focus:border-red-300' : ''}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-500">เงินพิเศษที่ได้รับเพิ่ม (บาท/วัน) <span className="text-red-500">*</span></Label>
                        <Input 
                          type="number"
                          placeholder="ระบุจำนวนเงิน เช่น 300"
                          value={detailModalEmp.crossPositionExtraPay || ''}
                          onChange={e => updateAssignment(detailModalEmp.employee_id, { crossPositionExtraPay: Number(e.target.value) || 0 })}
                          className={`h-9 ${!detailModalEmp.crossPositionExtraPay ? 'border-red-200 focus:border-red-300' : ''}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <Button
              className="w-full bg-[#1D9E75] hover:bg-[#157a5a]"
              onClick={() => {
                if (detailModalEmp.isCrossPosition) {
                  if (!detailModalEmp.crossPositionTitle || !detailModalEmp.crossPositionExtraPay) {
                    toast.error('กรุณาระบุตำแหน่งและเงินพิเศษ', {
                      description: 'เมื่อเลือก "ทำงานข้ามตำแหน่ง" ต้องระบุข้อมูลให้ครบถ้วน'
                    })
                    return
                  }
                }
                setDetailModalEmp(null)
              }}
            >
              บันทึก
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

