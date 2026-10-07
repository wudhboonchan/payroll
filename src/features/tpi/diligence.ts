/** A stored automatic allowance is not evidence of a manual override. */
export function resolveDiligence(defaultAmount: number, saved?: { override_reason?: string | null } | null) {
  const match = saved?.override_reason?.match(/(?:^|,\s*)เบี้ยขยัน:\s*฿?([\d,]+(?:\.\d+)?)/)
  const override = match ? Number(match[1].replace(/,/g, '')) : null
  return { amount: override ?? defaultAmount, override }
}

export function diligenceOverrideReason(saved?: { override_reason?: string | null } | null): string {
  return saved?.override_reason?.match(/(?:^|,\s*)เหตุผลแก้ไขเบี้ยขยัน:\s*([\s\S]*)$/)?.[1]?.trim() || ''
}

export function formatDiligenceOverride(amount: number, reason: string): string {
  if (!reason.trim()) throw new Error('กรุณาระบุเหตุผลที่แก้ไขเบี้ยขยันก่อนบันทึก')
  return `เบี้ยขยัน: ฿${amount}, เหตุผลแก้ไขเบี้ยขยัน: ${reason.trim()}`
}
