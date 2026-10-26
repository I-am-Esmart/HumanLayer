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

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, type PublicClient } from 'viem'
import { arcTestnet } from 'viem/chains'
import {
  getAgentById,
  getAgentByApiKey,
  getAgentByWallet,
  registerAgent,
  getWorkers,
  getWorkerByAddress,
} from '../server/store.js'
import {
  extractBearerToken,
  parseUsdcHuman,
  checkSpendingLimits,
  validateBountyPayload,
  isValidCategory,
  isCategoryAllowed,
  isValidAddress,
} from '../server/validate.js'
import type { AgentBountyFormat, AgentSubmissionFormat } from '../server/types.js'
import ABI from '../src/lib/humanlayer-abi.json'

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
const VALID_CATEGORIES = ['Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']

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
          category: VALID_CATEGORIES.indexOf(category),
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
