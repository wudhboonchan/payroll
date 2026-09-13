import React, { useState, useEffect, useRef } from 'react'
import { Calendar } from 'lucide-react'

interface ThaiDatePickerProps {
  value?: string | null // ISO format: YYYY-MM-DD
  onChange: (val: string | null) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  id?: string
  'aria-label'?: string
}

/**
 * Converts ISO (YYYY-MM-DD) to Thai Buddhist date (DD/MM/BBBB)
 * Example: '2026-09-30' -> '30/09/2569'
 */
export function isoToThaiBuddhist(iso?: string | null): string {
  if (!iso) return ''
  const parts = iso.trim().split('-')
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10)
    const m = parts[1].padStart(2, '0')
    const d = parts[2].padStart(2, '0')
    if (!isNaN(y)) {
      return `${d}/${m}/${y + 543}`
    }
  }
  return iso
}

/**
 * Converts Thai Buddhist date string (DD/MM/BBBB or DD-MM-BBBB) to ISO (YYYY-MM-DD)
 * Supports years in BE (e.g. 2569), 2-digit BE (e.g. 69), or CE (e.g. 2026)
 */
export function thaiBuddhistToIso(str?: string | null): string | null {
  if (!str) return null
  const trimmed = str.trim()
  if (!trimmed) return null

  // Check if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})$/)
  if (!match) return null

  const d = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  let y = parseInt(match[3], 10)

  if (isNaN(d) || isNaN(m) || isNaN(y) || d < 1 || d > 31 || m < 1 || m > 12) {
    return null
  }

  // Handle Buddhist Era vs Christian Era
  if (y > 2400) {
    y -= 543
  } else if (y < 100) {
    // 2-digit year like '69' -> 2569 BE -> 2026 CE
    y = y + 2500 - 543
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Formats ISO string into friendly Thai readable format
 * Example: '2026-09-30' -> '30 ก.ย. 2569'
 */
export function formatThaiShortLabel(iso?: string | null): string {
  if (!iso) return ''
  const parts = iso.trim().split('-')
  if (parts.length !== 3) return ''
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return ''
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ]
  return `${d} ${thaiMonths[m - 1] || ''} ${y + 543}`
}

export const ThaiDatePicker: React.FC<ThaiDatePickerProps> = ({
  value,
  onChange,
  placeholder = 'วว/ดด/ปปปป (พ.ศ.)',
  required = false,
  disabled = false,
  className = '',
  style = {},
  id,
  'aria-label': ariaLabel,
}) => {
  const [displayText, setDisplayText] = useState<string>('')
  const nativePickerRef = useRef<HTMLInputElement>(null)

  // Sync displayed text with incoming ISO value
  useEffect(() => {
    if (value) {
      setDisplayText(isoToThaiBuddhist(value))
    } else {
      setDisplayText('')
    }
  }, [value])

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setDisplayText(text)
    // Auto-parse if user entered a full 10-char date like 30/09/2569
    if (text.length >= 8) {
      const parsed = thaiBuddhistToIso(text)
      if (parsed) {
        onChange(parsed)
      }
    } else if (!text.trim()) {
      onChange(null)
    }
  }

  const handleBlur = () => {
    if (!displayText.trim()) {
      onChange(null)
      return
    }
    const parsed = thaiBuddhistToIso(displayText)
    if (parsed) {
      onChange(parsed)
      setDisplayText(isoToThaiBuddhist(parsed))
    } else if (value) {
      // Revert to current valid value if invalid text typed
      setDisplayText(isoToThaiBuddhist(value))
    } else {
      setDisplayText('')
      onChange(null)
    }
  }

  const handleNativeDatePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isoVal = e.target.value
    if (isoVal) {
      onChange(isoVal)
      setDisplayText(isoToThaiBuddhist(isoVal))
    } else {
      onChange(null)
      setDisplayText('')
    }
  }

  const triggerPicker = () => {
    if (disabled) return
    if (nativePickerRef.current) {
      if (typeof nativePickerRef.current.showPicker === 'function') {
        nativePickerRef.current.showPicker()
      } else {
        nativePickerRef.current.click()
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', ...style }}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <input
          id={id}
          type="text"
          value={displayText}
          onChange={handleTextChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`vk-input ${className}`}
          style={{
            width: '100%',
            paddingRight: 38,
            fontFamily: 'var(--vk-mono), monospace',
            fontSize: 13,
            background: disabled ? '#f8fafc' : '#ffffff',
            borderColor: '#cbd5e1',
            letterSpacing: '0.02em',
          }}
        />

        {/* Hidden native date input to trigger browser calendar picker */}
        <input
          ref={nativePickerRef}
          type="date"
          tabIndex={-1}
          value={value || ''}
          onChange={handleNativeDatePicked}
          disabled={disabled}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 36,
            height: '100%',
            opacity: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            zIndex: 2,
          }}
          aria-hidden="true"
        />

        {/* Visible calendar trigger icon button */}
        <button
          type="button"
          tabIndex={-1}
          onClick={triggerPicker}
          disabled={disabled}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: disabled ? 'not-allowed' : 'pointer',
            color: value ? 'var(--vk-persimmon)' : 'var(--vk-ink-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
          title="เลือกวันที่จากปฏิทิน"
        >
          <Calendar style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  )
}
