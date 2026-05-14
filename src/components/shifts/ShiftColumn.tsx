import React from 'react'
import { X } from 'lucide-react'
import { Badge } from '../ui/badge'

export type ShiftType = 'morning' | 'afternoon' | 'night'

export interface AssignedEmployee {
  employee_id: string
  code: string
  name: string
  shift: ShiftType
  isNew: boolean
  isHolidayOT: boolean
  isHalfShift: boolean
  woodExcess: number
  filmAmount: number
  otHours: number
  isClerk: boolean
  isCrossPosition?: boolean
  crossPositionTitle?: string
  crossPositionExtraPay?: number
}

interface ShiftColumnProps {
  title: string
  time: string
  icon: React.ReactNode
  assignments: AssignedEmployee[]
  onAssign: () => void
  onRemove: (id: string) => void
  onClickEmployee: (emp: AssignedEmployee) => void
  isSelecting: boolean
}

export function ShiftColumn({ 
  title, 
  time, 
  icon, 
  assignments, 
  onAssign, 
  onRemove, 
  onClickEmployee, 
  isSelecting 
}: ShiftColumnProps) {
  return (
    <div 
      className={`
        bg-white rounded-xl border flex flex-col overflow-hidden transition-all duration-200
        ${isSelecting ? 'ring-2 ring-dashed ring-blue-300 hover:ring-blue-500 hover:bg-blue-50/30 cursor-pointer' : 'border-slate-200'}
      `}
      onClick={isSelecting ? onAssign : undefined}
    >
      <div className="p-4 border-b bg-slate-50/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100">
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{time}</p>
          </div>
        </div>
        <Badge variant="secondary" className="bg-slate-200/50 text-slate-600">{assignments.length} คน</Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {assignments.map((emp: AssignedEmployee) => (
          <div 
            key={emp.employee_id} 
            className="group flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="flex-1 text-left"
              onClick={() => onClickEmployee(emp)}
              title={emp.isClerk ? 'คลิกเพื่อกรอก OT ชั่วโมง' : 'คลิกเพื่อตั้งค่าชั่วโมงทำงาน / ค่าไม้ / ค่าฟิล์ม'}
            >
              <div className="flex flex-col">
                <p className="text-sm font-bold text-slate-900 leading-tight">
                  {emp.isClerk ? '👩🏻‍🏫 ' : ''}{emp.name}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                    {emp.code}
                  </span>
                  {emp.isNew && (
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none text-[10px] px-1.5 py-0 h-4">ใหม่</Badge>
                  )}
                  {emp.isClerk && (
                    <Badge className="bg-red-100 text-red-600 hover:bg-red-100 border-none text-[10px] px-1.5 py-0 h-4">เสมียน</Badge>
                  )}
                  {!emp.isClerk && emp.isHalfShift && (
                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[10px] px-1.5 py-0 h-4">ทำงาน 8 ชม.</Badge>
                  )}
                  {emp.isClerk && emp.otHours > 0 && (
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-none text-[10px] px-1.5 py-0 h-4">มี OT {emp.otHours}ชม.</Badge>
                  )}
                  {!emp.isClerk && emp.woodExcess > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] px-1.5 py-0 h-4">+ค่าไม้</Badge>
                  )}
                  {!emp.isClerk && emp.filmAmount > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] px-1.5 py-0 h-4">+ค่าฟิล์ม</Badge>
                  )}
                  {emp.isHolidayOT && (
                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[10px] px-1.5 py-0 h-4">Holiday OT</Badge>
                  )}
                  {emp.isCrossPosition && (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none text-[10px] px-1.5 py-0 h-4">สลับตำแหน่ง</Badge>
                  )}
                </div>
              </div>
            </button>
            
            <button 
              onClick={() => onRemove(emp.employee_id)}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all ml-2 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        {isSelecting && assignments.length === 0 && (
          <div className="h-full min-h-[120px] flex items-center justify-center border-2 border-dashed border-blue-200 rounded-lg bg-blue-50/50">
            <span className="text-sm font-medium text-blue-500">คลิกที่นี่เพื่อเพิ่มพนักงานเข้ากะ</span>
          </div>
        )}
      </div>
    </div>
  )
}
