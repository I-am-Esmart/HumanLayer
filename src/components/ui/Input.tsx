import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  prefix?: string
  suffix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, prefix, suffix, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 text-sm text-[var(--muted)] pointer-events-none select-none">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            className={clsx(
              'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--subtle)]',
              'focus:outline-none focus:border-[var(--accent)]/60 focus:ring-1 focus:ring-[var(--accent)]/30',
              'transition-colors',
              prefix && 'pl-8',
              suffix && 'pr-10',
              error && 'border-red-500/50 focus:border-red-500/60 focus:ring-red-500/20',
              className
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-sm text-[var(--muted)] pointer-events-none select-none">
              {suffix}
            </span>
          )}
        </div>
        {hint && !error && <p className="text-xs text-[var(--subtle)]">{hint}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className={clsx(
            'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--subtle)] resize-none',
            'focus:outline-none focus:border-[var(--accent)]/60 focus:ring-1 focus:ring-[var(--accent)]/30',
            'transition-colors',
            error && 'border-red-500/50',
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-[var(--subtle)]">{hint}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
