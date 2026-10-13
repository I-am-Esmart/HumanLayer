import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { clsx } from 'clsx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      disabled={isDisabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'sm' && 'text-xs px-3 py-1.5 min-h-[32px]',
        size === 'md' && 'text-sm px-4 py-2 min-h-[40px]',
        size === 'lg' && 'text-base px-6 py-3 min-h-[48px]',
        variant === 'primary' &&
          'bg-[var(--accent)] text-[#0d1b2f] hover:bg-[var(--accent-hover)] active:scale-[0.98]',
        variant === 'secondary' &&
          'bg-[var(--surface-strong)] text-[var(--ink)] border border-[var(--border)] hover:border-[var(--border-strong)] active:scale-[0.98]',
        variant === 'ghost' &&
          'bg-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] active:scale-[0.98]',
        variant === 'danger' &&
          'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 active:scale-[0.98]',
        variant === 'outline' &&
          'bg-transparent text-[var(--accent)] border border-[var(--accent)]/40 hover:border-[var(--accent)] active:scale-[0.98]',
        className
      )}
      {...props}
    >
      {loading ? (
        <>
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {children}
        </>
      ) : (
        children
      )}
    </button>
  )
}
