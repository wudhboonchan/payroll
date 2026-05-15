import { Menu } from 'lucide-react'

interface TopBarV2Props {
  title: string
  subtitle?: string
  onMenuClick: () => void
}

export function TopBarV2({ title, subtitle, onMenuClick }: TopBarV2Props) {
  return (
    <div className="vk-root" style={{
      height: 'var(--vk-topbar-h)',
      borderBottom: '1px solid var(--vk-rule)',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '0 28px',
      background: 'var(--vk-paper)',
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      <button
        onClick={onMenuClick}
        className="md:hidden"
        style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--vk-ink-2)', display: 'flex' }}
      >
        <Menu style={{ width: 20, height: 20 }} />
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--vk-sans)', fontWeight: 600, fontSize: 15, color: 'var(--vk-ink)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {subtitle && (
          <>
            <span style={{ color: 'var(--vk-rule-soft)', fontSize: 13 }}>/</span>
            <span style={{ fontFamily: 'var(--vk-sans)', fontSize: 13, color: 'var(--vk-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
