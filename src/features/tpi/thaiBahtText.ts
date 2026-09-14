/**
 * Converts a number to Thai Baht text string
 * Example: 683.52 -> "หกร้อยแปดสิบสามบาทห้าสิบสองสตางค์"
 * Example: 1000.00 -> "หนึ่งพันบาทถ้วน"
 */
export function thaiBahtText(amount: number): string {
  if (isNaN(amount) || amount === 0) return 'ศูนย์บาทถ้วน'

  const isNegative = amount < 0
  const absAmount = Math.abs(amount)

  // Split integer and satang parts
  const fixed = absAmount.toFixed(2)
  const [intStr, satangStr] = fixed.split('.')

  const thaiNums = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
  const thaiUnits = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน']

  function convertGroup(numStr: string): string {
    let result = ''
    const len = numStr.length
    for (let i = 0; i < len; i++) {
      const digit = parseInt(numStr[i], 10)
      const pos = len - i - 1

      if (digit === 0) continue

      if (pos === 0) {
        if (digit === 1 && len > 1 && parseInt(numStr[len - 2], 10) > 0) {
          result += 'เอ็ด'
        } else {
          result += thaiNums[digit]
        }
      } else if (pos === 1) {
        if (digit === 1) {
          result += 'สิบ'
        } else if (digit === 2) {
          result += 'ยี่สิบ'
        } else {
          result += thaiNums[digit] + 'สิบ'
        }
      } else {
        result += thaiNums[digit] + thaiUnits[pos]
      }
    }
    return result
  }

  function convertInt(numStr: string): string {
    if (numStr === '0') return 'ศูนย์'
    let result = ''
    let remaining = numStr

    let millionLevel = 0
    while (remaining.length > 0) {
      const sliceLen = remaining.length % 6 || 6
      const groupStr = remaining.slice(0, sliceLen)
      remaining = remaining.slice(sliceLen)

      const groupText = convertGroup(groupStr)
      if (groupText) {
        result += groupText
        if (remaining.length > 0) {
          result += 'ล้าน'
        }
      }
      millionLevel++
    }
    return result
  }

  let text = convertInt(intStr) + 'บาท'

  const satang = parseInt(satangStr, 10)
  if (satang === 0) {
    text += 'ถ้วน'
  } else {
    text += convertGroup(satangStr) + 'สตางค์'
  }

  return isNegative ? 'ลบ' + text : text
}
