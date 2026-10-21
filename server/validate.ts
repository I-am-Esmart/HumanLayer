/**
 * Validation helpers for the Agent API.
 * The backend never blindly trusts client-provided amounts.
 * All spending limits are enforced here before any onchain action is suggested.
 */

import type { AgentProfile, TaskCategory } from './types.ts'
import { getDailySpent } from './store.ts'

// ─── Amount helpers ───────────────────────────────────────────────────────────

export function parseRaw(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return null
  try {
    const n = BigInt(String(value))
    return n >= 0n ? n : null
  } catch {
    return null
  }
}

/** Parse a human-readable USDC string (e.g. "1.50") to 6-decimal bigint. */
export function parseUsdcHuman(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const num = parseFloat(String(value))
  if (isNaN(num) || num < 0) return null
  return BigInt(Math.round(num * 1_000_000))
}

export function formatUsdcHuman(raw: bigint): string {
  return (Number(raw) / 1_000_000).toFixed(6)
}

// ─── Spending limit enforcement ───────────────────────────────────────────────

export interface SpendCheck {
  ok: boolean
  error?: string
  errorCode?: string
}

export function checkSpendingLimits(
  agent: AgentProfile,
  rewardRaw: bigint,
  requiredWorkers: number
): SpendCheck {
  const totalRaw = rewardRaw * BigInt(requiredWorkers)
  const limits = agent.spendingLimits

  // Per-task check
  const perTaskMax = BigInt(limits.perTaskMax)
  if (rewardRaw > perTaskMax) {
    return {
      ok: false,
      error: `Reward per worker (${formatUsdcHuman(rewardRaw)} USDC) exceeds your per-task limit (${formatUsdcHuman(perTaskMax)} USDC).`,
      errorCode: 'EXCEEDS_PER_TASK_LIMIT',
    }
  }

  // Daily limit check
  const dailyLimit = BigInt(limits.dailyLimit)
  const dailySpent = getDailySpent(agent.agentId)
  if (dailySpent + totalRaw > dailyLimit) {
    return {
      ok: false,
      error: `This bounty would exceed your daily spending limit (${formatUsdcHuman(dailyLimit)} USDC/day). Already spent today: ${formatUsdcHuman(dailySpent)} USDC.`,
      errorCode: 'EXCEEDS_DAILY_LIMIT',
    }
  }

  // Total budget check
  const totalBudget = BigInt(limits.totalBudget)
  const totalFunded = BigInt(agent.totalFundedRaw)
  if (totalFunded + totalRaw > totalBudget) {
    return {
      ok: false,
      error: `This bounty would exceed your total budget (${formatUsdcHuman(totalBudget)} USDC). Already funded: ${formatUsdcHuman(totalFunded)} USDC.`,
      errorCode: 'EXCEEDS_TOTAL_BUDGET',
    }
  }

  return { ok: true }
}

// ─── Category validation ──────────────────────────────────────────────────────

const VALID_CATEGORIES: TaskCategory[] = [
  'Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine',
]

const VALID_TASK_TYPES = [
  'Verify', 'Classify', 'Label', 'Compare', 'Research', 'Rate', 'Transcribe',
]

export function isValidCategory(cat: unknown): cat is TaskCategory {
  return VALID_CATEGORIES.includes(cat as TaskCategory)
}

export function isCategoryAllowed(agent: AgentProfile, category: TaskCategory): boolean {
  return agent.supportedCategories.includes(category)
}

export function isValidTaskType(tt: unknown): boolean {
  return VALID_TASK_TYPES.includes(tt as string)
}

// ─── Address validation ───────────────────────────────────────────────────────

export function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)
}

// ─── Bounty field validation ──────────────────────────────────────────────────

export interface BountyValidation {
  ok: boolean
  errors: Record<string, string>
}

export function validateBountyPayload(body: Record<string, unknown>): BountyValidation {
  const errors: Record<string, string> = {}

  if (!body.title || typeof body.title !== 'string' || body.title.trim().length < 5) {
    errors.title = 'title must be a string of at least 5 characters.'
  }
  if (body.title && typeof body.title === 'string' && body.title.length > 120) {
    errors.title = 'title must not exceed 120 characters.'
  }
  if (!body.description || typeof body.description !== 'string' || body.description.trim().length < 10) {
    errors.description = 'description must be a string of at least 10 characters.'
  }
  if (!body.category || !isValidCategory(body.category)) {
    errors.category = `category must be one of: Science, Software, Research, ImageData, Language, BiologyMedicine.`
  }
  if (!body.task_type || !isValidTaskType(body.task_type)) {
    errors.task_type = `task_type must be one of: Verify, Classify, Label, Compare, Research, Rate, Transcribe.`
  }
  if (body.reward_usdc === undefined || body.reward_usdc === null) {
    errors.reward_usdc = 'reward_usdc is required (human-readable, e.g. "0.50").'
  } else {
    const raw = parseUsdcHuman(body.reward_usdc)
    if (raw === null || raw <= 0n) {
      errors.reward_usdc = 'reward_usdc must be a positive number (e.g. "0.50").'
    }
  }
  const workers = parseInt(String(body.required_workers))
  if (isNaN(workers) || workers < 1 || workers > 100) {
    errors.required_workers = 'required_workers must be an integer between 1 and 100.'
  }
  const days = parseInt(String(body.days_until_deadline))
  if (isNaN(days) || days < 1 || days > 365) {
    errors.days_until_deadline = 'days_until_deadline must be an integer between 1 and 365.'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

// ─── Auth header extraction ───────────────────────────────────────────────────

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}
