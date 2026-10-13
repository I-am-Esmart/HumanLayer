import { Clock, Users, ChevronRight } from 'lucide-react'
import type { Bounty } from '../types'
import {
  getNowSec,
  formatUSDC,
  formatTimeLeft,
  STATUS_STYLES,
  DIFFICULTY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  clampText,
  progressPercent,
} from '../lib/utils'
import { Badge } from './ui/Badge'

interface BountyCardProps {
  bounty: Bounty
  onClick: () => void
}

export function BountyCard({ bounty, onClick }: BountyCardProps) {
  const statusStyle = STATUS_STYLES[bounty.status]
  const diffStyle = DIFFICULTY_STYLES[bounty.difficulty]
  const catColor = CATEGORY_COLORS[bounty.category]
  const catLabel = CATEGORY_LABELS[bounty.category]
  const progress = progressPercent(bounty.acceptedCount, bounty.requiredWorkers)
  const isExpired = bounty.deadline < getNowSec()
  const timeLeft = formatTimeLeft(bounty.deadline)

  return (
    <button
      onClick={onClick}
      className="group text-left w-full glass rounded-xl p-5 hover:border-[var(--border-strong)] transition-all hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: catColor }}
          />
          <span className="text-xs font-semibold" style={{ color: catColor }}>
            {catLabel}
          </span>
          <span className="text-xs text-[var(--subtle)]">·</span>
          <span className="text-xs text-[var(--subtle)]">{bounty.taskType}</span>
          <span className="text-xs text-[var(--subtle)]">·</span>
          <span className={`text-xs font-medium ${diffStyle.className}`}>
            {diffStyle.label}
          </span>
        </div>
        <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-[var(--ink)] mb-1.5 group-hover:text-[var(--accent)] transition-colors leading-snug">
        {bounty.title}
      </h3>

      {/* Description */}
      <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
        {clampText(bounty.description, 120)}
      </p>

      {/* Progress bar */}
      {bounty.requiredWorkers > 1 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--subtle)]">Workers filled</span>
            <span className="text-xs text-[var(--muted)] tabular-nums">
              {bounty.acceptedCount}/{bounty.requiredWorkers}
            </span>
          </div>
          <div className="h-1 bg-[var(--surface-muted)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: progress === 100 ? 'var(--success)' : 'var(--accent)',
              }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Reward */}
          <div>
            <p className="text-lg font-bold text-[var(--ink)] tabular-nums display leading-none">
              ${formatUSDC(bounty.rewardPerWorker)}
            </p>
            <p className="text-xs text-[var(--subtle)] mt-0.5">per worker · USDC</p>
          </div>

          {/* Time */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--subtle)]">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className={isExpired ? 'text-red-400' : ''}>{timeLeft}</span>
          </div>

          {/* Workers */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--subtle)]">
            <Users className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{bounty.estimatedMinutes} min</span>
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-[var(--subtle)] group-hover:text-[var(--accent)] transition-colors" />
      </div>
    </button>
  )
}
