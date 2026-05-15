import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { toast } from 'sonner'
import {
  Copy,
  FileDown,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Users,
  Link2,
} from 'lucide-react'
import { formatEmployeeName } from '../lib/formatters'
import { formatPeriodLabel } from '../lib/formatters'

type SlipStatus = 'pending' | 'confirmed' | 'disputed' | 'auto_confirmed'
type FilterStatus = 'all' | SlipStatus

interface PayrollPeriod {
  id: string
  period_start: string
  period_end: string
  status: 'draft' | 'approved'
  factory_id: string
}

interface TokenRow {
  id: string
  token: string
  expires_at: string
  employee_status: SlipStatus
  dispute_reason: string | null
  created_at?: string
  employees: {
    employee_code: string
    first_name: string
    last_name: string
    prefix?: string
    nationality?: string
  }
}

function StatusBadge({ status }: { status: SlipStatus }) {
  const map: Record<SlipStatus, { label: string; className: string }> = {
    pending:        { label: '⏳ รอยืนยัน',        className: 'bg-slate-100 text-slate-600 border-slate-200' },
    confirmed:      { label: '✅ ยืนยันแล้ว',       className: 'bg-green-100 text-green-700 border-green-200' },
    disputed:       { label: '❌ ทักท้วง',           className: 'bg-red-100 text-red-700 border-red-200' },
    auto_confirmed: { label: '🔄 ยืนยันอัตโนมัติ',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
  }
  const { label, className } = map[status] || map.pending
  return (
    <Badge variant="outline" className={`text-xs font-medium ${className}`}>
      {label}
    </Badge>
  )
}

function CopyButton({ text, label = 'คัดลอก', icon }: { text: string; label?: string; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={`text-xs px-2 py-1 rounded-md border transition-all duration-200 flex items-center gap-1 ${
        copied
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-800'
      }`}
      title={label}
    >
      {copied ? (
        <><CheckCircle2 className="w-3 h-3" /> {label === 'ลิงก์' ? '✓' : 'คัดลอกแล้ว'}</>
      ) : (
        <>{icon || <Copy className="w-3 h-3" />} {label}</>
      )}
    </button>
  )
}

export default function ShareLinks() {
  const { user } = useAppStore()
  const queryClient = useQueryClient()

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'status'>('code')
  const [search, setSearch] = useState('')
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
      return data as PayrollPeriod[]
    },
    enabled: !!user?.factory_id,
  })

  // Initialize selectedPeriodId once when periods load
  const hasInitializedPeriod = useRef(false)
  useEffect(() => {
    if (!hasInitializedPeriod.current && periods.length > 0) {
      const approved = periods.find(p => p.status === 'approved')
      setSelectedPeriodId(approved?.id || periods[0].id)
      hasInitializedPeriod.current = true
    }
  }, [periods])

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId)
  const periodLabel = selectedPeriod
    ? formatPeriodLabel(selectedPeriod.period_start, selectedPeriod.period_end)
    : '—'

  const { data: tokens = [] } = useQuery({
    queryKey: ['payslip_tokens', selectedPeriodId],
    refetchInterval: 8000, // polling fallback in case realtime misses an event
    queryFn: async () => {
      if (!selectedPeriodId) return []
      const { data, error } = await supabase
        .from('payslip_tokens')
        .select(`
          id, token, expires_at, employee_status, dispute_reason, created_at,
          employees(employee_code, first_name, last_name, prefix, nationality)
        `)
        .eq('period_id', selectedPeriodId)
        .order('created_at')
      if (error) throw error
      
      const typedData = data as unknown as TokenRow[]
      return typedData.map(t => {
        if (t.employee_status === 'pending' && t.expires_at) {
          // Derive sent_at from expires_at (always set to now+30d on create/reset)
          // so auto-confirm counts 24h from the last send/reset, not the original created_at
          const sentAt = new Date(t.expires_at).getTime() - 30 * 24 * 60 * 60 * 1000
          const hoursPassed = (Date.now() - sentAt) / (1000 * 60 * 60)
          if (hoursPassed >= 24) {
            return { ...t, employee_status: 'auto_confirmed' as SlipStatus }
          }
        }
        return t
      })
    },
    enabled: !!selectedPeriodId,
  })

  // Realtime subscription
  useEffect(() => {
    if (!selectedPeriodId) return

    const channel = supabase
      .channel(`tokens-realtime-${selectedPeriodId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payslip_tokens',
          filter: `period_id=eq.${selectedPeriodId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['payslip_tokens', selectedPeriodId] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-link-stats'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedPeriodId, queryClient])

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriodId || !user?.factory_id) throw new Error('No period selected')

      const { data: employees, error: empError } = await supabase
        .from('employees')
        .select('id')
        .eq('factory_id', user.factory_id)
        .eq('status', 'active')
      if (empError) throw empError

      // Get existing tokens to avoid duplicates without relying on DB constraints
      const { data: existingTokens, error: existingError } = await supabase
        .from('payslip_tokens')
        .select('employee_id')
        .eq('period_id', selectedPeriodId)
      if (existingError) throw existingError

      const existingIds = new Set(existingTokens?.map(t => t.employee_id) || [])
      const newEmployees = (employees || []).filter(emp => !existingIds.has(emp.id))

      if (newEmployees.length === 0) return // Nothing to do

      const rows = newEmployees.map(emp => ({
        period_id: selectedPeriodId,
        employee_id: emp.id,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        employee_status: 'pending',
      }))

      const { error } = await supabase
        .from('payslip_tokens')
        .insert(rows)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslip_tokens', selectedPeriodId] })
      toast.success('สร้างลิงก์สำเร็จ พร้อมส่งผ่าน LINE แล้ว')
    },
    onError: (e: Error) => toast.error('เกิดข้อผิดพลาด', { description: e.message }),
  })

  const regenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase
        .from('payslip_tokens')
        .update({
          token: crypto.randomUUID(), // Generate a new token
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          employee_status: 'pending',
          dispute_reason: null,
        })
        .eq('id', tokenId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslip_tokens', selectedPeriodId] })
      toast.success('สร้างลิงก์ใหม่เรียบร้อย')
    },
  })

  const filtered = useMemo(() => {
    let list = tokens as TokenRow[]
    if (filterStatus !== 'all') list = list.filter(t => t.employee_status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.employees?.employee_code?.toLowerCase().includes(q) ||
        t.employees?.first_name?.toLowerCase().includes(q) ||
        t.employees?.last_name?.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'code') return a.employees?.employee_code?.localeCompare(b.employees?.employee_code || '') || 0
      if (sortBy === 'name') return a.employees?.first_name?.localeCompare(b.employees?.first_name || '') || 0
      return a.employee_status.localeCompare(b.employee_status)
    })
  }, [tokens, filterStatus, search, sortBy])

  const counts = useMemo(() => ({
    total:          tokens.length,
    confirmed:      tokens.filter(t => t.employee_status === 'confirmed' || t.employee_status === 'auto_confirmed').length,
    pending:        tokens.filter(t => t.employee_status === 'pending').length,
    disputed:       tokens.filter(t => t.employee_status === 'disputed').length,
  }), [tokens])

  const buildLinksText = () => {
    const lines = filtered.map(t => {
      const emp = t.employees
      const name = `${emp?.employee_code} ${formatEmployeeName(emp || { first_name: '' })}`
      const url = `${window.location.origin}/slip/${t.token}`
      return `${name}\n${url}`
    })
    return [
      `ใบแจ้งค่าแรง ${periodLabel} — ห้างหุ้นส่วนจำกัด วิราญกร`,
      '',
      ...lines.flatMap(l => [l, '']),
      '*กรุณาตรวจสอบและยืนยันภายใน 24 ชม.*',
      'หากพ้นกำหนด ระบบจะถือว่าท่านตรวจสอบความถูกต้องแล้วโดยอัตโนมัติค่ะ',
    ].join('\n')
  }

  const handleCopyAll = () => {
    navigator.clipboard.writeText(buildLinksText())
    toast.success('คัดลอกลิงค์ทั้งหมดแล้ว — นำไปวางใน LINE ได้เลย')
  }

  const handleExportTxt = () => {
    const text = buildLinksText()
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payslip_links_${periodLabel.replace(/\s+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isApproved = selectedPeriod?.status === 'approved'

  return (
    <>
      <TopBar 
        title="สร้างลิงก์ดูสลิป" 
        action={
          <div className="bg-white border border-slate-200 px-5 py-2 rounded-full shadow-sm flex items-center min-h-[42px]">
            <span className="text-[15px] font-bold text-slate-700">
              งวด: {selectedPeriod ? periodLabel : 'เลือกงวด'}
            </span>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl border p-4 md:p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <label className="text-sm font-medium text-slate-600 shrink-0">งวด:</label>
            <select
              className="h-9 rounded-md border border-input px-3 text-sm w-full sm:w-auto"
              value={selectedPeriodId || ''}
              onChange={e => setSelectedPeriodId(e.target.value)}
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {formatPeriodLabel(p.period_start, p.period_end)}
                  {p.status === 'approved' ? ' ✅' : ' (ร่าง)'}
                </option>
              ))}
            </select>
            {!isApproved && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md mt-2 sm:mt-0 w-full sm:w-auto text-center">
                ⚠️ งวดนี้ยังไม่ได้อนุมัติ
              </span>
            )}
          </div>

          <div className="flex w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:text-blue-800 w-full sm:w-auto"
              onClick={() => generateMutation.mutate()}
              disabled={!isApproved || generateMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
              สร้าง / อัปเดตลิงก์
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'ทั้งหมด',    value: counts.total,     icon: <Users className="w-4 h-4" />,         color: 'text-slate-600 bg-slate-50 border-slate-200' },
            { label: 'ยืนยันแล้ว', value: counts.confirmed, icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-green-700 bg-green-50 border-green-200' },
            { label: 'รอยืนยัน',   value: counts.pending,   icon: <Clock className="w-4 h-4" />,         color: 'text-slate-600 bg-slate-50 border-slate-200' },
            { label: 'ทักท้วง',    value: counts.disputed,  icon: <AlertCircle className="w-4 h-4" />,   color: 'text-red-700 bg-red-50 border-red-200' },
          ].map(card => (
            <div key={card.label} className={`rounded-xl border p-4 flex items-center gap-3 ${card.color}`}>
              {card.icon}
              <div>
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="text-xs opacity-70">{card.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between bg-slate-50/60">
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-full md:w-auto">
                {(['all', 'pending', 'confirmed', 'disputed'] as FilterStatus[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-2 md:px-3 py-1.5 transition-colors flex-1 md:flex-none text-xs md:text-sm ${
                      filterStatus === s ? 'bg-[#1D9E75] text-white' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    { s === 'all' ? 'ทั้งหมด' : s === 'pending' ? 'รอยืนยัน' : s === 'confirmed' ? 'ยืนยันแล้ว' : 'ทักท้วง' }
                  </button>
                ))}
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <select
                  className="h-9 text-sm rounded-md border border-slate-200 px-2 flex-1 md:w-auto"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'code' | 'name' | 'status')}
                >
                  <option value="code">เรียงตามรหัส</option>
                  <option value="name">เรียงตามชื่อ</option>
                  <option value="status">เรียงตามสถานะ</option>
                </select>
                <div className="relative flex-1 md:w-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                  <Input
                    placeholder="ค้นหา..."
                    className="h-9 pl-8 text-sm w-full md:w-48"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 w-full lg:w-auto mt-2 lg:mt-0">
              <Button variant="outline" size="sm" className="flex-1 lg:flex-none h-9" onClick={handleExportTxt} disabled={filtered.length === 0}>
                <FileDown className="w-4 h-4 mr-1.5" />
                Export .txt
              </Button>
              <Button size="sm" className="bg-[#00B900] hover:bg-[#009900] flex-1 lg:flex-none h-9" onClick={handleCopyAll} disabled={filtered.length === 0}>
                <Copy className="w-4 h-4 mr-1.5" />
                คัดลอกลิงก์ทั้งหมด
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>ยังไม่มีลิงก์ในงวดนี้</p>
              <p className="text-sm mt-1">กดปุ่ม "สร้าง / อัปเดตลิงก์" ด้านบนเพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b bg-slate-50/30">
                    <th className="px-4 py-3 font-medium w-24 whitespace-nowrap">รหัส</th>
                    <th className="px-4 py-3 font-medium">ชื่อ - ลิงก์</th>
                    <th className="px-4 py-3 font-medium w-36 whitespace-nowrap">สถานะ</th>
                    <th className="px-4 py-3 font-medium w-52 text-right whitespace-nowrap">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(t => {
                    const emp = t.employees
                    const slipUrl = `${window.location.origin}/slip/${t.token}`
                    const isExpired = new Date(t.expires_at) < new Date()

                    const messageText = `ใบแจ้งค่าแรง: ${formatEmployeeName(emp || { first_name: '' })}\nคลิกเพื่อดูสลิป: ${slipUrl}\n\n*กรุณาตรวจสอบและยืนยันภายใน 24 ชม.*\n(หากพ้นกำหนด ระบบจะยืนยันความถูกต้องให้อัตโนมัติค่ะ)`

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-700 font-semibold align-top pt-4">{emp?.employee_code}</td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-slate-800">{formatEmployeeName(emp || { first_name: '' })}</p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-[200px] md:max-w-md lg:max-w-lg" title={slipUrl}>{slipUrl}</p>
                          {t.employee_status === 'disputed' && t.dispute_reason && (
                            <div className="mt-1.5 inline-flex items-start bg-red-50 text-red-700 px-2.5 py-1.5 rounded-md text-xs border border-red-100 w-full max-w-sm">
                              <AlertCircle className="w-3.5 h-3.5 mr-1.5 shrink-0 mt-0.5" />
                              <span className="whitespace-pre-wrap leading-relaxed">{t.dispute_reason}</span>
                            </div>
                          )}
                          {isExpired && <p className="text-xs text-amber-600 mt-1">⏰ ลิงก์หมดอายุแล้ว</p>}
                        </td>
                        <td className="px-4 py-3 align-top pt-4"><StatusBadge status={t.employee_status} /></td>
                        <td className="px-4 py-3 text-right align-top pt-3">
                          <div className="flex justify-end gap-2 whitespace-nowrap ml-auto">
                            <CopyButton text={slipUrl} label="ลิงก์" icon={<Link2 className="w-3 h-3" />} />
                            <CopyButton text={messageText} label="ข้อความ" />
                            {/* Only admin/superUser can reset links — normalUser cannot */}
                            {(user?.role === 'admin' || user?.role === 'superUser') && (
                              <button
                                onClick={() => {
                                  if (window.confirm('ยืนยันการสร้างลิงก์ใหม่?\n(ลิงก์เก่าจะถูกยกเลิกและไม่สามารถเข้าดูได้อีก)')) {
                                    regenMutation.mutate(t.id)
                                  }
                                }}
                                className="text-xs px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50 flex items-center gap-1 transition-colors"
                                title="สร้างลิงก์ใหม่ (ลิงก์เก่าจะถูกยกเลิก)"
                              >
                                <RotateCcw className="w-3 h-3" />
                                รีเซ็ต
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
