import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { Search, Save, Lock, Edit2, AlertCircle, CheckCircle2, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { formatThaiCurrency } from '../lib/formatters'
import { calculateTraPhetPayroll } from '../lib/payrollCalc'
import type { PayrollCalculationInput } from '../lib/payrollCalc'
import { formatEmployeeName } from './EmployeeFormModal'

export default function PayrollEntry() {
  const { user } = useAppStore()

  const queryClient = useQueryClient()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [socialSecurityRate, setSocialSecurityRate] = useState(0.05)
  const [isApproved, setIsApproved] = useState(false)

  // Override states
  const [overrideNormal, setOverrideNormal] = useState<number | null>(null)
  const [isEditingNormal, setIsEditingNormal] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  // Form states for manual entries
  const [manualEntries, setManualEntries] = useState({
    amount_wood_excess: 0,
    amount_film: 0,
    amount_special: 0,
    amount_diligence: 0,
    amount_position: 0,
    deduct_safety_equipment: 0,
    deduct_uniform: 0
  })

  // Fetch employees
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', user?.factory_id],
    queryFn: async () => {
      if (!user?.factory_id) return []
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('factory_id', user.factory_id)
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.factory_id
  })

  // Fetch the target period (default to global selection or latest)
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
      return data
    },
    enabled: !!user?.factory_id
  })

  const currentPeriod = periods[0]

  // Fetch shift assignments for calculation
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id
  })

  // Fetch advance payments
  const { data: advances = [] } = useQuery({
    queryKey: ['advances', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return []
      const { data, error } = await supabase
        .from('advance_payments')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        // .eq('period_id', currentPeriod.id)
      if (error) throw error
      return data
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id
  })

  // Fetch existing payroll entry
  const { data: existingEntry } = useQuery({
    queryKey: ['payroll-entry', selectedEmployeeId, currentPeriod?.id],
    queryFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return null
      const { data, error } = await supabase
        .from('payroll_entries')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('period_id', currentPeriod.id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!selectedEmployeeId && !!currentPeriod?.id
  })

  // Update form when existing entry is loaded
  useEffect(() => {
    if (existingEntry) {
      setManualEntries({
        amount_wood_excess: Number(existingEntry.amount_wood_excess || 0),
        amount_film: Number(existingEntry.amount_film || 0),
        amount_special: Number(existingEntry.amount_special || 0),
        amount_diligence: Number(existingEntry.amount_diligence || 0),
        amount_position: Number(existingEntry.amount_position || 0),
        deduct_safety_equipment: Number(existingEntry.deduct_safety_equipment || 0),
        deduct_uniform: Number(existingEntry.deduct_uniform || 0)
      })
      setOverrideNormal(existingEntry.override_normal ? Number(existingEntry.override_normal) : null)
      setOverrideReason(existingEntry.override_reason || '')
    } else {
      setManualEntries({
        amount_wood_excess: 0,
        amount_film: 0,
        amount_special: 0,
        amount_diligence: 0,
        amount_position: 0,
        deduct_safety_equipment: 0,
        deduct_uniform: 0
      })
      setOverrideNormal(null)
      setOverrideReason('')
    }
  }, [existingEntry, selectedEmployeeId])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)

  const totalAdvance = advances.reduce((sum, adv) => sum + Number(adv.amount), 0)
  const normalDays = shifts.filter(s => !s.is_holiday_ot).length
  const holidayOtDays = shifts.filter(s => s.is_holiday_ot).length

  const payrollInput: PayrollCalculationInput = {
    rate_per_12h: selectedEmployee?.rate_per_12h || 0,
    normal_days: normalDays,
    holiday_ot_days: holidayOtDays,
    override_normal: overrideNormal,
    social_security_rate: socialSecurityRate,
    deduct_advance: totalAdvance,
    ...manualEntries
  }

  const calc = calculateTraPhetPayroll(payrollInput)

  // Check if underlying shift or advance data changed since last save
  const isOutdated = useMemo(() => {
    if (!existingEntry) return false;
    const diffNormal = Math.abs(calc.amount_normal - Number(existingEntry.amount_normal || 0));
    const diffShift = Math.abs(calc.amount_shift - Number(existingEntry.amount_shift || 0));
    const diffOt = Math.abs(calc.amount_ot - Number(existingEntry.amount_ot || 0));
    const diffAdv = Math.abs(totalAdvance - Number(existingEntry.deduct_advance || 0));
    
    return diffNormal > 0.01 || diffShift > 0.01 || diffOt > 0.01 || diffAdv > 0.01;
  }, [calc, existingEntry, totalAdvance])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployeeId || !currentPeriod?.id) return

      const payload = {
        period_id: currentPeriod.id,
        employee_id: selectedEmployeeId,
        amount_normal: calc.amount_normal,
        amount_shift: calc.amount_shift,
        amount_ot: calc.amount_ot,
        override_normal: overrideNormal,
        override_reason: overrideReason,
        ...manualEntries,
        deduct_social_security: calc.deduct_social_security,
        deduct_advance: totalAdvance,
        entered_by: user?.id
      }

      const { error } = await supabase
        .from('payroll_entries')
        .upsert([payload], { onConflict: 'period_id,employee_id' })
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-entry'] })
      toast.success('บันทึกข้อมูลค่าจ้างสำเร็จ')
    },
    onError: (error: any) => {
      toast.error('เกิดข้อผิดพลาดในการบันทึก', { description: error.message })
    }
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setManualEntries(prev => ({
      ...prev,
      [name]: Number(value) || 0
    }))
  }

  return (
    <>
      <TopBar 
        title="กรอกค่าจ้าง" 
        action={
          <div className="flex items-center gap-4">
            {user?.role === 'superUser' && (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border">
                <Label className="text-xs text-slate-500">อัตราประกันสังคม:</Label>
                <div className="flex items-center gap-1">
                  <Input 
                    type="number" 
                    className="w-16 h-7 text-right text-sm"
                    value={socialSecurityRate * 100}
                    onChange={(e) => setSocialSecurityRate(Number(e.target.value) / 100)}
                    disabled={isApproved}
                  />
                  <span className="text-sm font-medium">%</span>
                </div>
              </div>
            )}
          </div>
        } 
      />

      <div className="flex h-[calc(100vh-64px)]">
        {/* Left Sidebar: Employee List */}
        <div className="w-80 border-r bg-white flex flex-col">
          <div className="p-4 border-b space-y-3">
            <Badge variant="outline" className="w-full justify-center py-1.5 bg-slate-50">
              งวด: {currentPeriod?.label || 'ยังไม่ได้สร้างงวด'}
            </Badge>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input 
                placeholder="ค้นหาพนักงาน..." 
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {employees
              .filter(emp => {
                const matchesSearch = emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  emp.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  emp.last_name.toLowerCase().includes(searchTerm.toLowerCase())
                
                if (searchTerm.trim().length > 0) return matchesSearch
                return emp.status === 'active' && matchesSearch
              })
              .map(emp => {
                const isInactive = emp.status !== 'active'
                const isSelected = selectedEmployeeId === emp.id
                
                return (
                  <div 
                    key={emp.id}
                    onClick={() => {
                      if (isInactive) {
                        toast.error('ไม่สามารถกรอกค่าจ้างได้', {
                          description: `พนักงาน ${emp.first_name} ${emp.last_name} พ้นสภาพพนักงานแล้ว`
                        })
                        return
                      }
                      setSelectedEmployeeId(emp.id)
                    }}
                    className={`
                      p-3 rounded-lg cursor-pointer transition-all flex justify-between items-center
                      ${isSelected 
                        ? 'bg-[#1D9E75]/10 text-[#1D9E75] font-medium border-l-4 border-l-[#1D9E75]' 
                        : 'hover:bg-slate-50 text-slate-700'
                      }
                      ${isInactive ? 'opacity-50 grayscale' : ''}
                    `}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm flex items-center gap-2">
                        {emp.employee_code} — {formatEmployeeName(emp)}
                        {isInactive && <UserX className="w-3 h-3 text-rose-500" />}
                      </span>
                    </div>
                    {!isInactive && (
                      <CheckCircle2 className={`w-4 h-4 ${emp.id === employees[0]?.id ? 'text-[#1D9E75]' : 'text-slate-200'}`} />
                    )}
                  </div>
                )
              })}
          </div>
        </div>

        {/* Right Area: Form */}
        <div className="flex-1 bg-slate-50/50 p-8 overflow-y-auto">
          {!selectedEmployeeId ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Edit2 className="w-8 h-8 text-slate-300" />
              </div>
              <p>เลือกพนักงานจากรายชื่อด้านซ้ายเพื่อกรอกตัวเลข</p>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">
              
              {/* Header Info */}
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">
                    {formatEmployeeName(selectedEmployee || { first_name: '', prefix: undefined, last_name: undefined, nationality: undefined })}
                  </h2>
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                    <span>รหัสพนักงาน: <strong className="text-slate-700">{selectedEmployee?.employee_code}</strong></span>
                    <span>อัตราค่าจ้าง: <strong className="text-slate-700">{formatThaiCurrency(selectedEmployee?.rate_per_12h)} ฿/วัน</strong></span>
                    <span>การรับเงิน: <strong className="text-slate-700">{selectedEmployee?.payment_method === 'bank_transfer' ? 'โอนบัญชี' : 'เงินสด'}</strong></span>
                  </div>
                </div>

                {isApproved && (
                  <Badge className="bg-amber-100 text-amber-800 border-none px-4 py-1.5 flex items-center">
                    <Lock className="w-4 h-4 mr-2" />
                    งวดถูกอนุมัติแล้ว ไม่สามารถแก้ไขได้
                  </Badge>
                )}
              </div>

              {/* Sync Warning */}
              {isOutdated && !isApproved && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm animate-in fade-in slide-in-from-top-2">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-bold text-amber-800">
                        แจ้งเตือน: ข้อมูลกะทำงานมีการเปลี่ยนแปลง!
                      </h3>
                      <div className="mt-1 text-sm text-amber-700">
                        <p>
                          พบว่าหลังจากที่คุณบันทึกค่าจ้างล่าสุด มีการเข้าไปแก้ไขกะทำงาน (หรือยอดเบิกล่วงหน้า) ของพนักงานคนนี้ 
                          ระบบได้ดึงข้อมูลใหม่มาแสดงแล้ว <strong>กรุณากด "บันทึกข้อมูลค่าจ้าง" อีกครั้ง</strong> เพื่อให้ยอดเงินอัปเดตเป็นปัจจุบัน
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* INCOMES COLUMN */}
                <Card className="border-t-4 border-t-emerald-500 shadow-sm">
                  <CardHeader className="bg-emerald-50/50 pb-4">
                    <CardTitle className="text-emerald-800 flex justify-between items-center">
                      รายได้ (Income)
                      <span className="text-sm font-normal text-emerald-600">หน่วย: บาท</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-6">
                    
                    {/* Auto Calculated normal pay */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-slate-700 font-semibold">ค่าจ้างปกติ (เรท 8 ชม.)</Label>
                        <span className="text-xs text-slate-500">คำนวณอัตโนมัติ: {normalDays} วัน</span>
                      </div>
                      
                      {isEditingNormal ? (
                        <div className="space-y-3 bg-amber-50 p-3 rounded-lg border border-amber-200">
                          <div className="flex items-center gap-2">
                            <Input 
                              type="number" 
                              className="bg-white border-amber-300"
                              value={overrideNormal || ''}
                              onChange={(e) => setOverrideNormal(Number(e.target.value))}
                              placeholder={calc.amount_normal.toString()}
                            />
                            <Button size="sm" variant="outline" onClick={() => setIsEditingNormal(false)}>ยกเลิก</Button>
                          </div>
                          <div>
                            <Label className="text-xs text-amber-800">เหตุผลที่แก้ไข *</Label>
                            <Input 
                              className="mt-1 bg-white h-8 text-sm" 
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="ระบุเหตุผล..."
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex relative">
                          <Input 
                            className="bg-emerald-50 border-emerald-200 text-emerald-900 font-medium pr-10" 
                            readOnly 
                            value={formatThaiCurrency(calc.effective_normal)}
                          />
                          {!isApproved && (
                            <button 
                              onClick={() => setIsEditingNormal(true)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                      {overrideNormal !== null && !isEditingNormal && (
                        <p className="text-xs text-amber-600 flex items-center mt-1">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          แก้ไขจากยอดคำนวณเดิม {formatThaiCurrency(calc.amount_normal)} ฿
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-slate-700 font-semibold">ค่ากะ (เรท 4 ชม.)</Label>
                        <span className="text-xs text-slate-500">คำนวณอัตโนมัติ: {normalDays} วัน</span>
                      </div>
                      <Input className="bg-slate-50" readOnly value={formatThaiCurrency(calc.amount_shift)} />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-slate-700 font-semibold">OT วันหยุด</Label>
                        <span className="text-xs text-slate-500">คำนวณอัตโนมัติ: {holidayOtDays} วัน</span>
                      </div>
                      <Input className="bg-slate-50" readOnly value={formatThaiCurrency(calc.amount_ot)} />
                    </div>

                    <hr className="my-4" />

                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-1.5">
                        <Label>ค่าไม้ส่วนเกิน</Label>
                        <Input type="number" name="amount_wood_excess" className="w-full" value={manualEntries.amount_wood_excess || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>ค่าฟิล์ม</Label>
                        <Input type="number" name="amount_film" className="w-full" value={manualEntries.amount_film || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>เงินพิเศษ</Label>
                        <Input type="number" name="amount_special" className="w-full" value={manualEntries.amount_special || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>เบี้ยขยัน</Label>
                        <Input type="number" name="amount_diligence" className="w-full" value={manualEntries.amount_diligence || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>ค่าตำแหน่ง</Label>
                        <Input type="number" name="amount_position" className="w-full" value={manualEntries.amount_position || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* DEDUCTIONS COLUMN */}
                <div className="space-y-6">
                  <Card className="border-t-4 border-t-rose-500 shadow-sm">
                    <CardHeader className="bg-rose-50/50 pb-4">
                      <CardTitle className="text-rose-800 flex justify-between items-center">
                        รายการหัก (Deductions)
                        <span className="text-sm font-normal text-rose-600">หน่วย: บาท</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-6">
                      
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold flex items-center">
                            <Lock className="w-3 h-3 mr-1.5 text-slate-400" />
                            ประกันสังคม ({(socialSecurityRate * 100).toFixed(0)}%)
                          </Label>
                        </div>
                        <Input className="bg-slate-100 text-slate-500 border-slate-200" readOnly value={formatThaiCurrency(calc.deduct_social_security)} />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-slate-700 font-semibold flex items-center">
                            <Lock className="w-3 h-3 mr-1.5 text-slate-400" />
                            เบิกล่วงหน้า
                          </Label>
                        </div>
                        <Input className="bg-slate-100 text-slate-500 border-slate-200" readOnly value={formatThaiCurrency(payrollInput.deduct_advance)} />
                      </div>

                      <hr className="my-4" />

                      <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>ค่าอุปกรณ์ความปลอดภัย</Label>
                        <Input type="number" name="deduct_safety_equipment" className="w-full" value={manualEntries.deduct_safety_equipment || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>ค่าเสื้อพนักงาน</Label>
                        <Input type="number" name="deduct_uniform" className="w-full" value={manualEntries.deduct_uniform || ''} onChange={handleInputChange} disabled={isApproved} placeholder="0" />
                      </div>
                      </div>

                    </CardContent>
                  </Card>

                  {/* SUMMARY TOTALS */}
                  <Card className="bg-[#1D9E75]/5 border-[#1D9E75]/20 shadow-sm">
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-emerald-800">
                          <span className="font-medium">รวมรายได้</span>
                          <span className="text-lg font-bold">{formatThaiCurrency(calc.total_income)}</span>
                        </div>
                        <div className="flex justify-between items-center text-rose-700">
                          <span className="font-medium">รวมรายการหัก</span>
                          <span className="text-lg font-bold">{formatThaiCurrency(calc.total_deductions)}</span>
                        </div>
                        <div className="pt-3 border-t border-[#1D9E75]/20 flex justify-between items-center text-[#1D9E75]">
                          <span className="font-bold text-lg">รวมสุทธิ (Net Pay)</span>
                          <span className="text-3xl font-black">{formatThaiCurrency(calc.net_pay)} ฿</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                </div>
              </div>

              {/* Save Button at bottom */}
              <div className="flex justify-end pt-2">
                <div className="flex gap-3">
                  <Button 
                    onClick={() => saveMutation.mutate()} 
                    className="bg-[#1D9E75] hover:bg-[#157a5a]"
                    disabled={saveMutation.isPending || !selectedEmployeeId || isApproved}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                  </Button>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  )
}
