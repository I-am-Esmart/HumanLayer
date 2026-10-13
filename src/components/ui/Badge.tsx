import { type ReactNode } from 'react'
import { clsx } from 'clsx'

interface BadgeProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'outline' | 'solid'
}

export function Badge({ children, className, variant = 'outline' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
        variant === 'outline' && 'bg-transparent',
        variant === 'solid' && 'border-transparent',
        className
      )}
    >
      {children}
    </span>
  )
}
