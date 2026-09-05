import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, GripVertical, Plus, Search, X, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/useAppStore'
import '../styles/tokens.css'
import './TpiShiftEntry.css'

type Employee = { id: string; employee_code: string; first_name: string; last_name: string }
type Plan = Record<string, number[]>
const shifts = [
  { name: 'เช้า', time: '07:40–16:00', note: 'สิ้นสุดวันนี้', tone: 'morning' },
  { name: 'บ่าย', time: '15:40–00:00', note: 'สิ้นสุดเที่ยงคืน', tone: 'afternoon' },
  { name: 'ดึก', time: '23:40–08:00', note: 'สิ้นสุดวันถัดไป', tone: 'night' },
]
const examples: Employee[] = [
  { id: 'demo-1', employee_code: 'TPI-001', first_name: 'พนักงานตัวอย่าง', last_name: '01' },
  { id: 'demo-2', employee_code: 'TPI-002', first_name: 'พนักงานตัวอย่าง', last_name: '02' },
  { id: 'demo-3', employee_code: 'TPI-003', first_name: 'พนักงานตัวอย่าง', last_name: '03' },
  { id: 'demo-4', employee_code: 'TPI-004', first_name: 'พนักงานตัวอย่าง', last_name: '04' },
  { id: 'demo-5', employee_code: 'TPI-005', first_name: 'พนักงานตัวอย่าง', last_name: '05' },
  { id: 'demo-6', employee_code: 'TPI-006', first_name: 'พนักงานตัวอย่าง', last_name: '06' },
]
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function TpiShiftEntry({ preview = false }: { preview?: boolean }) {
  const { user, companyContext } = useAppStore()
  const [date, setDate] = useState(today)
  const [plans, setPlans] = useState<Record<string, Plan>>(() => preview ? { [today()]: { 'demo-1': [0, 1], 'demo-2': [1, 2], 'demo-3': [0], 'demo-4': [2] } } : {})
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Employee | null>(null)
  const { data: employees = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tpi-shift-employees', user?.factory_id],
    enabled: !preview && !!user?.factory_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_code,first_name,last_name').eq('factory_id', user!.factory_id).eq('status', 'active').order('employee_code')
      if (error) throw error
      return data as Employee[]
    },
  })
  const people = preview ? examples : employees
  const plan = plans[date] || {}
  const assigned = people.filter(e => plan[e.id]?.length)
  const doubles = assigned.filter(e => plan[e.id].length === 2).length
  function assign(ids: string[], shift: number) {
    const validIds = ids.filter(id => people.some(e => e.id === id))
    if (!validIds.length) { setMessage('เลือกพนักงานจากรายชื่อด้านซ้ายก่อน'); return }
    if (validIds.some(id => (plan[id] || []).length >= 2 && !plan[id].includes(shift))) {
      setMessage('ลงได้สูงสุด 2 กะต่อคนต่อวัน กรุณาถอดกะเดิมก่อนเพิ่มกะใหม่'); return
    }
    setPlans(previous => {
      const next = { ...previous[date] }
      validIds.forEach(id => { next[id] = [...new Set([...(next[id] || []), shift])].sort() })
      return { ...previous, [date]: next }
    })
    setSelected([]); setMessage('จัดกะในแบบร่างแล้ว')
  }
  function remove(id: string, shift: number) {
    setPlans(previous => ({ ...previous, [date]: { ...previous[date], [id]: (previous[date]?.[id] || []).filter(s => s !== shift) } }))
    setMessage('ถอดกะออกจากแบบร่างแล้ว')
  }
  function changeDate(value: string) { if (value) { setDate(value); setEditing(null); setSelected([]); setMessage('') } }
  function moveDate(offset: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + offset); changeDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) }
  const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return <main className="tpi-entry">
    <header className="tpi-heading"><div><div className="tpi-kicker">โรงงาน · บริษัท ทีพีไอ โพลีน</div><h1>กรอกกะรายวัน <span>เฟส 2</span></h1><p>{preview ? 'ตัวอย่างหน้าจอ · ใช้พนักงานสมมติ' : companyContext?.factoryName}</p></div><div className="tpi-draft">แบบร่างทดลอง</div></header>
    <div className="tpi-notice">ทดลองจัดกะได้ในหน้านี้ ข้อมูลยังไม่บันทึกเข้าระบบเงินเดือน และจะหายเมื่อรีเฟรชหรือออกจากหน้า</div>
    <section className="tpi-toolbar"><div className="tpi-date"><button aria-label="วันก่อนหน้า" onClick={() => moveDate(-1)}><ChevronLeft size={18}/></button><label><strong>{displayDate}</strong><input aria-label="วันที่ทำงาน" type="date" value={date} onChange={e => changeDate(e.target.value)}/></label><button aria-label="วันถัดไป" onClick={() => moveDate(1)}><ChevronRight size={18}/></button></div><div className="tpi-stats"><span>ลงกะแล้ว <b>{assigned.length}</b> คน</span><span className="tpi-double-text">ทำ 2 กะ <b>{doubles}</b> คน</span><span>ยังไม่ลงกะ <b>{people.length - assigned.length}</b> คน</span></div></section>
    <div className="tpi-workspace">
      <aside className="tpi-pool"><div className="tpi-pool-heading"><h2>รายชื่อพนักงาน</h2><span>{people.length} คน</span></div><label className="tpi-search"><Search size={17}/><input placeholder="ค้นหาชื่อ หรือรหัสพนักงาน" value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหาพนักงาน"/></label><p className="tpi-help">เลือกชื่อแล้วกดเพิ่มในกะ หรือลากชื่อไปวาง</p>
        {isLoading && !preview && <p>กำลังโหลดรายชื่อ...</p>}{isError && <p role="alert">โหลดรายชื่อไม่สำเร็จ <button onClick={() => refetch()}>ลองใหม่</button></p>}
        {!isLoading && !isError && people.length === 0 && <p>ยังไม่มีพนักงานในโรงงานนี้</p>}
        {people.filter(e => `${e.first_name} ${e.last_name} ${e.employee_code}`.toLowerCase().includes(search.toLowerCase())).map(e => { const count = plan[e.id]?.length || 0; return <label key={e.id} className={`tpi-person ${selected.includes(e.id) ? 'selected' : ''}`} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', e.id); event.dataTransfer.effectAllowed = 'copy' }}><GripVertical size={16}/><input type="checkbox" checked={selected.includes(e.id)} onChange={() => setSelected(previous => previous.includes(e.id) ? previous.filter(id => id !== e.id) : [...previous, e.id])}/><div><strong>{e.first_name} {e.last_name}</strong><small>{e.employee_code}</small></div><span className={count === 2 ? 'tpi-count full' : 'tpi-count'}>{count}/2</span></label> })}
        {selected.length > 0 && <button className="tpi-clear" onClick={() => setSelected([])}>ยกเลิกที่เลือก ({selected.length} คน)</button>}
      </aside>
      <section className="tpi-board-section"><div className="tpi-board-title"><div><h2>จัดกะการทำงาน</h2><p>1 คนต่อแถว · เลือกได้ 1–2 กะต่อวัน</p></div><span className="tpi-legend"><i/> แถบยาว = ทำ 2 กะ</span></div>
        <div className="tpi-board-scroll"><div className="tpi-board">
          <div className="tpi-shift-headers">{shifts.map((s, i) => <div key={s.name} className={`tpi-shift-head ${s.tone}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); assign([e.dataTransfer.getData('text/plain')], i) }}><div className="tpi-shift-label"><span>0{i + 1}</span><strong>กะ{s.name}</strong><small>{assigned.filter(e => plan[e.id].includes(i)).length} คน</small></div><h3>{s.time}</h3><p>{s.note}</p><button onClick={() => assign(selected, i)}><Plus size={15}/> เพิ่ม{selected.length ? ` ${selected.length} คน` : 'พนักงาน'}</button></div>)}</div>
          <div className="tpi-rows">{assigned.length === 0 && <div className="tpi-empty">เริ่มจัดกะวันนี้<p>เลือกพนักงาน แล้วเพิ่มลงในกะเช้า บ่าย หรือดึก</p></div>}
            {assigned.map(e => { const slots = plan[e.id]; const connected = slots.length === 2 && slots[1] - slots[0] === 1; return <div className="tpi-row" key={e.id}>
              {shifts.map((s, i) => <button key={s.name} className="tpi-slot" style={{ gridColumn: i + 1, gridRow: 1 }} aria-label={`เพิ่มกะ${s.name}ให้ ${e.first_name} ${e.last_name}`} disabled={slots.includes(i)} onClick={() => assign([e.id], i)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); assign([event.dataTransfer.getData('text/plain')], i) }}>{!slots.includes(i) && <Plus size={16}/>}</button>)}
              {(connected ? [slots[0]] : slots).map(slot => <div className={`tpi-assignment ${slots.length === 2 ? 'double' : shifts[slot].tone}`} key={slot} style={{ gridColumn: `${slot + 1} / span ${connected ? 2 : 1}`, gridRow: 1 }} draggable onDragStart={event => event.dataTransfer.setData('text/plain', e.id)}><div className="tpi-card-top"><strong>{e.first_name} {e.last_name}</strong><span>{slots.length} กะ</span></div><small>{e.employee_code}{connected ? ` · ${shifts[slots[0]].name} + ${shifts[slots[1]].name}` : slots.length === 2 ? ' · เช้า + ดึก (เว้นกะบ่าย)' : ''}</small><div className="tpi-card-actions"><button aria-label={`แก้ไขกะของ ${e.first_name} ${e.last_name}`} onClick={() => setEditing(e)}><Pencil size={12}/>แก้ไข</button><button aria-label={`ลบทุกกะของ ${e.first_name} ${e.last_name}`} onClick={() => { setPlans(previous => ({ ...previous, [date]: { ...previous[date], [e.id]: [] } })); setMessage(`ลบกะของ ${e.first_name} ${e.last_name} แล้ว`) }}><Trash2 size={12}/>ลบ</button>{(connected ? slots : [slot]).map(s => <button key={s} aria-label={`ถอดกะ${shifts[s].name}ของ ${e.first_name} ${e.last_name}`} onClick={() => remove(e.id, s)}>{shifts[s].name}<X size={12}/></button>)}</div></div>)}
            </div> })}
          </div>
        </div></div><div className="tpi-board-foot">วันที่ทำงานอ้างอิงวันเริ่มกะ · กะดึกสิ้นสุดเวลา 08:00 ของวันถัดไป</div>
      </section>
    </div><div className="tpi-status" role="status" aria-live="polite">{message || 'ลากการ์ดไปอีกกะเพื่อเพิ่มกะที่สอง หรือกด + ในแถวพนักงาน'}</div>
    {editing && <ShiftEditor employee={editing} initialSlots={plan[editing.id] || []} onClose={() => setEditing(null)} onSave={slots => {
      setPlans(previous => ({ ...previous, [date]: { ...previous[date], [editing.id]: slots } }))
      setMessage(`แก้ไขกะของ ${editing.first_name} ${editing.last_name} แล้ว`)
      setEditing(null)
    }}/>}
  </main>
}

function ShiftEditor({ employee, initialSlots, onClose, onSave }: {
  employee: Employee; initialSlots: number[]; onClose: () => void; onSave: (slots: number[]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [slots, setSlots] = useState(initialSlots)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="tpi-editor" aria-labelledby="tpi-editor-title" onCancel={onClose} onClose={onClose}>
    <div className="tpi-editor-header"><div><h2 id="tpi-editor-title">แก้ไขกะการทำงาน</h2><p>{employee.first_name} {employee.last_name} · {employee.employee_code}</p></div><button className="vk-btn vk-btn--ghost" aria-label="ปิดหน้าต่างแก้ไข" onClick={onClose}><X size={18}/></button></div>
    <div className="tpi-editor-body"><p>เลือกกะที่ต้องการทำงาน 1–2 กะ</p>{shifts.map((shift, index) => <label key={shift.name} className={slots.includes(index) ? 'active' : ''}><input type="checkbox" checked={slots.includes(index)} disabled={!slots.includes(index) && slots.length === 2} onChange={() => setSlots(previous => previous.includes(index) ? previous.filter(s => s !== index) : [...previous, index].sort())}/><strong>กะ{shift.name}</strong><span>{shift.time}</span></label>)}<small>หากต้องการเปลี่ยนกะเมื่อครบ 2 กะ ให้เอาเครื่องหมายกะเดิมออกก่อน</small></div>
    <div className="tpi-editor-footer"><button className="vk-btn" onClick={onClose}>ยกเลิก</button><button className="vk-btn vk-btn--primary" disabled={slots.length === 0} onClick={() => onSave(slots)}>บันทึกการแก้ไข</button></div>
  </dialog>
}
