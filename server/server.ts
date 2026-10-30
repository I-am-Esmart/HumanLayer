/**
 * HumanLayer Agent API server.
 *
 * Architecture notes:
 * - This server handles OFFCHAIN concerns: agent identity, registration, spending
 *   enforcement, discovery, and a machine-readable view of onchain state.
 * - ALL financial operations (escrow, transfers, approvals) MUST be executed
 *   onchain by the caller's own wallet. The API never holds keys, signs
 *   transactions, or moves funds.
 * - Authentication uses a bearer API key issued on registration. The key hash
 *   is stored; the plaintext is returned once and never stored.
 * - Onchain state is read from the contract via public RPC.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createPublicClient, getAddress, http, isAddress, type Address, type PublicClient } from 'viem'
import { arcMainnet, arcTestnet, getArcChain } from '../src/lib/arc-chain'
import { ARC_TESTNET_HUMANLAYER_ADDRESS } from '../src/lib/contract-addresses'
import { getUsdc } from '../src/onchain-facts'
import {
  getAgentById,
  getAgentByApiKey,
  getAgentByWallet,
  registerAgent,
  incrementTasksCreated,
  getWorkers,
  getWorkerByAddress,
} from './store'
import {
  extractBearerToken,
  parseUsdcHuman,
  checkSpendingLimits,
  validateBountyPayload,
  isValidCategory,
  isCategoryAllowed,
  isValidAddress,
} from './validate'
import type { AgentBountyFormat, AgentSubmissionFormat } from './types'

// ─── RPC client ───────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = Number(process.env.VITE_ARC_CHAIN_ID ?? arcTestnet.id)
const ARC_CHAIN = getArcChain(ARC_CHAIN_ID)
const ARC_USDC = getUsdc(ARC_CHAIN_ID)
if (!ARC_USDC) throw new Error(`USDC is not configured for Arc chain ${ARC_CHAIN_ID}.`)

const rpcUrl = (() => {
  const base = process.env.RPC_PROXY_BASE_URL
  const token = process.env.RPC_PROXY_TOKEN
  const chains = (process.env.RPC_PROXY_CHAINS || '').split(',').map((s) => s.trim())
  if (ARC_CHAIN_ID === arcTestnet.id && base && token && chains.includes('Arc_Testnet')) {
    return `${base}/api/rpc/Arc_Testnet?_rpc_token=${token}`
  }
  return ARC_CHAIN.rpcUrls.default.http[0]
})()

const rpcClient: PublicClient = createPublicClient({ chain: ARC_CHAIN, transport: http(rpcUrl) })

// ─── Contract ABI (minimal — only what the API needs) ────────────────────────

import contractArtifact from '../contracts/out/HumanLayer.sol/HumanLayer.json' with { type: 'json' }

const contractAddressRaw = ARC_CHAIN_ID === arcMainnet.id
  ? process.env.VITE_HUMANLAYER_MAINNET_ADDRESS
  : process.env.VITE_HUMANLAYER_TESTNET_ADDRESS
    ?? process.env.VITE_HUMANLAYER_ADDRESS
    ?? ARC_TESTNET_HUMANLAYER_ADDRESS
const isTestnetContractOnMainnet =
  ARC_CHAIN_ID === arcMainnet.id &&
  contractAddressRaw?.toLowerCase() === ARC_TESTNET_HUMANLAYER_ADDRESS.toLowerCase()
if (!contractAddressRaw || !isAddress(contractAddressRaw) || isTestnetContractOnMainnet) {
  throw new Error(`A valid HumanLayer contract address must be configured for ${ARC_CHAIN.name}.`)
}
const CONTRACT_ADDRESS: Address = getAddress(contractAddressRaw)

const ABI = contractArtifact.abi

// ─── Onchain read helpers ─────────────────────────────────────────────────────

const BOUNTY_STATUS_MAP = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED'] as const
const SUBMISSION_STATUS_MAP = ['PENDING', 'APPROVED', 'REJECTED', 'DISPUTED'] as const
const CATEGORY_FROM_INDEX = ['Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']
const TASK_TYPE_MAP: Record<string, string> = {
  Verify: 'Verify', Classify: 'Classify', Label: 'Label',
  Compare: 'Compare', Research: 'Research', Rate: 'Rate', Transcribe: 'Transcribe',
}

async function getBountyCount(): Promise<number> {
  const count = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBountyCount' })
  return Number(count)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBountyRaw(id: number): Promise<any> {
  return rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBounty', args: [BigInt(id)] })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSubmissionRaw(id: bigint): Promise<any> {
  return rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getSubmission', args: [id] })
}

async function getBountySubmissionIds(bountyId: bigint): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getBountySubmissions', args: [bountyId] })
  return ids as bigint[]
}

async function getWorkerSubmissionIds(address: `0x${string}`): Promise<bigint[]> {
  const ids = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'getWorkerSubmissions', args: [address] })
  return ids as bigint[]
}

async function getWorkerReputation(address: `0x${string}`): Promise<bigint> {
  const rep = await rpcClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: 'workerReputation', args: [address] })
  return rep as bigint
}

// ─── Formatters ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatBounty(raw: any, metaOverride?: Partial<AgentBountyFormat>): AgentBountyFormat {
  const rewardRaw = BigInt(raw.rewardPerWorker ?? 0n)
  const totalFundedRaw = BigInt(raw.totalFunded ?? 0n)
  const statusIdx = Number(raw.status ?? 0)
  const catIdx = Number(raw.category ?? 0)
  return {
    id: `bounty-${raw.bountyId}`,
    onchain_id: Number(raw.bountyId),
    category: CATEGORY_FROM_INDEX[catIdx] ?? 'Research',
    task_type: metaOverride?.task_type ?? 'Verify',
    title: metaOverride?.title ?? `Bounty #${raw.bountyId}`,
    description: metaOverride?.description ?? '',
    instructions: metaOverride?.instructions ?? '',
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
    tags: metaOverride?.tags ?? [],
    difficulty: metaOverride?.difficulty ?? 'Medium',
    estimated_minutes: metaOverride?.estimated_minutes ?? 30,
    ...metaOverride,
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

// ─── Rate limiting (in-memory, per IP) ───────────────────────────────────────

const RATE_WINDOW_MS = 60_000 // 1 minute window
const RATE_LIMIT_GENERAL = 120  // requests per window for GET/public
const RATE_LIMIT_WRITE = 20    // requests per window for POST (mutations)

interface RateBucket { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>()

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return String(forwarded).split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

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

// Periodically evict expired buckets to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt < now) rateBuckets.delete(key)
  }
}, RATE_WINDOW_MS * 2)

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-HumanLayer-Chain-ID',
    'X-HumanLayer-Chain-ID': String(ARC_CHAIN_ID),
  })
  res.end(payload)
}

const MAX_BODY_BYTES = 32_768 // 32 KB hard cap

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Request body too large (max 32 KB).'))
        return
      }
      raw += chunk.toString()
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {}) }
      catch { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

function getQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '')
}

function pathParts(url: string): string[] {
  return url.split('?')[0].split('/').filter(Boolean)
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: IncomingMessage, res: ServerResponse) {
  const token = extractBearerToken(req.headers.authorization)
  if (!token) {
    json(res, 401, { error: 'Missing Authorization header. Use: Authorization: Bearer <api_key>' })
    return null
  }
  const agent = getAgentByApiKey(token)
  if (!agent) {
    json(res, 401, { error: 'Invalid API key.' })
    return null
  }
  return agent
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleRegister(req: IncomingMessage, res: ServerResponse) {
  let body: Record<string, unknown>
  try { body = await parseBody(req) }
  catch { return json(res, 400, { error: 'Invalid JSON body.' }) }

  const { name, description, owner_wallet, supported_categories, spending_limits } = body

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return json(res, 400, { error: 'name must be at least 2 characters.' })
  }
  if (!isValidAddress(owner_wallet)) {
    return json(res, 400, { error: 'owner_wallet must be a valid EVM address (0x...).' })
  }

  // Check wallet not already registered
  const existing = getAgentByWallet(owner_wallet as string)
  if (existing) {
    return json(res, 409, { error: 'This wallet address is already registered as an agent.' })
  }

  const cats = Array.isArray(supported_categories) ? supported_categories : ['Research']
  const invalidCats = cats.filter((c) => !isValidCategory(c))
  if (invalidCats.length > 0) {
    return json(res, 400, { error: `Invalid categories: ${invalidCats.join(', ')}. Valid values: Science, Software, Research, ImageData, Language, BiologyMedicine.` })
  }

  const limits = (spending_limits && typeof spending_limits === 'object')
    ? spending_limits as Record<string, unknown>
    : {}

  const spendingLimits = {
    perTaskMax: String(limits.per_task_max ?? '10000000'),   // default $10
    dailyLimit: String(limits.daily_limit ?? '100000000'),   // default $100
    totalBudget: String(limits.total_budget ?? '1000000000'), // default $1000
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
    _warning: 'Store this api_key securely. It will not be shown again.',
    supported_categories: agent.supportedCategories,
    spending_limits: {
      per_task_max_usdc: (Number(BigInt(spendingLimits.perTaskMax)) / 1e6).toFixed(2),
      daily_limit_usdc: (Number(BigInt(spendingLimits.dailyLimit)) / 1e6).toFixed(2),
      total_budget_usdc: (Number(BigInt(spendingLimits.totalBudget)) / 1e6).toFixed(2),
    },
    registered_at: new Date(agent.registeredAt).toISOString(),
  })
}

async function handleListBounties(req: IncomingMessage, res: ServerResponse) {
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

    if (statusFilter) {
      formatted = formatted.filter((b) => b.status === statusFilter)
    }
    if (categoryFilter) {
      formatted = formatted.filter((b) => b.category.toLowerCase() === categoryFilter.toLowerCase())
    }
    if (creatorFilter) {
      formatted = formatted.filter((b) => b.creator_address.toLowerCase() === creatorFilter)
    }

    const results = formatted.slice(0, limit)

    return json(res, 200, {
      total: results.length,
      contract_address: CONTRACT_ADDRESS,
      chain: ARC_CHAIN.name,
      chain_id: ARC_CHAIN_ID,
      bounties: results,
    })
  } catch (err) {
    console.error('GET /api/bounties error:', err)
    return json(res, 502, { error: 'Failed to read bounties from chain. RPC may be unavailable.' })
  }
}

async function handleGetBounty(res: ServerResponse, id: string) {
  const idNum = parseInt(id)
  if (isNaN(idNum) || idNum < 1) {
    return json(res, 400, { error: 'Bounty ID must be a positive integer.' })
  }
  try {
    const raw = await getBountyRaw(idNum)
    if (!raw || raw.bountyId === 0n) {
      return json(res, 404, { error: `Bounty #${idNum} not found.` })
    }
    return json(res, 200, formatBounty(raw))
  } catch (err) {
    console.error(`GET /api/bounties/${id} error:`, err)
    return json(res, 502, { error: 'Failed to read bounty from chain.' })
  }
}

async function handleCreateBountyIntent(req: IncomingMessage, res: ServerResponse) {
  const agent = requireAuth(req, res)
  if (!agent) return

  let body: Record<string, unknown>
  try { body = await parseBody(req) }
  catch { return json(res, 400, { error: 'Invalid JSON body.' }) }

  // Validate fields
  const validation = validateBountyPayload(body)
  if (!validation.ok) {
    return json(res, 422, { error: 'Validation failed.', fields: validation.errors })
  }

  const category = body.category as string
  if (!isCategoryAllowed(agent, isValidCategory(category) ? category : 'Research')) {
    return json(res, 403, {
      error: `Your agent is not authorized for category "${category}". Allowed: ${agent.supportedCategories.join(', ')}.`,
      error_code: 'CATEGORY_NOT_ALLOWED',
    })
  }

  const rewardRaw = parseUsdcHuman(body.reward_usdc)!
  const workers = parseInt(String(body.required_workers))
  const days = parseInt(String(body.days_until_deadline))

  // Spending limit check
  const spendCheck = checkSpendingLimits(agent, rewardRaw, workers)
  if (!spendCheck.ok) {
    return json(res, 403, { error: spendCheck.error, error_code: spendCheck.errorCode })
  }

  // Build the unsigned transaction intent — the agent's wallet must submit this
  const deadlineUnix = Math.floor(Date.now() / 1000) + days * 86400
  const totalRaw = rewardRaw * BigInt(workers)

  return json(res, 200, {
    _note: 'This is a PRE-FLIGHT VALIDATION response. No onchain transaction has been submitted. Your agent wallet must submit the transactions below in order.',
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
        step: 1,
        action: 'createBounty',
        contract: CONTRACT_ADDRESS,
        function: 'createBounty(uint8,bytes32,uint256,uint256,uint64)',
        args: {
          category: ['Science','Software','Research','ImageData','Language','BiologyMedicine'].indexOf(category),
          taskRef: '0x<keccak256_of_title_and_creator>',
          rewardPerWorker: rewardRaw.toString(),
          requiredWorkers: workers,
          deadline: deadlineUnix,
        },
        note: 'Emits BountyCreated event. Parse bountyId from the event logs.',
      },
      {
        step: 2,
        action: 'approveUSDC',
        contract: ARC_USDC.address,
        function: 'approve(address,uint256)',
        args: { spender: CONTRACT_ADDRESS, amount: totalRaw.toString() },
        note: 'Approve the HumanLayer contract to transfer USDC escrow.',
      },
      {
        step: 3,
        action: 'fundBounty',
        contract: CONTRACT_ADDRESS,
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

async function handleGetSubmissions(res: ServerResponse, bountyId: string) {
  const idNum = parseInt(bountyId)
  if (isNaN(idNum) || idNum < 1) {
    return json(res, 400, { error: 'Bounty ID must be a positive integer.' })
  }
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

async function handleSubmitWork(req: IncomingMessage, res: ServerResponse, bountyId: string) {
  let body: Record<string, unknown>
  try { body = await parseBody(req) }
  catch { return json(res, 400, { error: 'Invalid JSON body.' }) }

  const idNum = parseInt(bountyId)
  if (isNaN(idNum) || idNum < 1) return json(res, 400, { error: 'Invalid bounty ID.' })

  const { worker_address, answer_ref } = body
  if (!isValidAddress(worker_address)) {
    return json(res, 400, { error: 'worker_address must be a valid EVM address.' })
  }
  if (!answer_ref || typeof answer_ref !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(answer_ref)) {
    return json(res, 400, { error: 'answer_ref must be a bytes32 hex string (0x + 64 hex chars). Compute keccak256(worker_address + ":" + answer_text).' })
  }

  return json(res, 200, {
    _note: 'PRE-FLIGHT VALIDATION. Submit the transaction below from the worker wallet.',
    validated: true,
    onchain_step: {
      action: 'submitWork',
      contract: CONTRACT_ADDRESS,
      function: 'submitWork(uint256,bytes32)',
      args: { bountyId: idNum, answerRef: answer_ref },
      signer: 'Must be signed by worker_address wallet.',
      note: 'Emits WorkSubmitted(bountyId, submissionId, worker). Parse submissionId from event logs.',
    },
  })
}

function handleGetAgent(res: ServerResponse, agentId: string) {
  const agent = getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })

  return json(res, 200, {
    agent_id: agent.agentId,
    name: agent.name,
    description: agent.description,
    owner_wallet: agent.ownerWallet,
    supported_categories: agent.supportedCategories,
    tasks_created: agent.tasksCreated,
    reputation: agent.reputation,
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

async function handleGetAgentReputation(res: ServerResponse, agentId: string) {
  const agent = getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })

  const onchainRep = agent.ownerWallet !== '0x0000000000000000000000000000000000000001'
    ? await getWorkerReputation(agent.ownerWallet as `0x${string}`).catch(() => 0n)
    : 0n

  return json(res, 200, {
    agent_id: agent.agentId,
    platform_reputation: agent.reputation,
    onchain_approved_submissions: Number(onchainRep),
    tasks_created: agent.tasksCreated,
    total_funded_usdc: (Number(BigInt(agent.totalFundedRaw)) / 1e6).toFixed(2),
  })
}

async function handleGetAgentActivity(res: ServerResponse, agentId: string) {
  const agent = getAgentById(agentId)
  if (!agent) return json(res, 404, { error: `Agent "${agentId}" not found.` })

  // If the agent wallet is a real address, read their bounties from the contract
  let bounties: AgentBountyFormat[] = []
  // arc-studio-allow-onchain-literal: demo wallet sentinel
  if (agent.ownerWallet !== '0x0000000000000000000000000000000000000001') {
    try {
      const count = await getBountyCount()
      const ids = Array.from({ length: count }, (_, i) => i + 1)
      const raws = await Promise.all(ids.map((id) => getBountyRaw(id)))
      bounties = raws
        .filter((b) => b && b.creator?.toLowerCase() === agent.ownerWallet.toLowerCase())
        .map((b) => formatBounty(b))
    } catch { /* rpc failure — return empty */ }
  }

  return json(res, 200, {
    agent_id: agent.agentId,
    owner_wallet: agent.ownerWallet,
    tasks_created: agent.tasksCreated,
    total_funded_usdc: (Number(BigInt(agent.totalFundedRaw)) / 1e6).toFixed(2),
    total_spent_usdc: (Number(BigInt(agent.totalSpentRaw)) / 1e6).toFixed(2),
    onchain_bounties_count: bounties.length,
    onchain_bounties: bounties,
    is_demo: agent.isDemo,
  })
}

function handleDiscoverWorkers(req: IncomingMessage, res: ServerResponse) {
  const q = getQuery(req.url ?? '')
  const category = q.get('category') ?? undefined
  const minRep = q.get('min_reputation') ? parseInt(q.get('min_reputation')!) : undefined
  const maxDispute = q.get('max_dispute_rate') ? parseFloat(q.get('max_dispute_rate')!) : undefined
  const availOnly = q.get('available_only') !== 'false'

  const workers = getWorkers({
    category: category ?? undefined,
    minReputation: minRep,
    maxDisputeRate: maxDispute,
    availableOnly: availOnly,
  })

  return json(res, 200, {
    total: workers.length,
    filters_applied: { category, min_reputation: minRep, max_dispute_rate: maxDispute, available_only: availOnly },
    workers,
  })
}

async function handleGetWorkerProfile(res: ServerResponse, address: string) {
  if (!isValidAddress(address)) {
    return json(res, 400, { error: 'Invalid EVM address.' })
  }

  const seeded = getWorkerByAddress(address)

  let onchainRep = 0n
  try {
    onchainRep = await getWorkerReputation(address as `0x${string}`)
  } catch { /* rpc unavailable */ }

  let submissionCount = 0
  try {
    const ids = await getWorkerSubmissionIds(address as `0x${string}`)
    submissionCount = ids.length
  } catch { /* rpc unavailable */ }

  const profile = seeded ?? {
    address,
    reputation: Number(onchainRep),
    category_reputations: {},
    completed_tasks: submissionCount,
    dispute_rate: 0,
    avg_completion_time_min: 0,
    last_active_iso: new Date().toISOString(),
    is_available: true,
  }

  return json(res, 200, {
    ...profile,
    onchain_approved_submissions: Number(onchainRep),
    total_submissions: submissionCount,
  })
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function router(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase() ?? 'GET'
  const parts = pathParts(req.url ?? '')

  // CORS preflight (no rate limit)
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'X-HumanLayer-Chain-ID',
      'X-HumanLayer-Chain-ID': String(ARC_CHAIN_ID),
    })
    return res.end()
  }

  // Rate limiting
  const ip = getClientIp(req)
  const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE'
  if (!checkRateLimit(ip, isWrite)) {
    return json(res, 429, {
      error: 'Too many requests. Please slow down.',
      error_code: 'RATE_LIMITED',
      retry_after_seconds: Math.ceil(RATE_WINDOW_MS / 1000),
    })
  }

  // Health
  if (parts[0] === 'health') {
    return json(res, 200, { status: 'ok', service: 'HumanLayer Agent API', version: '1.0.0' })
  }

  if (parts[0] !== 'api') {
    return json(res, 404, { error: 'Not found. All endpoints are under /api/*' })
  }

  // POST /api/agents/register
  if (method === 'POST' && parts[1] === 'agents' && parts[2] === 'register') {
    return handleRegister(req, res)
  }

  // GET /api/agents/workers
  if (method === 'GET' && parts[1] === 'agents' && parts[2] === 'workers') {
    return handleDiscoverWorkers(req, res)
  }

  // GET /api/agents/:id
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && !parts[3]) {
    return handleGetAgent(res, parts[2])
  }

  // GET /api/agents/:id/reputation
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'reputation') {
    return handleGetAgentReputation(res, parts[2])
  }

  // GET /api/agents/:id/activity
  if (method === 'GET' && parts[1] === 'agents' && parts[2] && parts[3] === 'activity') {
    return handleGetAgentActivity(res, parts[2])
  }

  // GET /api/bounties
  if (method === 'GET' && parts[1] === 'bounties' && !parts[2]) {
    return handleListBounties(req, res)
  }

  // POST /api/bounties
  if (method === 'POST' && parts[1] === 'bounties' && !parts[2]) {
    return handleCreateBountyIntent(req, res)
  }

  // GET /api/bounties/:id
  if (method === 'GET' && parts[1] === 'bounties' && parts[2] && !parts[3]) {
    return handleGetBounty(res, parts[2])
  }

  // GET /api/bounties/:id/submissions
  if (method === 'GET' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submissions') {
    return handleGetSubmissions(res, parts[2])
  }

  // POST /api/bounties/:id/submit
  if (method === 'POST' && parts[1] === 'bounties' && parts[2] && parts[3] === 'submit') {
    return handleSubmitWork(req, res, parts[2])
  }

  // GET /api/workers/:address
  if (method === 'GET' && parts[1] === 'workers' && parts[2]) {
    return handleGetWorkerProfile(res, parts[2])
  }

  return json(res, 404, { error: 'Endpoint not found.', available_endpoints: [
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
  ]})
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT ?? '3001')
const server = createServer((req, res) => {
  router(req, res).catch((err: unknown) => {
    console.error('Unhandled route error:', err)
    try { json(res, 500, { error: 'Internal server error.' }) } catch { /* already responded */ }
  })
})

server.listen(PORT, () => {
  console.log(`HumanLayer Agent API listening on http://localhost:${PORT}`)
  console.log(`  Contract: ${CONTRACT_ADDRESS} (${ARC_CHAIN.name})`)
  console.log(`  RPC: ${rpcUrl.replace(/\?.*/, '?[token]')}`)
})
