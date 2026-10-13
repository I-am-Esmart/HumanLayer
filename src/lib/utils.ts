import type { BountyStatus, SubmissionStatus, DifficultyLevel, TaskCategory } from '../types'

// Stable time helper — avoids React Compiler purity warnings from Date.now() in render
export function getNowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatUSDC(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatTimeLeft(deadline: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = deadline - now
  if (diff <= 0) return 'Expired'
  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((diff % 3600) / 60)
  return `${hours}h ${mins}m`
}

export function formatRelativeTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const STATUS_STYLES: Record<BountyStatus, { label: string; className: string }> = {
  Open: { label: 'Open', className: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  InProgress: { label: 'In Progress', className: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  Completed: { label: 'Completed', className: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
  Disputed: { label: 'Disputed', className: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  Cancelled: { label: 'Cancelled', className: 'text-red-400 bg-red-400/10 border-red-400/20' },
}

export const SUBMISSION_STATUS_STYLES: Record<SubmissionStatus, { label: string; className: string }> = {
  Pending: { label: 'Pending Review', className: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  Approved: { label: 'Approved', className: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  Rejected: { label: 'Rejected', className: 'text-red-400 bg-red-400/10 border-red-400/20' },
  Disputed: { label: 'Disputed', className: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
}

export const DIFFICULTY_STYLES: Record<DifficultyLevel, { label: string; className: string }> = {
  Easy: { label: 'Easy', className: 'text-emerald-400' },
  Medium: { label: 'Medium', className: 'text-amber-400' },
  Hard: { label: 'Hard', className: 'text-red-400' },
}

export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  Science: '#60a5fa',
  Software: '#a78bfa',
  Research: '#34d399',
  ImageData: '#fb923c',
  Language: '#f472b6',
  BiologyMedicine: '#4ade80',
}

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  Science: 'Science',
  Software: 'Software',
  Research: 'Research',
  ImageData: 'Image / Data',
  Language: 'Language',
  BiologyMedicine: 'Biology / Medicine',
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

export function progressPercent(accepted: number, required: number): number {
  if (required === 0) return 0
  return Math.min(100, Math.round((accepted / required) * 100))
}

export function totalBountyValue(rewardPerWorker: number, requiredWorkers: number): number {
  return rewardPerWorker * requiredWorkers
}
