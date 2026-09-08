import { useId, useState } from 'react'
import { deductionProducts, deductionProductGroups, productDeduction } from '../../lib/deductionProducts'
import type { DeductionField } from '../../lib/deductionProducts'

type Props = { onAdd: (field: DeductionField, amount: number) => void }
type Purchase = { id: string; productId: string; quantity: number }
export function DeductionProductPicker({ onAdd }: Props) {
  const id = useId()
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [message, setMessage] = useState('')
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  function resetEditor() {
    setProductId('')
    setQuantity('1')
    setEditingId(null)
  }
  const deduction = productDeduction(productId, Number(quantity))
  return (
    <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--vk-rule-soft)', borderRadius: 6, background: 'var(--vk-paper)' }}>
      <label htmlFor={`${id}-product`} style={{ fontSize: 12, fontWeight: 600 }}>ซื้อเสื้อ / รองเท้าเซฟตี้เพิ่ม</label>
      <select id={`${id}-product`} className="vk-input" value={productId}
        onChange={event => { setProductId(event.target.value); setMessage('') }}>
        <option value="">เลือกสินค้า ขนาด และแบบ</option>
        {deductionProductGroups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.products.map(item => (
              <option key={item.id} value={item.id}>
                {item.label.replace('เสื้อแรงงาน ', '')} · {item.price} บาท
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor={`${id}-quantity`} style={{ fontSize: 12 }}>จำนวน</label>
        <input id={`${id}-quantity`} type="number" min="1" step="1" className="vk-input"
          style={{ width: 72 }} value={quantity} onChange={event => { setQuantity(event.target.value); setMessage('') }} />
        <span style={{ fontSize: 12, marginLeft: 'auto' }}>รวม {(deduction?.amount || 0).toLocaleString('th-TH')} บาท</span>
        <button type="button" className="vk-btn" disabled={!deduction} onClick={() => {
          if (!deduction) return
          const previous = purchases.find(item => item.id === editingId)
          if (previous) {
            const old = productDeduction(previous.productId, previous.quantity)!
            onAdd(old.field, -old.amount)
            setPurchases(items => items.map(item => item.id === editingId
              ? { ...item, productId, quantity: Number(quantity) } : item))
          } else {
            setPurchases(items => [...items, { id: crypto.randomUUID(), productId, quantity: Number(quantity) }])
          }
          onAdd(deduction.field, deduction.amount)
          setMessage(`${previous ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}แล้ว กรุณาบันทึกค่าจ้าง`)
          resetEditor()
        }}>{editingId ? 'ยืนยันการแก้ไข' : 'เพิ่มยอดหัก'}</button>
        {editingId && <button type="button" className="vk-btn" onClick={resetEditor}>ยกเลิก</button>}
      </div>
      {purchases.length > 0 && (
        <ul aria-label="รายการสินค้าที่เพิ่ม" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {purchases.map(item => {
            const product = deductionProducts.find(product => product.id === item.productId)!
            return (
              <li key={item.id} style={{ padding: '10px 0', borderTop: '1px solid var(--vk-rule-soft)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: '1 1 170px', fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{product.label}</div>
                  <div>{product.price} บาท × {item.quantity} = {(product.price * item.quantity).toLocaleString('th-TH')} บาท</div>
                </div>
                <button type="button" className="vk-btn" aria-label={`แก้ไข ${product.label}`} onClick={() => {
                  setEditingId(item.id)
                  setProductId(item.productId)
                  setQuantity(String(item.quantity))
                  setMessage('แก้สินค้า หรือจำนวน แล้วกดยืนยันการแก้ไข')
                }}>แก้ไข</button>
                <button type="button" className="vk-btn" style={{ color: 'var(--vk-crimson)' }} aria-label={`ลบ ${product.label}`} onClick={() => {
                  onAdd(product.field, -(product.price * item.quantity))
                  setPurchases(items => items.filter(purchase => purchase.id !== item.id))
                  if (editingId === item.id) resetEditor()
                  setMessage('ลบรายการและปรับยอดหักแล้ว กรุณาบันทึกค่าจ้าง')
                }}>ลบ</button>
              </li>
            )
          })}
        </ul>
      )}
      {message && <div role="status" style={{ fontSize: 12, color: 'var(--vk-jade)' }}>{message}</div>}
    </div>
  )
}
