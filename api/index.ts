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
 * - The in-memory store does NOT persist across serverless invocations.
 *   See LIMITATIONS below.
 *
 * LIMITATIONS OF THIS DEPLOYMENT:
 * - Vercel serverless functions are stateless. Each cold start begins with a
 *   fresh in-memory store. Agent registrations, spending records, and daily
 *   spend counters are NOT durable across invocations.
 * - The built-in demo agent (demo-research-agent-001) is always available
 *   because it is seeded at module load time, but any agents registered via
 *   POST /api/agents/register will be lost when the function instance recycles.
 * - For production use, replace the in-memory Maps in server/store.ts with a
 *   persistent store (e.g. Vercel KV, PlanetScale, Upstash Redis). This is a
 *   known prototype limitation; no paid service has been silently added.
 * - Rate-limiting buckets are also per-instance and do not share state across
 *   concurrent function instances.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import ABI from '../src/lib/humanlayer-abi.json' with { type: 'json' }



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


/**
 * In-memory store for agent registrations, spending tracking, and
 * worker discovery data. Survives for the lifetime of the server process.
 *
 * In production this would be a database. For this demo the store is
 * seeded with a Research Agent and representative worker profiles.
 */


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

const agents = new Map<string, AgentProfile>()          // agentId → profile
const apiKeyHashIndex = new Map<string, string>()       // apiKeyHash → agentId
const walletIndex = new Map<string, string>()           // lowerAddress → agentId

/** Seed: built-in demo Research Agent */
function seedDemoAgent() {
  const demoKey = 'hl_demo_research_agent_key_not_for_production'
  const demoId = 'demo-research-agent-001'
  // arc-studio-allow-onchain-literal: placeholder wallet for demo agent only
  const demoWallet = '0x0000000000000000000000000000000000000001'
  const profile: AgentProfile = {
    agentId: demoId,
    name: 'Research Verification Agent',
    description:
      'A simulated AI agent that posts research verification tasks to HumanLayer. ' +
      'This is a DEMO agent — it does not autonomously execute onchain transactions.',
    ownerWallet: demoWallet,
    apiKey: '',
    apiKeyHash: hashApiKey(demoKey),
    supportedCategories: ['Research', 'Science', 'BiologyMedicine'],
    spendingLimits: {
      perTaskMax: '5000000',    // $5.00 USDC
      dailyLimit: '50000000',   // $50.00 USDC
      totalBudget: '500000000', // $500.00 USDC
    },
    totalFundedRaw: '25000000',  // $25 seeded
    totalSpentRaw: '12500000',   // $12.50 spent
    tasksCreated: 5,
    reputation: 92,
    registeredAt: Date.now() - 7 * 24 * 3600 * 1000,
    isDemo: true,
  }
  agents.set(demoId, profile)
  apiKeyHashIndex.set(profile.apiKeyHash, demoId)
  walletIndex.set(demoWallet.toLowerCase(), demoId)
}

seedDemoAgent()

export function registerAgent(data: {
  name: string
  description: string
  ownerWallet: string
  supportedCategories: AgentProfile['supportedCategories']
  spendingLimits: AgentProfile['spendingLimits']
}): { agent: AgentProfile; rawApiKey: string } {
  const rawApiKey = generateApiKey()
  const agentId = generateId()
  const profile: AgentProfile = {
    agentId,
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
  agents.set(agentId, profile)
  apiKeyHashIndex.set(profile.apiKeyHash, agentId)
  walletIndex.set(data.ownerWallet.toLowerCase(), agentId)
  return { agent: { ...profile, apiKey: rawApiKey }, rawApiKey }
}

export function getAgentById(agentId: string): AgentProfile | undefined {
  return agents.get(agentId)
}

export function getAgentByApiKey(rawKey: string): AgentProfile | undefined {
  const hash = hashApiKey(rawKey)
  const agentId = apiKeyHashIndex.get(hash)
  if (!agentId) return undefined
  return agents.get(agentId)
}

export function getAgentByWallet(address: string): AgentProfile | undefined {
  const agentId = walletIndex.get(address.toLowerCase())
  if (!agentId) return undefined
  return agents.get(agentId)
}

export function getAllAgents(): AgentProfile[] {
  return [...agents.values()]
}

export function incrementTasksCreated(agentId: string, rewardRaw: bigint): void {
  const agent = agents.get(agentId)
  if (!agent) return
  agent.tasksCreated++
  agent.totalFundedRaw = String(BigInt(agent.totalFundedRaw) + rewardRaw)
  agents.set(agentId, agent)
}

export function recordSpend(agentId: string, spentRaw: bigint): void {
  const agent = agents.get(agentId)
  if (!agent) return
  agent.totalSpentRaw = String(BigInt(agent.totalSpentRaw) + spentRaw)
  agents.set(agentId, agent)
}

// ─── Daily spend tracking ─────────────────────────────────────────────────────

const dailySpends = new Map<string, DailySpend>()

export function getDailySpent(agentId: string): bigint {
  const key = `${agentId}:${todayUtc()}`
  const entry = dailySpends.get(key)
  return entry ? BigInt(entry.spentRaw) : 0n
}

export function recordDailySpend(agentId: string, spentRaw: bigint): void {
  const key = `${agentId}:${todayUtc()}`
  const existing = dailySpends.get(key)
  dailySpends.set(key, {
    agentId,
    dateUtc: todayUtc(),
    spentRaw: String((existing ? BigInt(existing.spentRaw) : 0n) + spentRaw),
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


// ─── Config ───────────────────────────────────────────────────────────────────

// arc-studio-allow-onchain-literal: deployment constant — Arc Testnet v3 contract
const CONTRACT_ADDRESS = (
  process.env.VITE_HUMANLAYER_ADDRESS ?? '0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2'
) as `0x${string}`

const rpcUrl = arcTestnet.rpcUrls.default.http[0]

const rpcClient: PublicClient = createPublicClient({
  chain: arcTestnet,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
  return rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBounty', args: [BigInt(id)] })
}

async function getBountyCount(): Promise<number> {
  const count = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBountyCount' })
  return Number(count)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSubmissionRaw(id: bigint): Promise<any> {
  return rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getSubmission', args: [id] })
}

async function getBountySubmissionIds(bountyId: bigint): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBountySubmissions', args: [bountyId] })
  return ids as bigint[]
}

async function getWorkerReputation(address: `0x${string}`): Promise<bigint> {
  return rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'workerReputation', args: [address] }) as Promise<bigint>
}

async function getWorkerSubmissionIds(address: `0x${string}`): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getWorkerSubmissions', args: [address] })
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
  if (getAgentByWallet(owner_wallet as string))
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

  const { agent, rawApiKey } = registerAgent({
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
    _warning: 'Store this api_key securely. It will not be shown again. NOTE: this registration is not durable across serverless restarts — see API docs for details.',
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
      contract_address: CONTRACT_ADDRESS,
      chain: 'Arc Testnet',
      chain_id: arcTestnet.id,
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
  const token = extractBearerToken(req.headers.authorization as string | undefined)
  if (!token) return json(res, 401, { error: 'Missing Authorization header. Use: Authorization: Bearer <api_key>' })
  const agent = getAgentByApiKey(token)
  if (!agent) return json(res, 401, { error: 'Invalid API key.' })

  const body = req.body as Record<string, unknown> ?? {}
  const validation = validateBountyPayload(body)
  if (!validation.ok) return json(res, 422, { error: 'Validation failed.', fields: validation.errors })

  const category = body.category as string
  if (!isCategoryAllowed(agent, isValidCategory(category) ? category : 'Research'))
    return json(res, 403, { error: `Your agent is not authorized for category "${category}". Allowed: ${agent.supportedCategories.join(', ')}.`, error_code: 'CATEGORY_NOT_ALLOWED' })

  const rewardRaw = parseUsdcHuman(body.reward_usdc)!
  const workers = parseInt(String(body.required_workers))
  const days = parseInt(String(body.days_until_deadline))

  const spendCheck = checkSpendingLimits(agent, rewardRaw, workers)
  if (!spendCheck.ok) return json(res, 403, { error: spendCheck.error, error_code: spendCheck.errorCode })

  const deadlineUnix = Math.floor(Date.now() / 1000) + days * 86400
  const totalRaw = rewardRaw * BigInt(workers)

  return json(res, 200, {
    _note: 'PRE-FLIGHT VALIDATION. No onchain transaction has been submitted. Your agent wallet must submit the transactions below in order.',
    agent_id: agent.agentId,
    is_demo: agent.isDemo,
    validated: true,
    spending_check: {
      reward_per_worker_usdc: (Number(rewardRaw) / 1e6).toFixed(6),
      total_escrow_usdc: (Number(totalRaw) / 1e6).toFixed(6),
      within_per_task_limit: true,
      within_daily_limit: true,
      within_total_budget: true,
    },
    onchain_steps: [
      {
        step: 1, action: 'createBounty', contract: CONTRACT_ADDRESS,
        function: 'createBounty(uint8,bytes32,uint256,uint256,uint64)',
        args: {
          category: VALID_CATEGORIES_ONCHAIN.indexOf(category),
          taskRef: '0x<keccak256_of_task_description>',
          rewardPerWorker: rewardRaw.toString(),
          requiredWorkers: workers,
          deadline: deadlineUnix,
        },
        note: 'Emits BountyCreated. Parse bountyId from event logs.',
      },
      {
        step: 2, action: 'approveUSDC',
        contract: '0x3600000000000000000000000000000000000000',
        function: 'approve(address,uint256)',
        args: { spender: CONTRACT_ADDRESS, amount: totalRaw.toString() },
        note: 'Approve HumanLayer contract to transfer USDC escrow.',
      },
      {
        step: 3, action: 'fundBounty', contract: CONTRACT_ADDRESS,
        function: 'fundBounty(uint256)',
        args: { bountyId: '<bountyId from step 1 event>' },
        note: 'Transfers totalRaw USDC into escrow. Bounty becomes OPEN.',
      },
    ],
    bounty_preview: {
      title: body.title,
      category,
      task_type: body.task_type,
      reward_per_worker_usdc: (Number(rewardRaw) / 1e6).toFixed(6),
      required_workers: workers,
      deadline_iso: new Date(deadlineUnix * 1000).toISOString(),
      total_escrow_usdc: (Number(totalRaw) / 1e6).toFixed(6),
    },
  })
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
      action: 'submitWork', contract: CONTRACT_ADDRESS,
      function: 'submitWork(uint256,bytes32)',
      args: { bountyId: idNum, answerRef: answer_ref },
      signer: 'Must be signed by worker_address wallet.',
      note: 'Emits WorkSubmitted(bountyId, submissionId, worker). Parse submissionId from event logs.',
    },
  })
}

function handleGetAgent(res: VercelResponse, agentId: string) {
  const agent = getAgentById(agentId)
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
  const agent = getAgentById(agentId)
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
  const agent = getAgentById(agentId)
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
  const method = req.method?.toUpperCase() ?? 'GET'

  // CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
    return json(res, 200, {
      status: 'ok',
      service: 'HumanLayer Agent API',
      version: '1.0.0',
      chain: 'Arc Testnet',
      contract_address: CONTRACT_ADDRESS,
      note: 'In-memory store — agent registrations are not durable across cold starts.',
    })
  }

  if (parts[0] !== 'api') {
    return json(res, 404, { error: 'Not found. All endpoints are under /api/*' })
  }

  // POST /api/agents/register
  if (method === 'POST' && parts[1] === 'agents' && parts[2] === 'register')
    return handleRegister(req, res)

  // GET /api/agents/workers
  if (method === 'GET' && parts[1] === 'agents' && parts[2] === 'workers')
    return handleDiscoverWorkers(req, res)

  // GET /api/agents/:id
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && !parts[3])
    return handleGetAgent(res, parts[2])

  // GET /api/agents/:id/reputation
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'reputation')
    return handleGetAgentReputation(res, parts[2])

  // GET /api/agents/:id/activity
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'activity')
    return handleGetAgentActivity(res, parts[2])

  // GET /api/bounties
  if (method === 'GET' && parts[1] === 'bounties' && !parts[2])
    return handleListBounties(req, res)

  // POST /api/bounties
  if (method === 'POST' && parts[1] === 'bounties' && !parts[2])
    return handleCreateBountyIntent(req, res)

  // GET /api/bounties/:id
  if (method === 'GET' && parts[1] === 'bounties' && parts[2] && !parts[3])
    return handleGetBounty(req, res, parts[2])

  // GET /api/bounties/:id/submissions
  if (method === 'GET' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submissions')
    return handleGetSubmissions(req, res, parts[2])

  // POST /api/bounties/:id/submit
  if (method === 'POST' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submit')
    return handleSubmitWork(req, res, parts[2])

  // GET /api/workers/:address
  if (method === 'GET' && parts[1] === 'workers' && parts[2])
    return handleGetWorkerProfile(res, parts[2])

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
      'GET  /api/bounties/:id',
      'GET  /api/bounties/:id/submissions',
      'POST /api/bounties/:id/submit',
      'GET  /api/workers/:address',
    ],
  })
}
