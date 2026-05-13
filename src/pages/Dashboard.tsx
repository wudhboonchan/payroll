import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import {
  Users, Wallet, ShieldCheck, Banknote,
  CheckCircle2, Clock, ChevronDown,
  Loader2, Calendar, AlertCircle, Link2, RotateCcw
} from 'lucide-react'
import { formatThaiCurrency, formatPeriodLabel } from '../lib/formatters'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'


// ─── helpers ────────────────────────────────────────────────────────────────

function sumEntries(rows: any[]): { gross: number; ss: number; net: number } {
  let gross = 0, ss = 0, totalDeduct = 0
  rows?.forEach(e => {
    const inc =
      Number(e.amount_normal || 0) + Number(e.amount_shift || 0) + Number(e.amount_ot || 0) +
      Number(e.amount_wood_excess || 0) + Number(e.amount_film || 0) + Number(e.amount_special || 0) +
      Number(e.amount_diligence || 0) + Number(e.amount_position || 0)
    const ded =
      Number(e.deduct_social_security || 0) + Number(e.deduct_advance || 0) +
      Number(e.deduct_safety_equipment || 0) + Number(e.deduct_uniform || 0)
    gross += inc
    ss += Number(e.deduct_social_security || 0)
    totalDeduct += ded
  })
  return { gross, ss, net: gross - totalDeduct }
}

const PAYROLL_COLS = `
  amount_normal, amount_shift, amount_ot,
  amount_wood_excess, amount_film, amount_special,
  amount_diligence, amount_position,
  deduct_social_security, deduct_advance,
  deduct_safety_equipment, deduct_uniform
`

// ─── Month label helpers ─────────────────────────────────────────────────────

function periodShortLabel(period: any): string {
  try { return formatPeriodLabel(period.period_start, period.period_end) }
  catch { return '' }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StepBadge({ status }: { status: 'done' | 'pending' | 'todo' }) {
  if (status === 'done')
    return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">เสร็จแล้ว</span>
  if (status === 'pending')
    return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700">รอดำเนินการ</span>
  return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-rose-100 text-rose-600">ยังไม่ได้ทำ</span>
}

// ─── Bar chart ───────────────────────────────────────────────────────────────

function BarChart({ bars, activePeriodId }: { bars: { id: string; label: string; value: number }[]; activePeriodId?: string }) {
  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 mt-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        <span className="text-xs text-slate-400 font-medium">ยังไม่มีข้อมูลการเงินในงวดที่เลือก</span>
      </div>
    )
  }

  // Calculate a nice max value for the Y-axis
  const rawMax = Math.max(...bars.map(b => b.value), 1000)
  const step = rawMax > 10000 ? 5000 : 1000
  const yAxisMax = Math.ceil(rawMax / step) * step
  const gridLines = [yAxisMax, yAxisMax * 0.75, yAxisMax * 0.5, yAxisMax * 0.25, 0]

  return (
    <div className="mt-4 flex flex-col flex-1">
      <div className="flex h-80">
        {/* Y-Axis labels */}
        <div className="flex flex-col justify-between text-[10px] text-slate-400 w-12 pb-10 border-r border-slate-100">
          {gridLines.map((val, i) => (
            <span key={i} className="text-right pr-2">
              {val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : val}
            </span>
          ))}
        </div>

        {/* Chart area */}
        <div className="flex-1 relative ml-2">
          {/* Horizontal Grid Lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-10">
            {gridLines.map((_, i) => (
              <div 
                key={i} 
                className={`w-full border-t ${i === gridLines.length - 1 ? 'border-slate-300' : 'border-slate-100 border-dashed'}`} 
              />
            ))}
          </div>

          {/* Bars Container */}
          <div className={`absolute inset-0 flex items-end gap-4 px-2 pb-10 ${bars.length === 1 ? 'justify-center' : 'justify-around'}`}>
            {bars.map(bar => {
              const heightPct = (bar.value / yAxisMax) * 100
              const isActive = bar.id === activePeriodId
              return (
                <div 
                  key={bar.id} 
                  className="relative flex flex-col items-center group h-full justify-end"
                  style={{ width: bars.length === 1 ? '100px' : '18%' }}
                >
                  {/* Data Label on Top */}
                  <div className={`absolute mb-2 transition-all duration-700`} style={{ bottom: `${Math.max(heightPct, 5)}%` }}>
                    <span className={`text-[10px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded shadow-sm ${
                      isActive ? 'bg-[#1D9E75] text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {formatThaiCurrency(bar.value)}
                    </span>
                  </div>
                  
                  {/* The Bar */}
                  <div
                    className={`w-full rounded-t-md transition-all duration-700 shadow-sm ${
                      isActive ? 'bg-[#1D9E75] shadow-[0_-4px_12px_rgba(29,158,117,0.15)]' : 'bg-slate-200 opacity-60'
                    }`}
                    style={{ height: `${Math.max(heightPct, 1)}%` }}
                  />
                  
                  {/* X-Axis Label */}
                  <div className="absolute top-full mt-3 w-max text-center">
                    <span className={`text-[10px] sm:text-[11px] block transition-colors ${
                      isActive ? 'font-bold text-slate-900' : 'text-slate-500'
                    }`}>
                      {bar.label.split(' ')[0]}
                    </span>
                    <span className="text-[9px] text-slate-400 block">
                      {bar.label.split(' ').slice(1).join(' ')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer Axis Description */}
      <div className="flex justify-between items-center mt-6 px-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-t border-slate-50 pt-3">
        <span>← งวดการทำงาน (Payroll Period)</span>
        <span>ยอดเงินสุทธิคงเหลือ (THB) ↑</span>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAppStore()
  const queryClient = useQueryClient()
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)

  // Fetch all periods
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
    enabled: !!user?.factory_id
  })

  const activePeriod = periods.find(p => p.id === selectedPeriodId) ?? periods[0]

  // ── Current-period stats ─────────────────────────────────────────────────
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod?.id) return null

      const [
        { count: empCount },
        { count: pendingEmpCount },
        { data: payrollData, error: peErr },
        { data: shiftDays },
        { data: advData }
      ] = await Promise.all([
        supabase.from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('factory_id', user?.factory_id!)
          .eq('status', 'active'),
        supabase.from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('factory_id', user?.factory_id!)
          .eq('status', 'active')
          .eq('data_complete', false),
        supabase.from('payroll_entries')
          .select(PAYROLL_COLS)
          .eq('period_id', activePeriod.id),
        supabase.from('shift_assignments')
          .select('work_date')
          .eq('period_id', activePeriod.id),
        supabase.from('advance_payments')
          .select('amount')
          .eq('period_id', activePeriod.id)
      ])

      if (peErr) throw peErr

      const { gross, ss, net } = sumEntries(payrollData ?? [])
      const totalAdv = advData?.reduce((s, a) => s + Number(a.amount), 0) ?? 0

      const startD = new Date(activePeriod.period_start)
      const endD = new Date(activePeriod.period_end)
      const totalDays = Math.ceil((endD.getTime() - startD.getTime()) / 86_400_000) + 1
      const uniqueDays = new Set(shiftDays?.map(d => d.work_date)).size
      const entryCount = payrollData?.length ?? 0

      return {
        totalEmployees: empCount ?? 0,
        pendingEmpCount: pendingEmpCount ?? 0,
        totalGrossPay: gross,
        totalSocialSecurity: ss,
        totalNetPay: net - totalAdv,
        periodStatus: activePeriod.status as string,
        periodLabel: formatPeriodLabel(activePeriod.period_start, activePeriod.period_end),
        daysFilled: uniqueDays,
        totalDays,
        entryCount,
        isExported: false // placeholder — extend when export tracking is added
      }
    },
    enabled: !!activePeriod?.id
  })

  // ── Last-4-periods bar chart ──────────────────────────────────────────────
  const last4 = periods.slice(0, 4).reverse() // chronological order

  const { data: recentBars = [] } = useQuery({
    queryKey: ['recent-bars', last4.map(p => p.id).join(',')],
    queryFn: async () => {
      if (!last4.length) return []
      const [entriesRes, advancesRes] = await Promise.all([
        supabase.from('payroll_entries').select('period_id, ' + PAYROLL_COLS).in('period_id', last4.map(p => p.id)),
        supabase.from('advance_payments').select('period_id, amount').in('period_id', last4.map(p => p.id))
      ])

      const allEntries = entriesRes.data ?? []
      const allAdvances = advancesRes.data ?? []

      return last4.map(p => {
        const periodEntries = allEntries.filter((e: any) => e.period_id === p.id)
        const periodAdvances = allAdvances.filter((a: any) => a.period_id === p.id)
        const { net } = sumEntries(periodEntries)
        const totalAdv = periodAdvances.reduce((s, a) => s + Number(a.amount), 0)
        
        return {
          id: p.id,
          label: periodShortLabel(p),
          value: net - totalAdv
        }
      })
    },
    enabled: last4.length > 0
  })

  // ── Approve mutation ─────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!activePeriod?.id) throw new Error('ไม่พบงวดที่จะอนุมัติ')
      const { error } = await supabase
        .from('payroll_periods')
        .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', activePeriod.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activePeriod?.id] })
      toast.success('อนุมัติงวดเรียบร้อยแล้ว')
    },
    onError: (err: any) => toast.error('ไม่สามารถอนุมัติงวดได้', { description: err.message })
  })

  // ── Unapprove mutation ───────────────────────────────────────────────────
  const unapproveMutation = useMutation({
    mutationFn: async () => {
      if (!activePeriod?.id) throw new Error('ไม่พบงวดที่จะยกเลิก')
      const { error } = await supabase
        .from('payroll_periods')
        .update({ status: 'draft', approved_by: null, approved_at: null })
        .eq('id', activePeriod.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activePeriod?.id] })
      toast.success('ยกเลิกการอนุมัติงวดเรียบร้อยแล้ว')
    },
    onError: (err: any) => toast.error('ไม่สามารถยกเลิกการอนุมัติได้', { description: err.message })
  })

  // ── User Link Stats ──────────────────────────────────────────────────────
  const { data: linkStats } = useQuery({
    queryKey: ['dashboard-link-stats', activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod?.id) return null
      const { data } = await supabase.from('payslip_tokens')
        .select('employee_status, created_at, expires_at')
        .eq('period_id', activePeriod.id)
      
      const tokens = data || []
      let pending = 0
      let confirmed = 0
      let disputed = 0

      tokens.forEach(t => {
        let status = t.employee_status
        if (status === 'pending') {
          const createdTime = t.created_at 
            ? new Date(t.created_at).getTime()
            : (t.expires_at ? new Date(t.expires_at).getTime() - (30 * 24 * 60 * 60 * 1000) : Date.now())
          const hoursPassed = (Date.now() - createdTime) / (1000 * 60 * 60)
          if (hoursPassed >= 24) {
            status = 'auto_confirmed'
          }
        }
        
        if (status === 'pending') pending++
        else if (status === 'confirmed' || status === 'auto_confirmed') confirmed++
        else if (status === 'disputed') disputed++
      })

      return {
        total: tokens.length,
        pending,
        confirmed,
        disputed
      }
    },
    enabled: !!activePeriod?.id
  })

  // Realtime subscription for link stats
  React.useEffect(() => {
    if (!activePeriod?.id) return

    const channel = supabase
      .channel(`dash-tokens-realtime-${activePeriod.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payslip_tokens'
        },
        (payload) => {
          console.log('Dashboard: Realtime token update received', payload)
          // Refetch both the stats and the link-specific stats to be sure
          queryClient.invalidateQueries({ queryKey: ['dashboard-link-stats'] })
          queryClient.refetchQueries({ queryKey: ['dashboard-link-stats'], type: 'active' })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activePeriod?.id, queryClient])

  // Realtime subscription for general dashboard stats
  React.useEffect(() => {
    if (!activePeriod?.id) return

    const channel = supabase
      .channel(`dash-general-realtime-${activePeriod.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payroll_entries', filter: `period_id=eq.${activePeriod.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activePeriod.id] })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payroll_periods', filter: `id=eq.${activePeriod.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['periods'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activePeriod.id] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activePeriod?.id, queryClient])

  // ── Derived values ────────────────────────────────────────────────────────
  const isApproved = activePeriod?.status === 'approved'
  const dataFilled = !isLoading && (stats?.entryCount ?? 0) > 0
  const hasPendingProfiles = !isLoading && (stats?.pendingEmpCount ?? 0) > 0

  const profileStatus = isLoading ? 'pending' : hasPendingProfiles ? 'todo' : 'done'
  const fillStatus = isLoading ? 'pending' : dataFilled ? 'done' : 'todo'
  const approveStatus = isLoading ? 'pending' : isApproved ? 'done' : dataFilled ? 'pending' : 'todo'

  const canApprove =
    (user?.role === 'superUser' || user?.role === 'admin') &&
    !isApproved && dataFilled && !hasPendingProfiles

  // ── Period selector badge (shown in TopBar action slot) ────────────────
  const PeriodBadge = (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <div className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-6 py-2 text-[15px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors min-h-[42px] cursor-pointer">
          <Calendar className="w-4 h-4 text-[#1D9E75]" />
          งวด: {activePeriod ? formatPeriodLabel(activePeriod.period_start, activePeriod.period_end) : 'เลือกงวด'}
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {periods.map(p => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setSelectedPeriodId(p.id)}
            className={p.id === activePeriod?.id ? 'bg-slate-100 font-semibold' : ''}
          >
            <span className="flex-1">{formatPeriodLabel(p.period_start, p.period_end)}</span>
            {p.status === 'approved' && (
              <span className="text-xs text-emerald-600 ml-2">✅</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (user?.role === 'normalUser') {
    return (
      <UserDashboardView 
        stats={stats} 
        linkStats={linkStats} 
        isLoading={isLoading} 
        PeriodBadge={PeriodBadge} 
      />
    )
  }

  return (
    <>
      <TopBar title="Dashboard" action={PeriodBadge} />

      <div className="p-8 space-y-6 max-w-6xl">

        {/* ── Row 1: 4 stat cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">

          {/* Card 1: Total Employees */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm overflow-hidden">
            <p className="text-xs md:text-sm text-slate-500 mb-1 truncate">พนักงานทั้งหมด</p>
            <p className="text-3xl md:text-4xl font-bold text-slate-900 leading-none truncate">
              {isLoading ? '—' : stats?.totalEmployees ?? 0}
            </p>
            <p className="text-[10px] md:text-xs text-slate-400 mt-2 flex items-center gap-1 truncate">
              <Users className="w-3 h-3 flex-shrink-0" />
              ที่มียอดงวดนี้
            </p>
          </div>

          {/* Card 2: Gross Pay */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm overflow-hidden">
            <p className="text-xs md:text-sm text-slate-500 mb-1 truncate">ยอดจ่ายรวม (งวดนี้)</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 leading-none truncate">
              {isLoading ? '—' : formatThaiCurrency(stats?.totalGrossPay ?? 0)}
            </p>
            <p className="text-[10px] md:text-xs text-slate-400 mt-2 flex items-center gap-1 truncate">
              <Wallet className="w-3 h-3 flex-shrink-0" />
              บาท
            </p>
          </div>

          {/* Card 3: Social Security */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm overflow-hidden">
            <p className="text-xs md:text-sm text-slate-500 mb-1 truncate">รวมหักประกันสังคม</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 leading-none truncate">
              {isLoading ? '—' : formatThaiCurrency(stats?.totalSocialSecurity ?? 0)}
            </p>
            <p className="text-[10px] md:text-xs text-slate-400 mt-2 flex items-center gap-1 truncate">
              <ShieldCheck className="w-3 h-3 flex-shrink-0" />
              บาท (5%)
            </p>
          </div>

          {/* Card 4: Net Pay */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm overflow-hidden">
            <p className="text-xs md:text-sm text-slate-500 mb-1 truncate">ยอดจ่ายสุทธิ</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-[#1D9E75] leading-none truncate">
              {isLoading ? '—' : formatThaiCurrency(stats?.totalNetPay ?? 0)}
            </p>
            <p className="text-[10px] md:text-xs text-slate-400 mt-2 flex items-center gap-1 truncate">
              <Banknote className="w-3 h-3 flex-shrink-0" />
              บาท
            </p>
          </div>
        </div>

        {/* ── Row 2: Monthly summary + Status ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Left: Historical summary card (3/5) */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-800">สรุปย้อนหลัง 4 งวด</h3>
              <Badge className="bg-[#1D9E75]/10 text-[#1D9E75] border-none text-xs font-semibold px-3 py-1 rounded-full">
                {activePeriod ? formatPeriodLabel(activePeriod.period_start, activePeriod.period_end) : ''}
              </Badge>
            </div>

            {/* Breakdown rows for last 4 periods */}
            <div className="space-y-2 mb-4">
              {recentBars.map(bar => (
                <div key={bar.id} className="flex justify-between items-center text-xs sm:text-sm">
                  <span className={`${bar.id === activePeriod?.id ? 'font-semibold text-slate-800' : 'text-slate-500'} truncate mr-2`}>
                    {bar.label}
                    {bar.id === activePeriod?.id && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[#1D9E75] bg-[#1D9E75]/10 px-1.5 py-0.5 rounded">งวดนี้</span>
                    )}
                  </span>
                  <span className={`font-semibold shrink-0 ${bar.id === activePeriod?.id ? 'text-[#1D9E75]' : 'text-slate-700'}`}>
                    {formatThaiCurrency(bar.value)} บาท
                  </span>
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <BarChart bars={recentBars} activePeriodId={activePeriod?.id} />
          </div>

          {/* Right: Period status checklist (2/5) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
            
            {/* Admin Link Stats Summary */}
            {(linkStats?.total ?? 0) > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-purple-500" /> สถานะส่งสลิปให้พนักงาน
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                    <p className="text-emerald-700 font-bold text-lg">{linkStats?.confirmed}</p>
                    <p className="text-emerald-600 text-xs">ยืนยันแล้ว</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                    <p className="text-slate-700 font-bold text-lg">{linkStats?.pending}</p>
                    <p className="text-slate-500 text-xs">รอยืนยัน</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2 border border-red-100">
                    <p className="text-red-700 font-bold text-lg">{linkStats?.disputed}</p>
                    <p className="text-red-600 text-xs">ทักท้วง</p>
                  </div>
                </div>
              </div>
            )}

            <h3 className="text-base font-bold text-slate-800 mb-5">สถานะงานงวดปัจจุบัน</h3>

            <div className="flex flex-col gap-5 flex-1">

              {/* Step 0: Profiles Complete */}
              <Link to="/employees" className="flex items-start justify-between gap-3 hover:bg-slate-50 p-2 -mx-2 rounded-xl transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    profileStatus === 'done' ? 'bg-emerald-100' : 'bg-amber-100'
                  }`}>
                    {profileStatus === 'done'
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <AlertCircle className="w-4 h-4 text-amber-600" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">ตรวจสอบฐานข้อมูลพนักงาน</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isLoading ? '...' : hasPendingProfiles 
                        ? <span className="text-amber-600 font-medium">รออัปเดตข้อมูล {stats?.pendingEmpCount} คน</span>
                        : 'ข้อมูลสมบูรณ์ 100%'
                      }
                    </p>
                  </div>
                </div>
                {profileStatus === 'done' 
                  ? <StepBadge status="done" />
                  : <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700">ต้องแก้ไข</span>
                }
              </Link>

              {/* Step 1: Data entry */}
              <Link to="/payroll" className="flex items-start justify-between gap-3 hover:bg-slate-50 p-2 -mx-2 rounded-xl transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${fillStatus === 'done' ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    {fillStatus === 'done'
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <Clock className="w-4 h-4 text-slate-400" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">กรอกข้อมูล</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isLoading ? '...' : `${stats?.entryCount ?? 0} / ${stats?.totalEmployees ?? 0} คน`}
                    </p>
                  </div>
                </div>
                <StepBadge status={fillStatus} />
              </Link>

              {/* Step 2: Approval */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isApproved ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    {isApproved
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <Clock className="w-4 h-4 text-slate-400" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">อนุมัติโดย Admin</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isApproved ? 'อนุมัติแล้ว' : 'รอการอนุมัติ'}
                    </p>
                  </div>
                </div>
                <StepBadge status={approveStatus} />
              </div>

            </div>

            {/* Approve / Unapprove buttons */}
            {(user?.role === 'superUser' || user?.role === 'admin') && (
              <div className="mt-6 pt-5 border-t border-slate-100 space-y-2">
                <Button
                  className="w-full bg-[#1D9E75] hover:bg-[#157a5a] rounded-xl h-10 font-semibold"
                  disabled={!canApprove || approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  {approveMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />กำลังอนุมัติ...</>
                  ) : isApproved ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" />อนุมัติแล้ว</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4 mr-2" />อนุมัติงวดนี้</>
                  )}
                </Button>
                {/* Unapprove — only visible when period is already approved */}
                {isApproved && (
                  <Button
                    variant="outline"
                    className="w-full rounded-xl h-9 font-medium text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300"
                    disabled={unapproveMutation.isPending}
                    onClick={() => {
                      if (window.confirm('ยืนยันการยกเลิกการอนุมัติงวดนี้?\n\nงวดจะกลับสู่สถานะ Draft และพนักงานจะสามารถดูสลิปได้ต่อไปตามลิงก์เดิม')) {
                        unapproveMutation.mutate()
                      }
                    }}
                  >
                    {unapproveMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />กำลังยกเลิก...</>
                    ) : (
                      <><RotateCcw className="w-4 h-4 mr-2" />ยกเลิกการอนุมัติ</>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── User Dashboard View ──────────────────────────────────────────────────────
function UserDashboardView({ stats, linkStats, isLoading, PeriodBadge }: any) {
  const totalDays = stats?.totalDays ?? 15
  const daysFilled = stats?.daysFilled ?? 0
  const pendingEmpCount = stats?.pendingEmpCount ?? 0
  const isApproved = stats?.periodStatus === 'approved'
  const isCompleteProfile = !isLoading && pendingEmpCount === 0

  return (
    <>
      <TopBar title="ภาพรวม (ผู้ปฏิบัติงาน)" action={PeriodBadge} />
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-slate-800">สถานะการทำงานงวดปัจจุบัน</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          <Link to="/shifts" className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all block">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              การกรอกกะทำงาน
            </h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-600">ความคืบหน้า</span>
              <span className="font-bold text-slate-800">{daysFilled} / {totalDays} วัน</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full transition-all" style={{ width: `${Math.min(100, (daysFilled/totalDays)*100)}%` }} />
            </div>
          </Link>

          <Link to="/employees" className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:border-amber-400 hover:shadow-md transition-all block">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-500" />
              ฐานข้อมูลพนักงาน
            </h3>
            {isCompleteProfile ? (
              <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 p-3 rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">ข้อมูลสมบูรณ์ 100%</span>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-amber-50 p-3 rounded-lg border border-amber-100">
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">รออัปเดตข้อมูล</span>
                </div>
                <span className="font-bold text-amber-700 bg-white px-3 py-1 rounded-full text-sm">
                  {pendingEmpCount} คน
                </span>
              </div>
            )}
          </Link>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              การอนุมัติงวด
            </h3>
            {isApproved ? (
              <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">แอดมินอนุมัติงวดนี้แล้ว</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <Clock className="w-5 h-5" />
                <span className="font-medium">รอแอดมินตรวจสอบและอนุมัติ</span>
              </div>
            )}
          </div>

          <Link to="/share-links" className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:border-purple-400 hover:shadow-md transition-all block">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-purple-500" />
              สถานะสลิปเงินเดือน
            </h3>
            {(linkStats?.total ?? 0) > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                  <p className="text-emerald-700 font-bold text-lg">{linkStats.confirmed}</p>
                  <p className="text-emerald-600 text-xs">ยืนยันแล้ว</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                  <p className="text-slate-700 font-bold text-lg">{linkStats.pending}</p>
                  <p className="text-slate-500 text-xs">รอยืนยัน</p>
                </div>
                <div className="bg-red-50 rounded-lg p-2 border border-red-100">
                  <p className="text-red-700 font-bold text-lg">{linkStats.disputed}</p>
                  <p className="text-red-600 text-xs">ทักท้วง</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">ยังไม่ได้สร้างลิงก์ในงวดนี้</span>
              </div>
            )}
          </Link>

        </div>
      </div>
    </>
  )
}
