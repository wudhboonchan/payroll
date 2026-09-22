export type DeductionField = 'deduct_uniform' | 'deduct_safety_equipment'
export type DeductionProduct = { id: string; label: string; price: number; field: DeductionField; group: string }

// ── TPI Products ──
const tpiSizes = ['M', 'L', 'XL', '2XL', '3XL', '4XL']
const tpiStyles = ['แขนสั้น', 'แขนสั้นมีแถบ', 'แขนยาว', 'แขนยาวมีแถบ']
const tpiPrices = [
  [100, 120, 120, 140],
  [100, 120, 120, 140],
  [110, 130, 130, 150],
  [110, 130, 130, 150],
  [120, 140, 140, 160],
  [120, 140, 140, 160],
]

export const tpiDeductionProducts: DeductionProduct[] = [
  ...tpiSizes.flatMap((size, row) =>
    tpiStyles.map((style, col) => ({
      id: `shirt-${size}-${col}`,
      label: `เสื้อแรงงาน ${style} ขนาด ${size}`,
      group: `เสื้อ${style}`,
      price: tpiPrices[row][col],
      field: 'deduct_uniform' as const,
    }))
  ),
  { id: 'safety-shoes', label: 'รองเท้าเซฟตี้', group: 'รองเท้า', price: 550, field: 'deduct_safety_equipment' }
]

// ── Diamond (ตราเพชร) Products ──
export const diamondDeductionProducts: DeductionProduct[] = [
  { id: 'diamond-cap', label: 'หมวก', group: 'อุปกรณ์ความปลอดภัย', price: 100, field: 'deduct_safety_equipment' },
  { id: 'diamond-safety-shoes', label: 'รองเท้าเซฟตี้', group: 'อุปกรณ์ความปลอดภัย', price: 500, field: 'deduct_safety_equipment' },
  { id: 'diamond-shirt-short', label: 'เสื้อแขนสั้น', group: 'เสื้อเครื่องแบบ', price: 250, field: 'deduct_uniform' },
  { id: 'diamond-shirt-long', label: 'เสื้อแขนยาว', group: 'เสื้อเครื่องแบบ', price: 280, field: 'deduct_uniform' },
]

// Default to TPI for backward compatibility
export const deductionProducts = tpiDeductionProducts
export const deductionProductGroups = [...tpiStyles.map(style => `เสื้อ${style}`), 'รองเท้า'].map(label => ({
  label,
  products: tpiDeductionProducts.filter(product => product.group === label),
}))

export function getDeductionProducts(factory: 'tpi' | 'diamond' = 'tpi'): DeductionProduct[] {
  return factory === 'diamond' ? diamondDeductionProducts : tpiDeductionProducts
}

export function getDeductionProductGroups(factory: 'tpi' | 'diamond' = 'tpi') {
  const products = getDeductionProducts(factory)
  const groupOrder = factory === 'diamond'
    ? ['อุปกรณ์ความปลอดภัย', 'เสื้อเครื่องแบบ']
    : [...tpiStyles.map(style => `เสื้อ${style}`), 'รองเท้า']
  return groupOrder
    .map(label => ({
      label,
      products: products.filter(product => product.group === label),
    }))
    .filter(g => g.products.length > 0)
}

export function productDeduction(id: string, quantity: number, factory?: 'tpi' | 'diamond') {
  const allProducts = [...diamondDeductionProducts, ...tpiDeductionProducts]
  const product = allProducts.find(item => item.id === id)
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1) return null
  const amount = product.price * quantity
  if (!Number.isSafeInteger(amount)) return null
  return { field: product.field, amount }
}

export function formatSafetyEquipmentDetail(amount: number, customDetail?: string, isTpi = true): string {
  if (customDetail && customDetail.trim()) return customDetail.trim()
  if (!amount || amount <= 0) return ''
  if (!isTpi) {
    if (amount === 500) return 'รองเท้าเซฟตี้ 1 คู่ × ฿500'
    if (amount === 1000) return 'รองเท้าเซฟตี้ 2 คู่ × ฿500'
    if (amount === 100) return 'หมวก 1 ใบ × ฿100'
    if (amount === 200) return 'หมวก 2 ใบ × ฿100'
    if (amount === 600) return 'รองเท้าเซฟตี้ 1 คู่ (฿500) + หมวก 1 ใบ (฿100)'
    if (amount % 500 === 0) {
      const qty = amount / 500
      return `รองเท้าเซฟตี้ ${qty} คู่ × ฿500`
    }
    if (amount % 100 === 0 && amount < 500) {
      const qty = amount / 100
      return `หมวก ${qty} ใบ × ฿100`
    }
    return `ค่าอุปกรณ์ความปลอดภัย (฿${amount.toLocaleString('th-TH')})`
  }
  if (amount === 550) return 'รองเท้าเซฟตี้ 1 คู่ × ฿550'
  if (amount === 1100) return 'รองเท้าเซฟตี้ 2 คู่ × ฿550'
  if (amount % 550 === 0) {
    const qty = amount / 550
    return `รองเท้าเซฟตี้ ${qty} คู่ × ฿550`
  }
  return `รองเท้าเซฟตี้ / อุปกรณ์ความปลอดภัย (฿${amount.toLocaleString('th-TH')})`
}

export function formatUniformDetail(amount: number, customDetail?: string, isTpi = true): string {
  if (customDetail && customDetail.trim()) return customDetail.trim()
  if (!amount || amount <= 0) return ''
  if (!isTpi) {
    if (amount === 250) return 'เสื้อแขนสั้น 1 ตัว × ฿250'
    if (amount === 500) return 'เสื้อแขนสั้น 2 ตัว × ฿250'
    if (amount === 280) return 'เสื้อแขนยาว 1 ตัว × ฿280'
    if (amount === 560) return 'เสื้อแขนยาว 2 ตัว × ฿280'
    if (amount === 530) return 'เสื้อแขนสั้น (฿250) + แขนยาว (฿280)'
  }
  return `เสื้อเครื่องแบบพนักงาน (฿${amount.toLocaleString('th-TH')})`
}
