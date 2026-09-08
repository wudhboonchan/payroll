export type DeductionField = 'deduct_uniform' | 'deduct_safety_equipment'
export type DeductionProduct = { id: string; label: string; price: number; field: DeductionField; group: string }
const sizes = ['M', 'L', 'XL', '2XL', '3XL', '4XL']
const styles = ['แขนสั้น', 'แขนสั้นมีแถบ', 'แขนยาว', 'แขนยาวมีแถบ']
const prices = [
  [100, 120, 120, 140],
  [100, 120, 120, 140],
  [110, 130, 130, 150],
  [110, 130, 130, 150],
  [120, 140, 140, 160],
  [120, 140, 140, 160],
]
export const deductionProducts: DeductionProduct[] = sizes.flatMap((size, row) =>
  styles.map((style, col) => ({
    id: `shirt-${size}-${col}`, label: `เสื้อแรงงาน ${style} ขนาด ${size}`,
    group: `เสื้อ${style}`, price: prices[row][col], field: 'deduct_uniform' as const,
  }))
)
deductionProducts.push({ id: 'safety-shoes', label: 'รองเท้าเซฟตี้', group: 'รองเท้า', price: 550, field: 'deduct_safety_equipment' })
export const deductionProductGroups = [...styles.map(style => `เสื้อ${style}`), 'รองเท้า'].map(label => ({
  label,
  products: deductionProducts.filter(product => product.group === label),
}))
export function productDeduction(id: string, quantity: number) {
  const product = deductionProducts.find(item => item.id === id)
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1) return null
  const amount = product.price * quantity
  if (!Number.isSafeInteger(amount)) return null
  return { field: product.field, amount }
}
