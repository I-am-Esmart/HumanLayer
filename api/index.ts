/**
 * HumanLayer Agent API — Vercel Serverless Function (catch-all handler)
 *
 * This single function handles all /api/* and /health routes.
 * It is deployed as a Vercel serverless function via the routing rules
 * in vercel.json. The Vite-built frontend is served separately as static
 * assets; this function only handles API traffic.
 *
 * Architecture notes (security):
 * - The API never holds private keys or submits transactions.
 * - All financial operations must be executed onchain by the caller's wallet.
 * - Agent API keys are SHA-256-hashed before storage; the plaintext is
 *   returned once on registration and never stored.
 * - Agent profiles and spending records are persisted in Supabase Postgres.
 * - The API only plans transactions; it never signs or submits them.
 *
 * LIMITATIONS OF THIS DEPLOYMENT:
 * - Bounty spending checks are pre-flight only, not enforceable financial
 *   safeguards. Intents are not yet atomically reserved or reconciled to receipts.
 * - Rate-limit buckets are per-instance and do not share state across function
 *   instances.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import ABI from '../src/lib/humanlayer-abi.json' with { type: 'json' }
import { arcMainnet, arcTestnet, getArcChain } from '../src/lib/arc-chain'
import { ARC_TESTNET_HUMANLAYER_ADDRESS } from '../src/lib/contract-addresses'
import { createPublicClient, decodeEventLog, getAddress, http, isAddress, keccak256, toBytes, type Address, type PublicClient } from 'viem'
import { getUsdc } from '../src/onchain-facts'



// Inlined local API types/store/validation to keep this Vercel function self-contained.
/**
 * Server-side types for the HumanLayer Agent API.
 * These are purely offchain — they track agent identities, spending limits, and
 * registration state. ALL financial enforcement (escrow, payments) happens onchain.
 */

export type TaskCategory =
  | 'Science'
  | 'Software'
  | 'Research'
  | 'ImageData'
  | 'Language'
  | 'BiologyMedicine'

export type TaskType =
  | 'Verify' | 'Classify' | 'Label' | 'Compare' | 'Research' | 'Rate' | 'Transcribe'

export type BountyStatusEnum = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
export type SubmissionStatusEnum = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISPUTED'

/** Spending limits enforced by the API (not the smart contract). */
export interface SpendingLimits {
  /** Max USDC per single task (6-decimal integer string) */
  perTaskMax: string
  /** Rolling 24h spending cap (6-decimal integer string) */
  dailyLimit: string
  /** Absolute lifetime budget (6-decimal integer string) */
  totalBudget: string
}

/** Registered AI agent. */
export interface AgentProfile {
  agentId: string            // uuid
  name: string
  description: string
  ownerWallet: string        // checksummed EVM address
  apiKey: string             // bearer token (hashed in store, returned once on register)
  apiKeyHash: string         // sha256 of apiKey stored server-side
  supportedCategories: TaskCategory[]
  spendingLimits: SpendingLimits
  totalFundedRaw: string     // cumulative USDC funded (6-decimal)
  totalSpentRaw: string      // cumulative USDC paid out
  tasksCreated: number
  reputation: number         // 0-100 platform score
  registeredAt: number       // unix ms
  isDemo: boolean            // true for the built-in demo agent
}

/** Machine-readable bounty format returned by GET /api/bounties */
export interface AgentBountyFormat {
  id: string
  onchain_id: number
  category: string
  task_type: string
  title: string
  description: string
  instructions: string
  reward_usdc: string        // human-readable e.g. "0.50"
  reward_raw: string         // 6-decimal integer string
  required_workers: number
  accepted_workers: number
  deadline_iso: string
  deadline_unix: number
  required_reputation: number
  status: BountyStatusEnum
  creator_address: string
  task_ref: string
  total_funded_usdc: string
  tags: string[]
  difficulty: string
  estimated_minutes: number
}

/** Machine-readable submission format */
export interface AgentSubmissionFormat {
  submission_id: string
  bounty_id: string
  worker_address: string
  answer_ref: string
  status: SubmissionStatusEnum
  reward_claimed: boolean
  submitted_at_iso: string
  submitted_at_unix: number
}

/** Worker discovery record */
export interface WorkerDiscoveryRecord {
  address: string
  reputation: number
  category_reputations: Record<string, number>
  completed_tasks: number
  dispute_rate: number       // 0.0 - 1.0
  avg_completion_time_min: number
  last_active_iso: string
  is_available: boolean
}

/** Daily spend tracking entry */
export interface DailySpend {
  agentId: string
  dateUtc: string   // YYYY-MM-DD
  spentRaw: string  // 6-decimal running total
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateApiKey(): string {
  return `hl_${randomBytes(24).toString('hex')}`
}

export function generateId(): string {
  return randomBytes(16).toString('hex')
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Agent store ──────────────────────────────────────────────────────────────


/**
 * Persistent agent/spending storage backed by Supabase Postgres over REST.
 * SUPABASE_SERVICE_ROLE_KEY is server-only and must never use a VITE_ prefix.
 */
type StoredAgentRow = {
  agent_id: string
  name: string
  description: string
  owner_wallet: string
  owner_wallet_lower: string
  api_key_hash: string
  supported_categories: TaskCategory[]
  spending_limits: AgentProfile['spendingLimits']
  total_funded_raw: string | number
  total_spent_raw: string | number
  tasks_created: number
  reputation: number
  registered_at: string | number
  is_demo: boolean
}

class StorageError extends Error {
  statusCode: number
  code?: string
  constructor(message: string, statusCode = 503, code?: string) {
    super(message)
    this.name = 'StorageError'
    this.statusCode = statusCode
    this.code = code
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
let demoSeedPromise: Promise<void> | null = null

function storageIsConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
}

async function supabaseRequest<T = unknown>(resource: string, init: RequestInit = {}): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new StorageError(
      'Persistent storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.',
      503,
      'STORAGE_NOT_CONFIGURED',
    )
  }

  const headers = new Headers(init.headers)
  headers.set('apikey', SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`)
  headers.set('Content-Type', 'application/json')
  if (!headers.has('Prefer') && init.method && init.method !== 'GET') headers.set('Prefer', 'return=representation')

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, { ...init, headers })
  const body = await response.text()
  if (!response.ok) {
    let code: string | undefined
    let details = ''
    try {
      const parsed = JSON.parse(body) as { code?: string; message?: string; details?: string }
      code = parsed.code
      details = parsed.message ?? parsed.details ?? ''
    } catch {
      details = body.slice(0, 200)
    }
    throw new StorageError(
      `Persistent storage request failed (HTTP ${response.status})${code ? ` [${code}]` : ''}${details ? `: ${details}` : ''}`,
      response.status === 409 ? 409 : 503,
      code,
    )
  }
  if (!body) return undefined as T
  return JSON.parse(body) as T
}

function agentFromRow(row: StoredAgentRow): AgentProfile {
  return {
    agentId: row.agent_id,
    name: row.name,
    description: row.description ?? '',
    ownerWallet: row.owner_wallet,
    apiKey: '',
    apiKeyHash: row.api_key_hash,
    supportedCategories: row.supported_categories ?? [],
    spendingLimits: row.spending_limits,
    totalFundedRaw: String(row.total_funded_raw ?? '0'),
    totalSpentRaw: String(row.total_spent_raw ?? '0'),
    tasksCreated: Number(row.tasks_created ?? 0),
    reputation: Number(row.reputation ?? 50),
    registeredAt: Number(row.registered_at),
    isDemo: Boolean(row.is_demo),
  }
}

async function ensurePersistentStore(): Promise<void> {
  if (!storageIsConfigured()) {
    throw new StorageError(
      'Persistent storage is not configured. Run docs/supabase-schema.sql in Supabase SQL Editor, then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.',
      503,
      'STORAGE_NOT_CONFIGURED',
    )
  }
  if (!demoSeedPromise) {
    demoSeedPromise = (async () => {
      const demoKey = 'hl_demo_research_agent_key_not_for_production'
      const demoWallet = '0x0000000000000000000000000000000000000001'
      const row = {
        agent_id: 'demo-research-agent-001',
        name: 'Research Verification Agent',
        description: 'A simulated AI agent that posts research verification tasks to HumanLayer. This is a DEMO agent — it does not autonomously execute onchain transactions.',
        owner_wallet: demoWallet,
        owner_wallet_lower: demoWallet.toLowerCase(),
        api_key_hash: hashApiKey(demoKey),
        supported_categories: ['Research', 'Science', 'BiologyMedicine'],
        spending_limits: { perTaskMax: '5000000', dailyLimit: '50000000', totalBudget: '500000000' },
        total_funded_raw: '25000000',
        total_spent_raw: '12500000',
        tasks_created: 5,
        reputation: 92,
        registered_at: Date.now() - 7 * 24 * 3600 * 1000,
        is_demo: true,
      }
      await supabaseRequest('humanlayer_agents?on_conflict=agent_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(row),
      })
    })().catch((error) => {
      demoSeedPromise = null
      throw error
    })
  }
  await demoSeedPromise
}

export async function registerAgent(data: {
  name: string
  description: string
  ownerWallet: string
  supportedCategories: AgentProfile['supportedCategories']
  spendingLimits: AgentProfile['spendingLimits']
}): Promise<{ agent: AgentProfile; rawApiKey: string }> {
  await ensurePersistentStore()
  const rawApiKey = generateApiKey()
  const profile: AgentProfile = {
    agentId: generateId(),
    name: data.name.trim(),
    description: data.description.trim(),
    ownerWallet: data.ownerWallet,
    apiKey: '',
    apiKeyHash: hashApiKey(rawApiKey),
    supportedCategories: data.supportedCategories,
    spendingLimits: data.spendingLimits,
    totalFundedRaw: '0',
    totalSpentRaw: '0',
    tasksCreated: 0,
    reputation: 50,
    registeredAt: Date.now(),
    isDemo: false,
  }
  const row = {
    agent_id: profile.agentId,
    name: profile.name,
    description: profile.description,
    owner_wallet: profile.ownerWallet,
    owner_wallet_lower: profile.ownerWallet.toLowerCase(),
    api_key_hash: profile.apiKeyHash,
    supported_categories: profile.supportedCategories,
    spending_limits: profile.spendingLimits,
    total_funded_raw: profile.totalFundedRaw,
    total_spent_raw: profile.totalSpentRaw,
    tasks_created: profile.tasksCreated,
    reputation: profile.reputation,
    registered_at: profile.registeredAt,
    is_demo: false,
  }
  await supabaseRequest('humanlayer_agents', { method: 'POST', body: JSON.stringify(row) })
  return { agent: { ...profile, apiKey: rawApiKey }, rawApiKey }
}

export async function getAgentById(agentId: string): Promise<AgentProfile | undefined> {
  await ensurePersistentStore()
  const rows = await supabaseRequest<StoredAgentRow[]>(
    `humanlayer_agents?select=*&agent_id=eq.${encodeURIComponent(agentId)}&limit=1`,
  )
  return rows[0] ? agentFromRow(rows[0]) : undefined
}

export async function getAgentByApiKey(rawKey: string): Promise<AgentProfile | undefined> {
  await ensurePersistentStore()
  const rows = await supabaseRequest<StoredAgentRow[]>(
    `humanlayer_agents?select=*&api_key_hash=eq.${encodeURIComponent(hashApiKey(rawKey))}&limit=1`,
  )
  return rows[0] ? agentFromRow(rows[0]) : undefined
}

export async function getAgentByWallet(address: string): Promise<AgentProfile | undefined> {
  await ensurePersistentStore()
  const rows = await supabaseRequest<StoredAgentRow[]>(
    `humanlayer_agents?select=*&owner_wallet_lower=eq.${encodeURIComponent(address.toLowerCase())}&limit=1`,
  )
  return rows[0] ? agentFromRow(rows[0]) : undefined
}

export async function incrementTasksCreated(agentId: string, rewardRaw: bigint): Promise<void> {
  await ensurePersistentStore()
  await supabaseRequest('rpc/increment_humanlayer_tasks_created', {
    method: 'POST',
    body: JSON.stringify({ p_agent_id: agentId, p_reward_raw: rewardRaw.toString() }),
  })
}

export async function recordSpend(agentId: string, spentRaw: bigint): Promise<void> {
  await ensurePersistentStore()
  await supabaseRequest('rpc/record_humanlayer_agent_spend', {
    method: 'POST',
    body: JSON.stringify({ p_agent_id: agentId, p_spent_raw: spentRaw.toString() }),
  })
}

export async function getDailySpent(agentId: string): Promise<bigint> {
  await ensurePersistentStore()
  const rows = await supabaseRequest<Array<{ spent_raw: string | number }>>(
    `humanlayer_daily_spends?select=spent_raw&agent_id=eq.${encodeURIComponent(agentId)}&date_utc=eq.${todayUtc()}&limit=1`,
  )
  return rows[0] ? BigInt(String(rows[0].spent_raw)) : 0n
}

export async function recordDailySpend(agentId: string, spentRaw: bigint): Promise<void> {
  await ensurePersistentStore()
  await supabaseRequest('rpc/record_humanlayer_daily_spend', {
    method: 'POST',
    body: JSON.stringify({ p_agent_id: agentId, p_date_utc: todayUtc(), p_spent_raw: spentRaw.toString() }),
  })
}

type SpendReservationRow = {
  reservation_id: string
  agent_id: string
  idempotency_key: string
  request_hash: string
  amount_raw: string | number
  daily_date_utc: string
  chain_id: number
  contract_address: string
  intent_payload: Record<string, unknown>
  status: 'reserved' | 'confirmed' | 'released' | 'expired'
  expires_at: string
  tx_hash: string | null
  bounty_id: string | number | null
}

async function reserveAgentSpend(input: {
  agentId: string
  idempotencyKey: string
  requestHash: string
  amountRaw: bigint
  perTaskRaw: bigint
  chainId: number
  contractAddress: Address
  intentPayload: Record<string, unknown>
  expiresAt: string
}) {
  await ensurePersistentStore()
  const result = await supabaseRequest<Record<string, unknown>>(
    'rpc/reserve_humanlayer_spend',
    {
      method: 'POST',
      body: JSON.stringify({
        p_agent_id: input.agentId,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
        p_amount_raw: input.amountRaw.toString(),
        p_per_task_raw: input.perTaskRaw.toString(),
        p_chain_id: input.chainId,
        p_contract_address: input.contractAddress,
        p_intent_payload: input.intentPayload,
        p_expires_at: input.expiresAt,
      }),
    },
  )
  // PostgREST returns a scalar jsonb RPC result as a JSON value, not a row set.
  const value = result
  if (value?.ok === false) return value
  return value
}

async function confirmAgentSpend(input: {
  agentId: string
  reservationId: string
  txHash: string
  bountyId: bigint
  amountRaw: bigint
  blockTimestamp: string
}) {
  await ensurePersistentStore()
  return supabaseRequest<Record<string, unknown>>('rpc/confirm_humanlayer_spend', {
    method: 'POST',
    body: JSON.stringify({
      p_agent_id: input.agentId,
      p_reservation_id: input.reservationId,
      p_tx_hash: input.txHash,
      p_bounty_id: input.bountyId.toString(),
      p_amount_raw: input.amountRaw.toString(),
      p_block_timestamp: input.blockTimestamp,
    }),
  })
}

async function releaseAgentSpend(input: {
  agentId: string
  reservationId: string
  txHash: string
  blockTimestamp: string
}) {
  await ensurePersistentStore()
  return supabaseRequest<Record<string, unknown>>('rpc/release_humanlayer_spend', {
    method: 'POST',
    body: JSON.stringify({
      p_agent_id: input.agentId,
      p_reservation_id: input.reservationId,
      p_tx_hash: input.txHash,
      p_block_timestamp: input.blockTimestamp,
    }),
  })
}

// ─── Worker discovery (seeded demo data) ─────────────────────────────────────
// arc-studio-allow-onchain-literal: demo fixture addresses, not real wallets

const WORKER_SEED: WorkerDiscoveryRecord[] = [
  {
    address: '0xA1b2C3d4E5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    reputation: 95,
    category_reputations: { Research: 97, Science: 90, BiologyMedicine: 88 },
    completed_tasks: 142,
    dispute_rate: 0.014,
    avg_completion_time_min: 18,
    last_active_iso: new Date(Date.now() - 3600 * 1000).toISOString(),
    is_available: true,
  },
  {
    address: '0xB2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
    reputation: 88,
    category_reputations: { Software: 92, Research: 85, ImageData: 80 },
    completed_tasks: 97,
    dispute_rate: 0.031,
    avg_completion_time_min: 24,
    last_active_iso: new Date(Date.now() - 7200 * 1000).toISOString(),
    is_available: true,
  },
  {
    address: '0xC3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    reputation: 72,
    category_reputations: { Language: 89, Research: 68, Science: 70 },
    completed_tasks: 53,
    dispute_rate: 0.057,
    avg_completion_time_min: 35,
    last_active_iso: new Date(Date.now() - 86400 * 1000).toISOString(),
    is_available: false,
  },
  {
    address: '0xD4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
    reputation: 98,
    category_reputations: { BiologyMedicine: 99, Science: 97, Research: 95 },
    completed_tasks: 311,
    dispute_rate: 0.003,
    avg_completion_time_min: 12,
    last_active_iso: new Date(Date.now() - 900 * 1000).toISOString(),
    is_available: true,
  },
  {
    address: '0xE5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
    reputation: 81,
    category_reputations: { ImageData: 91, Software: 79, Language: 82 },
    completed_tasks: 68,
    dispute_rate: 0.044,
    avg_completion_time_min: 28,
    last_active_iso: new Date(Date.now() - 43200 * 1000).toISOString(),
    is_available: true,
  },
]

export function getWorkers(filters?: {
  category?: string
  minReputation?: number
  maxDisputeRate?: number
  availableOnly?: boolean
}): WorkerDiscoveryRecord[] {
  let results = [...WORKER_SEED]

  if (filters?.availableOnly) {
    results = results.filter((w) => w.is_available)
  }
  if (filters?.minReputation !== undefined) {
    results = results.filter((w) => w.reputation >= filters.minReputation!)
  }
  if (filters?.maxDisputeRate !== undefined) {
    results = results.filter((w) => w.dispute_rate <= filters.maxDisputeRate!)
  }
  if (filters?.category) {
    const cat = filters.category
    results = results
      .filter((w) => Object.keys(w.category_reputations).includes(cat))
      .sort((a, b) => (b.category_reputations[cat] ?? 0) - (a.category_reputations[cat] ?? 0))
  } else {
    results.sort((a, b) => b.reputation - a.reputation)
  }

  return results
}

export function getWorkerByAddress(address: string): WorkerDiscoveryRecord | undefined {
  return WORKER_SEED.find((w) => w.address.toLowerCase() === address.toLowerCase())
}


/**
 * Validation helpers for the Agent API.
 * The backend never blindly trusts client-provided amounts.
 * All spending limits are enforced here before any onchain action is suggested.
 */


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

export async function checkSpendingLimits(
  agent: AgentProfile,
  rewardRaw: bigint,
  requiredWorkers: number
): Promise<SpendCheck> {
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
  const dailySpent = await getDailySpent(agent.agentId)
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


// ─── Config ───────────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = Number(process.env.VITE_ARC_CHAIN_ID ?? arcTestnet.id)
const ARC_CHAIN = getArcChain(ARC_CHAIN_ID)
const ARC_USDC = getUsdc(ARC_CHAIN_ID)
if (!ARC_USDC) throw new Error(`USDC is not configured for Arc chain ${ARC_CHAIN_ID}.`)
const contractAddressRaw = ARC_CHAIN_ID === arcMainnet.id
  ? process.env.VITE_HUMANLAYER_MAINNET_ADDRESS
  : process.env.VITE_HUMANLAYER_TESTNET_ADDRESS
    ?? process.env.VITE_HUMANLAYER_ADDRESS
    ?? ARC_TESTNET_HUMANLAYER_ADDRESS
const isTestnetContractOnMainnet =
  ARC_CHAIN_ID === arcMainnet.id &&
  contractAddressRaw?.toLowerCase() === ARC_TESTNET_HUMANLAYER_ADDRESS.toLowerCase()
const CONTRACT_ADDRESS: Address | undefined =
  contractAddressRaw && isAddress(contractAddressRaw) && !isTestnetContractOnMainnet
    ? getAddress(contractAddressRaw)
    : undefined
const CONTRACT_CONFIGURATION_ERROR = !contractAddressRaw
  ? 'No HumanLayer contract is configured for the selected Arc network.'
  : isTestnetContractOnMainnet
    ? 'The Arc Testnet HumanLayer contract address cannot be used for Arc Mainnet.'
  : !CONTRACT_ADDRESS
    ? 'The configured HumanLayer contract address is invalid.'
    : undefined

function getContractAddress(): Address {
  if (!CONTRACT_ADDRESS) throw new Error(CONTRACT_CONFIGURATION_ERROR)
  return CONTRACT_ADDRESS
}

const rpcUrl = ARC_CHAIN.rpcUrls.default.http[0]

const rpcClient: PublicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
})

// ─── Constants ────────────────────────────────────────────────────────────────

const BOUNTY_STATUS_MAP = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED'] as const
const SUBMISSION_STATUS_MAP = ['PENDING', 'APPROVED', 'REJECTED', 'DISPUTED'] as const
const CATEGORY_FROM_INDEX = ['Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']
const VALID_CATEGORIES_ONCHAIN = ['Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']

// ─── Rate limiting (per-instance in-memory) ───────────────────────────────────

const RATE_WINDOW_MS = 60_000
const RATE_LIMIT_GENERAL = 120
const RATE_LIMIT_WRITE = 20
interface RateBucket { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>()

function checkRateLimit(ip: string, isWrite: boolean): boolean {
  const key = `${isWrite ? 'w' : 'r'}:${ip}`
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  const limit = isWrite ? RATE_LIMIT_WRITE : RATE_LIMIT_GENERAL
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count++
  return true
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function json(res: VercelResponse, status: number, body: unknown) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'X-HumanLayer-Chain-ID')
  res.setHeader('X-HumanLayer-Chain-ID', String(ARC_CHAIN_ID))
  res.status(status).json(body)
}

function pathParts(url: string): string[] {
  return url.split('?')[0].split('/').filter(Boolean)
}

function getQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '')
}

// ─── Onchain helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBountyRaw(id: number): Promise<any> {
  return rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'getBounty', args: [BigInt(id)] })
}

async function getBountyCount(): Promise<number> {
  const count = await rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'getBountyCount' })
  return Number(count)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSubmissionRaw(id: bigint): Promise<any> {
  return rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'getSubmission', args: [id] })
}

async function getBountySubmissionIds(bountyId: bigint): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'getBountySubmissions', args: [bountyId] })
  return ids as bigint[]
}

async function getWorkerReputation(address: `0x${string}`): Promise<bigint> {
  return rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'workerReputation', args: [address] }) as Promise<bigint>
}

async function getWorkerSubmissionIds(address: `0x${string}`): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: getContractAddress(), abi: ABI, functionName: 'getWorkerSubmissions', args: [address] })
  return ids as bigint[]
}

// ─── Formatters ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatBounty(raw: any, meta?: Partial<AgentBountyFormat>): AgentBountyFormat {
  const rewardRaw = BigInt(raw.rewardPerWorker ?? 0n)
  const totalFundedRaw = BigInt(raw.totalFunded ?? 0n)
  const statusIdx = Number(raw.status ?? 0)
  const catIdx = Number(raw.category ?? 0)
  return {
    id: `bounty-${raw.bountyId}`,
    onchain_id: Number(raw.bountyId),
    category: CATEGORY_FROM_INDEX[catIdx] ?? 'Research',
    task_type: meta?.task_type ?? 'Verify',
    title: meta?.title ?? `Bounty #${raw.bountyId}`,
    description: meta?.description ?? '',
    instructions: meta?.instructions ?? '',
    reward_usdc: (Number(rewardRaw) / 1_000_000).toFixed(6),
    reward_raw: rewardRaw.toString(),
    required_workers: Number(raw.requiredWorkers ?? 1),
    accepted_workers: Number(raw.acceptedCount ?? 0),
    deadline_iso: new Date(Number(raw.deadline ?? 0) * 1000).toISOString(),
    deadline_unix: Number(raw.deadline ?? 0),
    required_reputation: 0,
    status: (BOUNTY_STATUS_MAP[statusIdx] ?? 'OPEN') as AgentBountyFormat['status'],
    creator_address: raw.creator ?? '',
    task_ref: raw.taskRef ?? '',
    total_funded_usdc: (Number(totalFundedRaw) / 1_000_000).toFixed(6),
    tags: meta?.tags ?? [],
    difficulty: meta?.difficulty ?? 'Medium',
    estimated_minutes: meta?.estimated_minutes ?? 30,
    ...meta,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSubmission(raw: any): AgentSubmissionFormat {
  const statusIdx = Number(raw.status ?? 0)
  return {
    submission_id: raw.submissionId.toString(),
    bounty_id: raw.bountyId.toString(),
    worker_address: raw.worker ?? '',
    answer_ref: raw.answerRef ?? '',
    status: (SUBMISSION_STATUS_MAP[statusIdx] ?? 'PENDING') as AgentSubmissionFormat['status'],
    reward_claimed: Boolean(raw.rewardClaimed),
    submitted_at_iso: new Date(Number(raw.submittedAt ?? 0) * 1000).toISOString(),
    submitted_at_unix: Number(raw.submittedAt ?? 0),
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const body = req.body as Record<string, unknown> ?? {}
  const { name, description, owner_wallet, supported_categories, spending_limits } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return json(res, 400, { error: 'name must be at least 2 characters.' })
  if (!isValidAddress(owner_wallet))
    return json(res, 400, { error: 'owner_wallet must be a valid EVM address (0x...).' })
  if (await getAgentByWallet(owner_wallet as string))
    return json(res, 409, { error: 'This wallet address is already registered as an agent.' })

  const cats = Array.isArray(supported_categories) ? supported_categories : ['Research']
  const invalidCats = cats.filter((c) => !isValidCategory(c))
  if (invalidCats.length > 0)
    return json(res, 400, { error: `Invalid categories: ${invalidCats.join(', ')}. Valid values: ${VALID_CATEGORIES.join(', ')}.` })

  const limits = (spending_limits && typeof spending_limits === 'object') ? spending_limits as Record<string, unknown> : {}
  const spendingLimits = {
    perTaskMax: String(limits.per_task_max ?? '10000000'),
    dailyLimit: String(limits.daily_limit ?? '100000000'),
    totalBudget: String(limits.total_budget ?? '1000000000'),
  }

  const { agent, rawApiKey } = await registerAgent({
    name: String(name),
    description: description ? String(description) : '',
    ownerWallet: owner_wallet as string,
    supportedCategories: cats,
    spendingLimits,
  })

  return json(res, 201, {
    agent_id: agent.agentId,
    name: agent.name,
    owner_wallet: agent.ownerWallet,
    api_key: rawApiKey,
    _warning: 'Store this api_key securely. It will not be shown again. Agent registration is stored in persistent Supabase Postgres storage.',
    supported_categories: agent.supportedCategories,
    spending_limits: {
      per_task_max_usdc: (Number(BigInt(spendingLimits.perTaskMax)) / 1e6).toFixed(2),
      daily_limit_usdc: (Number(BigInt(spendingLimits.dailyLimit)) / 1e6).toFixed(2),
      total_budget_usdc: (Number(BigInt(spendingLimits.totalBudget)) / 1e6).toFixed(2),
    },
    registered_at: new Date(agent.registeredAt).toISOString(),
  })
}

async function handleListBounties(req: VercelRequest, res: VercelResponse) {
  const q = getQuery(req.url ?? '')
  const statusFilter = q.get('status')?.toUpperCase()
  const categoryFilter = q.get('category')
  const creatorFilter = q.get('creator')?.toLowerCase()
  const limitParam = parseInt(q.get('limit') ?? '50')
  const limit = isNaN(limitParam) || limitParam < 1 ? 50 : Math.min(limitParam, 200)

  try {
    const count = await getBountyCount()
    const ids = Array.from({ length: count }, (_, i) => i + 1)
    const rawBounties = await Promise.all(ids.map((id) => getBountyRaw(id)))

    let formatted = rawBounties
      .filter((b) => b && b.bountyId !== 0n)
      .map((b) => formatBounty(b))

    if (statusFilter) formatted = formatted.filter((b) => b.status === statusFilter)
    if (categoryFilter) formatted = formatted.filter((b) => b.category.toLowerCase() === categoryFilter.toLowerCase())
    if (creatorFilter) formatted = formatted.filter((b) => b.creator_address.toLowerCase() === creatorFilter)

    const results = formatted.slice(0, limit)
    return json(res, 200, {
      total: results.length,
      contract_address: getContractAddress(),
      chain: ARC_CHAIN.name,
      chain_id: ARC_CHAIN_ID,
      bounties: results,
    })
  } catch (err) {
    console.error('GET /api/bounties error:', err)
    return json(res, 502, { error: 'Failed to read bounties from chain. RPC may be unavailable.' })
  }
}

async function handleGetBounty(req: VercelRequest, res: VercelResponse, id: string) {
  const idNum = parseInt(id)
  if (isNaN(idNum) || idNum < 1) return json(res, 400, { error: 'Bounty ID must be a positive integer.' })
  try {
    const raw = await getBountyRaw(idNum)
    if (!raw || raw.bountyId === 0n) return json(res, 404, { error: `Bounty #${idNum} not found.` })
    return json(res, 200, formatBounty(raw))
  } catch (err) {
    console.error(`GET /api/bounties/${id} error:`, err)
    return json(res, 502, { error: 'Failed to read bounty from chain.' })
  }
}

async function handleCreateBountyIntent(req: VercelRequest, res: VercelResponse) {
  const contractAddress = getContractAddress()
  const token = extractBearerToken(req.headers.authorization as string | undefined)
  if (!token) return json(res, 401, { error: 'Missing Authorization header. Use: Authorization: Bearer <api_key>' })
  const agent = await getAgentByApiKey(token)
  if (!agent) return json(res, 401, { error: 'Invalid API key.' })
  const idempotencyHeader = req.headers['idempotency-key']
  const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader
  if (!agent.isDemo && (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 1 || idempotencyKey.length > 128)) {
    return json(res, 400, { error: 'Provide an Idempotency-Key header between 1 and 128 characters.' })
  }

  const body = req.body as Record<string, unknown> ?? {}
  const validation = validateBountyPayload(body)
  if (!validation.ok) return json(res, 422, { error: 'Validation failed.', fields: validation.errors })

  const category = body.category as string
  if (!isCategoryAllowed(agent, isValidCategory(category) ? category : 'Research'))
    return json(res, 403, { error: `Your agent is not authorized for category "${category}". Allowed: ${agent.supportedCategories.join(', ')}.`, error_code: 'CATEGORY_NOT_ALLOWED' })

  const rewardRaw = parseUsdcHuman(body.reward_usdc)!
  const workers = parseInt(String(body.required_workers))
  const days = parseInt(String(body.days_until_deadline))

  const totalRaw = rewardRaw * BigInt(workers)
  const title = String(body.title)
  const taskType = String(body.task_type)
  const description = String(body.description ?? '')
  const requestHash = createHash('sha256').update(JSON.stringify({
    agentId: agent.agentId,
    title,
    description,
    category,
    taskType,
    rewardRaw: rewardRaw.toString(),
    workers,
    days,
  })).digest('hex')
  const requestFacts = JSON.stringify({ title, description, category, taskType, rewardRaw: rewardRaw.toString(), workers, days })
  const taskRef = keccak256(toBytes(requestFacts))
  const deadlineUnix = Math.floor(Date.now() / 1000) + days * 86400
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const intentPayload = {
    title,
    description,
    category,
    taskType,
    rewardRaw: rewardRaw.toString(),
    workers,
    deadlineUnix,
    taskRef,
  }
  const reservationResult = agent.isDemo
    ? {
        ok: true,
        replayed: false,
        reservation: {
          reservation_id: 'demo',
          status: 'demo',
          expires_at: expiresAt,
          amount_raw: totalRaw.toString(),
          intent_payload: intentPayload,
        },
      }
    : await reserveAgentSpend({
    agentId: agent.agentId,
    idempotencyKey: (idempotencyKey as string).trim(),
    requestHash,
    amountRaw: totalRaw,
    perTaskRaw: rewardRaw,
    chainId: ARC_CHAIN_ID,
    contractAddress,
    intentPayload,
    expiresAt,
  })
  if (reservationResult.ok === false) {
    const code = String(reservationResult.code ?? 'SPENDING_LIMIT_EXCEEDED')
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      return json(res, 409, { error: 'This Idempotency-Key was already used for a different request.', error_code: code })
    }
    if (code === 'INVALID_RESERVATION' || code === 'AGENT_NOT_FOUND') {
      return json(res, 500, { error: 'Could not create the spend reservation.', error_code: code })
    }
    const error = code === 'EXCEEDS_PER_TASK_LIMIT'
      ? `Reward per worker exceeds your per-task limit (${formatUsdcHuman(BigInt(agent.spendingLimits.perTaskMax))} USDC).`
      : code === 'EXCEEDS_DAILY_LIMIT'
        ? `This bounty would exceed your daily spending limit (${formatUsdcHuman(BigInt(agent.spendingLimits.dailyLimit))} USDC/day).`
        : `This bounty would exceed your total budget (${formatUsdcHuman(BigInt(agent.spendingLimits.totalBudget))} USDC).`
    return json(res, 403, { error, error_code: code })
  }
  const reservation = reservationResult.reservation as SpendReservationRow
  const intent = reservation.intent_payload
  const resolvedRewardRaw = BigInt(String(intent.rewardRaw))
  const resolvedWorkers = Number(intent.workers)
  const resolvedTotalRaw = BigInt(String(reservation.amount_raw))
  const resolvedDeadlineUnix = Number(intent.deadlineUnix)
  const resolvedTaskRef = String(intent.taskRef)

  return json(res, 200, {
    _note: agent.isDemo
      ? 'DEMO ONLY. No spend was reserved and no transaction was submitted.'
      : 'RESERVED TRANSACTION INTENT. No onchain transaction has been submitted. Your agent wallet must submit the transactions below before the reservation expires. API limits cover requests made through this API; the owner wallet can still submit transactions directly onchain.',
    agent_id: agent.agentId,
    is_demo: agent.isDemo,
    validated: true,
    reservation: {
      id: reservation.reservation_id,
      status: reservation.status,
      expires_at: reservation.expires_at,
      replayed: Boolean(reservationResult.replayed),
    },
    spending_check: {
      reward_per_worker_usdc: (Number(resolvedRewardRaw) / 1e6).toFixed(6),
      total_escrow_usdc: (Number(resolvedTotalRaw) / 1e6).toFixed(6),
      within_per_task_limit: true,
      within_daily_limit: true,
      within_total_budget: true,
    },
    onchain_steps: [
      {
        step: 1, action: 'createBounty', contract: contractAddress,
        function: 'createBounty(uint8,bytes32,uint8,uint256,uint256)',
        args: {
          category: VALID_CATEGORIES_ONCHAIN.indexOf(String(intent.category)),
          taskRef: resolvedTaskRef,
          requiredWorkers: resolvedWorkers,
          rewardPerWorker: resolvedRewardRaw.toString(),
          deadline: resolvedDeadlineUnix,
        },
        note: 'Emits BountyCreated. Parse bountyId from event logs.',
      },
      {
        step: 2, action: 'approveUSDC',
        contract: ARC_USDC!.address,
        function: 'approve(address,uint256)',
        args: { spender: contractAddress, amount: resolvedTotalRaw.toString() },
        note: 'Approve HumanLayer contract to transfer USDC escrow.',
      },
      {
        step: 3, action: 'fundBounty', contract: contractAddress,
        function: 'fundBounty(uint256)',
        args: { bountyId: '<bountyId from step 1 event>' },
        note: 'Transfers totalRaw USDC into escrow. Bounty becomes OPEN.',
      },
    ],
    bounty_preview: {
      title: body.title,
      category: intent.category,
      task_type: intent.taskType,
      reward_per_worker_usdc: (Number(resolvedRewardRaw) / 1e6).toFixed(6),
      required_workers: resolvedWorkers,
      deadline_iso: new Date(resolvedDeadlineUnix * 1000).toISOString(),
      total_escrow_usdc: (Number(resolvedTotalRaw) / 1e6).toFixed(6),
    },
  })
}

async function getAuthenticatedAgent(req: VercelRequest, res: VercelResponse): Promise<AgentProfile | null> {
  const token = extractBearerToken(req.headers.authorization as string | undefined)
  if (!token) {
    json(res, 401, { error: 'Missing Authorization header. Use: Authorization: Bearer <api_key>' })
    return null
  }
  const agent = await getAgentByApiKey(token)
  if (!agent) {
    json(res, 401, { error: 'Invalid API key.' })
    return null
  }
  return agent
}

async function handleConfirmBountyReservation(req: VercelRequest, res: VercelResponse, reservationId: string) {
  const agent = await getAuthenticatedAgent(req, res)
  if (!agent) return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
    return json(res, 400, { error: 'Invalid reservation ID.' })
  }
  const rows = await supabaseRequest<SpendReservationRow[]>(
    `humanlayer_spend_reservations?select=*&reservation_id=eq.${encodeURIComponent(reservationId)}&agent_id=eq.${encodeURIComponent(agent.agentId)}&limit=1`,
  )
  const reservation = rows[0]
  if (!reservation) return json(res, 404, { error: 'Spend reservation not found.' })
  if (reservation.chain_id !== ARC_CHAIN_ID || reservation.contract_address.toLowerCase() !== getContractAddress().toLowerCase()) {
    return json(res, 409, { error: 'Reservation targets a different chain or contract configuration.', error_code: 'RESERVATION_NETWORK_MISMATCH' })
  }
  const body = req.body as Record<string, unknown> ?? {}
  const txHash = body.tx_hash
  const bountyIdInput = body.bounty_id
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json(res, 400, { error: 'tx_hash must be a 32-byte transaction hash.' })
  }
  if (!/^[1-9][0-9]*$/.test(String(bountyIdInput ?? ''))) {
    return json(res, 400, { error: 'bounty_id must be a positive integer.' })
  }
  const bountyId = BigInt(String(bountyIdInput))
  if (reservation.status === 'confirmed') {
    if (reservation.tx_hash?.toLowerCase() === txHash.toLowerCase() && String(reservation.bounty_id) === bountyId.toString()) {
      return json(res, 200, { confirmed: true, replayed: true, reservation_id: reservation.reservation_id, tx_hash: txHash, bounty_id: bountyId.toString() })
    }
    return json(res, 409, { error: 'Reservation was already confirmed by another transaction.', error_code: 'RESERVATION_ALREADY_CONFIRMED' })
  }
  if (reservation.status === 'released') return json(res, 409, { error: 'Released reservation cannot be confirmed.' })

  const contractAddress = getContractAddress()
  const receipt = await rpcClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
  if (!receipt.to || receipt.to.toLowerCase() !== contractAddress.toLowerCase() || receipt.from.toLowerCase() !== agent.ownerWallet.toLowerCase()) {
    return json(res, 422, { error: 'Transaction sender or destination does not match this agent and contract.' })
  }
  const block = await rpcClient.getBlock({ blockNumber: receipt.blockNumber })
  const blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString()
  if (receipt.status === 'reverted') {
    await releaseAgentSpend({ agentId: agent.agentId, reservationId, txHash, blockTimestamp })
    return json(res, 409, { error: 'The onchain transaction reverted; its spend reservation was released.', error_code: 'TRANSACTION_REVERTED' })
  }

  let fundedEvent: { bountyId: bigint; funder: Address; amount: bigint } | undefined
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics })
      if (decoded.eventName === 'BountyFunded') {
        const args = decoded.args as unknown as { bountyId: bigint; funder: Address; amount: bigint }
        fundedEvent = args
      }
    } catch {
      // Ignore other events emitted by the HumanLayer contract.
    }
  }
  if (!fundedEvent || fundedEvent.bountyId !== bountyId || fundedEvent.funder.toLowerCase() !== agent.ownerWallet.toLowerCase() || fundedEvent.amount !== BigInt(String(reservation.amount_raw))) {
    return json(res, 422, { error: 'Receipt does not contain the expected BountyFunded event for this reservation.' })
  }
  const result = await confirmAgentSpend({
    agentId: agent.agentId,
    reservationId,
    txHash,
    bountyId,
    amountRaw: fundedEvent.amount,
    blockTimestamp,
  })
  return json(res, 200, { confirmed: true, reservation_id: reservationId, tx_hash: txHash, bounty_id: bountyId.toString(), amount_usdc: formatUsdcHuman(fundedEvent.amount), result })
}

async function handleReleaseBountyReservation(req: VercelRequest, res: VercelResponse, reservationId: string) {
  const agent = await getAuthenticatedAgent(req, res)
  if (!agent) return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId)) {
    return json(res, 400, { error: 'Invalid reservation ID.' })
  }
  const body = req.body as Record<string, unknown> ?? {}
  const txHash = body.tx_hash
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json(res, 400, { error: 'tx_hash must be a 32-byte transaction hash.' })
  }
  const receipt = await rpcClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
  const contractAddress = getContractAddress()
  if (receipt.status !== 'reverted' || !receipt.to || receipt.to.toLowerCase() !== contractAddress.toLowerCase() || receipt.from.toLowerCase() !== agent.ownerWallet.toLowerCase()) {
    return json(res, 422, { error: 'Only a reverted transaction sent by this agent to the configured contract can release a reservation.' })
  }
  const block = await rpcClient.getBlock({ blockNumber: receipt.blockNumber })
  const blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString()
  const result = await releaseAgentSpend({ agentId: agent.agentId, reservationId, txHash, blockTimestamp })
  return json(res, 200, { released: true, reservation_id: reservationId, tx_hash: txHash, result })
}

async function handleGetSubmissions(req: VercelRequest, res: VercelResponse, bountyId: string) {
  const idNum = parseInt(bountyId)
  if (isNaN(idNum) || idNum < 1) return json(res, 400, { error: 'Bounty ID must be a positive integer.' })
  try {
    const ids = await getBountySubmissionIds(BigInt(idNum))
    const raws = await Promise.all(ids.map((id) => getSubmissionRaw(id)))
    const submissions = raws.filter((s) => s && s.submissionId !== 0n).map(formatSubmission)
    return json(res, 200, { bounty_id: idNum, total: submissions.length, submissions })
  } catch (err) {
    console.error(`GET /api/bounties/${bountyId}/submissions error:`, err)
    return json(res, 502, { error: 'Failed to read submissions from chain.' })
  }
}

async function handleSubmitWork(req: VercelRequest, res: VercelResponse, bountyId: string) {
  const contractAddress = getContractAddress()
  const body = req.body as Record<string, unknown> ?? {}
  const idNum = parseInt(bountyId)
  if (isNaN(idNum) || idNum < 1) return json(res, 400, { error: 'Invalid bounty ID.' })

  const { worker_address, answer_ref } = body
  if (!isValidAddress(worker_address))
    return json(res, 400, { error: 'worker_address must be a valid EVM address.' })
  if (!answer_ref || typeof answer_ref !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(answer_ref))
    return json(res, 400, { error: 'answer_ref must be a bytes32 hex string (0x + 64 hex chars).' })

  return json(res, 200, {
    _note: 'PRE-FLIGHT VALIDATION. Submit the transaction below from the worker wallet.',
    validated: true,
    onchain_step: {
      action: 'submitWork', contract: contractAddress,
      function: 'submitWork(uint256,bytes32)',
      args: { bountyId: idNum, answerRef: answer_ref },
      signer: 'Must be signed by worker_address wallet.',
      note: 'Emits WorkSubmitted(bountyId, submissionId, worker). Parse submissionId from event logs.',
    },
  })
}

async function handleGetAgent(res: VercelResponse, agentId: string) {
  const agent = await getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })
  return json(res, 200, {
    agent_id: agent.agentId, name: agent.name, description: agent.description,
    owner_wallet: agent.ownerWallet, supported_categories: agent.supportedCategories,
    tasks_created: agent.tasksCreated, reputation: agent.reputation,
    is_demo: agent.isDemo,
    registered_at: new Date(agent.registeredAt).toISOString(),
    spending_summary: {
      total_funded_usdc: (Number(BigInt(agent.totalFundedRaw)) / 1e6).toFixed(2),
      total_spent_usdc: (Number(BigInt(agent.totalSpentRaw)) / 1e6).toFixed(2),
      budget_usdc: (Number(BigInt(agent.spendingLimits.totalBudget)) / 1e6).toFixed(2),
      remaining_budget_usdc: (
        (Number(BigInt(agent.spendingLimits.totalBudget)) - Number(BigInt(agent.totalFundedRaw))) / 1e6
      ).toFixed(2),
    },
  })
}

async function handleGetAgentReputation(res: VercelResponse, agentId: string) {
  const agent = await getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })
  // arc-studio-allow-onchain-literal: demo wallet sentinel check
  const onchainRep = agent.ownerWallet !== '0x0000000000000000000000000000000000000001'
    ? await getWorkerReputation(agent.ownerWallet as `0x${string}`).catch(() => 0n)
    : 0n
  return json(res, 200, {
    agent_id: agent.agentId, platform_reputation: agent.reputation,
    onchain_approved_submissions: Number(onchainRep),
    tasks_created: agent.tasksCreated,
    total_funded_usdc: (Number(BigInt(agent.totalFundedRaw)) / 1e6).toFixed(2),
  })
}

async function handleGetAgentActivity(res: VercelResponse, agentId: string) {
  const agent = await getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })

  let bounties: AgentBountyFormat[] = []
  // arc-studio-allow-onchain-literal: demo wallet sentinel check
  if (agent.ownerWallet !== '0x0000000000000000000000000000000000000001') {
    try {
      const count = await getBountyCount()
      const ids = Array.from({ length: count }, (_, i) => i + 1)
      const raws = await Promise.all(ids.map((id) => getBountyRaw(id)))
      bounties = raws
        .filter((b) => b && b.creator?.toLowerCase() === agent.ownerWallet.toLowerCase())
        .map((b) => formatBounty(b))
    } catch { /* rpc failure */ }
  }

  return json(res, 200, {
    agent_id: agent.agentId, owner_wallet: agent.ownerWallet,
    tasks_created: agent.tasksCreated,
    total_funded_usdc: (Number(BigInt(agent.totalFundedRaw)) / 1e6).toFixed(2),
    total_spent_usdc: (Number(BigInt(agent.totalSpentRaw)) / 1e6).toFixed(2),
    onchain_bounties_count: bounties.length,
    onchain_bounties: bounties,
    is_demo: agent.isDemo,
  })
}

function handleDiscoverWorkers(req: VercelRequest, res: VercelResponse) {
  const q = getQuery(req.url ?? '')
  const category = q.get('category') ?? undefined
  const minRep = q.get('min_reputation') ? parseInt(q.get('min_reputation')!) : undefined
  const maxDispute = q.get('max_dispute_rate') ? parseFloat(q.get('max_dispute_rate')!) : undefined
  const availOnly = q.get('available_only') !== 'false'

  const workers = getWorkers({ category, minReputation: minRep, maxDisputeRate: maxDispute, availableOnly: availOnly })
  return json(res, 200, {
    total: workers.length,
    filters_applied: { category, min_reputation: minRep, max_dispute_rate: maxDispute, available_only: availOnly },
    workers,
  })
}

async function handleGetWorkerProfile(res: VercelResponse, address: string) {
  if (!isValidAddress(address)) return json(res, 400, { error: 'Invalid EVM address.' })

  const seeded = getWorkerByAddress(address)
  let onchainRep = 0n
  let submissionCount = 0

  try { onchainRep = await getWorkerReputation(address as `0x${string}`) } catch { /* rpc unavailable */ }
  try {
    const ids = await getWorkerSubmissionIds(address as `0x${string}`)
    submissionCount = ids.length
  } catch { /* rpc unavailable */ }

  const profile = seeded ?? {
    address, reputation: Number(onchainRep),
    category_reputations: {}, completed_tasks: submissionCount,
    dispute_rate: 0, avg_completion_time_min: 0,
    last_active_iso: new Date().toISOString(), is_available: true,
  }

  return json(res, 200, { ...profile, onchain_approved_submissions: Number(onchainRep), total_submissions: submissionCount })
}

// ─── Main handler (Vercel entry point) ────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const method = req.method?.toUpperCase() ?? 'GET'
  
    // CORS preflight
    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Expose-Headers', 'X-HumanLayer-Chain-ID')
      res.setHeader('X-HumanLayer-Chain-ID', String(ARC_CHAIN_ID))
      return res.status(204).end()
    }
  
    // Rate limiting
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown'
    const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE'
    if (!checkRateLimit(ip, isWrite)) {
      return json(res, 429, { error: 'Too many requests.', error_code: 'RATE_LIMITED', retry_after_seconds: 60 })
    }
  
    const url = req.url ?? '/'
    const parts = pathParts(url)
  
    // GET /health
    if (parts[0] === 'health') {
      let storageStatus: 'connected' | 'not_configured' | 'unavailable' = 'not_configured'
      if (storageIsConfigured()) {
        try {
          await ensurePersistentStore()
          storageStatus = 'connected'
        } catch (error) {
          storageStatus = 'unavailable'
          console.error('Persistent storage health check failed:', error)
        }
      }
      return json(res, 200, {
        status: 'ok',
        service: 'HumanLayer Agent API',
        version: '1.0.0',
        chain: ARC_CHAIN.name,
        chain_id: ARC_CHAIN_ID,
        contract_address: CONTRACT_ADDRESS ?? null,
        contract_configured: Boolean(CONTRACT_ADDRESS),
        contract_configuration_error: CONTRACT_CONFIGURATION_ERROR,
        storage: storageStatus,
        note: storageStatus === 'connected'
          ? 'Agent registrations are stored in Supabase Postgres.'
          : 'Persistent storage is not ready. Configure Supabase before using agent registration and agent-specific endpoints.',
      })
    }
  
    if (parts[0] !== 'api') {
      return json(res, 404, { error: 'Not found. All endpoints are under /api/*' })
    }

    const needsContract =
      parts[1] === 'bounties' ||
      parts[1] === 'workers' ||
      (parts[1] === 'agents' && (parts[3] === 'reputation' || parts[3] === 'activity'))
    if (needsContract && !CONTRACT_ADDRESS) {
      return json(res, 503, {
        error: CONTRACT_CONFIGURATION_ERROR,
        chain: ARC_CHAIN.name,
        chain_id: ARC_CHAIN_ID,
      })
    }
  
    const needsPersistentStorage =
      (method === 'POST' && parts[1] === 'agents' && parts[2] === 'register') ||
      (method === 'GET' && parts[1] === 'agents' && Boolean(parts[2]) && parts[2] !== 'workers') ||
      (method === 'POST' && parts[1] === 'bounties' && (!parts[2] || parts[2] === 'reservations'))
    if (needsPersistentStorage && !storageIsConfigured()) {
      return json(res, 503, {
        error: 'Persistent agent storage is not configured.',
        required_environment_variables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        setup: 'Run docs/supabase-schema.sql in Supabase SQL Editor, then add both server-only variables in Vercel.',
      })
    }
  
    // POST /api/agents/register
    if (method === 'POST' && parts[1] === 'agents' && parts[2] === 'register')
      return await handleRegister(req, res)
  
    // GET /api/agents/workers
    if (method === 'GET' && parts[1] === 'agents' && parts[2] === 'workers')
      return handleDiscoverWorkers(req, res)
  
    // GET /api/agents/:id
    if (method === 'GET' && parts[1] === 'agents' && parts[2] && !parts[3])
      return await handleGetAgent(res, parts[2])
  
    // GET /api/agents/:id/reputation
    if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'reputation')
      return await handleGetAgentReputation(res, parts[2])
  
    // GET /api/agents/:id/activity
    if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'activity')
      return await handleGetAgentActivity(res, parts[2])
  
    // GET /api/bounties
    if (method === 'GET' && parts[1] === 'bounties' && !parts[2])
      return await handleListBounties(req, res)
  
    // POST /api/bounties
    if (method === 'POST' && parts[1] === 'bounties' && !parts[2])
      return await handleCreateBountyIntent(req, res)

    // POST /api/bounties/reservations/:id/confirm
    if (method === 'POST' && parts[1] === 'bounties' && parts[2] === 'reservations' && parts[3] && parts[4] === 'confirm')
      return await handleConfirmBountyReservation(req, res, parts[3])

    // POST /api/bounties/reservations/:id/release (requires a failed onchain receipt)
    if (method === 'POST' && parts[1] === 'bounties' && parts[2] === 'reservations' && parts[3] && parts[4] === 'release')
      return await handleReleaseBountyReservation(req, res, parts[3])
  
    // GET /api/bounties/:id
    if (method === 'GET' && parts[1] === 'bounties' && parts[2] && !parts[3])
      return await handleGetBounty(req, res, parts[2])
  
    // GET /api/bounties/:id/submissions
    if (method === 'GET' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submissions')
      return await handleGetSubmissions(req, res, parts[2])
  
    // POST /api/bounties/:id/submit
    if (method === 'POST' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submit')
      return await handleSubmitWork(req, res, parts[2])
  
    // GET /api/workers/:address
    if (method === 'GET' && parts[1] === 'workers' && parts[2])
      return await handleGetWorkerProfile(res, parts[2])
  
    return json(res, 404, {
      error: 'Endpoint not found.',
      available_endpoints: [
        'GET  /health',
        'POST /api/agents/register',
        'GET  /api/agents/:id',
        'GET  /api/agents/:id/reputation',
        'GET  /api/agents/:id/activity',
        'GET  /api/agents/workers',
        'GET  /api/bounties',
        'POST /api/bounties',
        'POST /api/bounties/reservations/:id/confirm',
        'POST /api/bounties/reservations/:id/release',
        'GET  /api/bounties/:id',
        'GET  /api/bounties/:id/submissions',
        'POST /api/bounties/:id/submit',
        'GET  /api/workers/:address',
      ],
    })
  } catch (error) {
    console.error('Unhandled HumanLayer API error:', error)
    if (error instanceof StorageError) {
      return json(res, error.statusCode, {
        error: error.code === 'STORAGE_NOT_CONFIGURED' ? 'Persistent storage is not configured.' : 'Persistent storage request failed.',
        code: error.code ?? 'STORAGE_ERROR',
      })
    }
    return json(res, 500, { error: 'Internal server error.' })
  }
}
