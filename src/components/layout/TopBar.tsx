import type { ReactNode } from 'react'

interface TopBarProps {
  title?: string
  action?: ReactNode
}

export function TopBar({ title, action }: TopBarProps) {
  return (
    <header className="min-h-[4rem] border-b bg-white flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 sticky top-0 z-10 gap-3 sm:gap-4">
      <h1 className="text-lg sm:text-xl font-semibold text-slate-800">{title}</h1>
      <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto overflow-x-auto hide-scrollbar pb-1 sm:pb-0">
        {action}
      </div>
    </header>
  )
}
