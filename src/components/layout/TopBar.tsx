import type { ReactNode } from 'react'

interface TopBarProps {
  title?: string
  action?: ReactNode
}

export function TopBar({ title, action }: TopBarProps) {
  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
      <div className="flex items-center gap-4">
        {action}
      </div>
    </header>
  )
}
