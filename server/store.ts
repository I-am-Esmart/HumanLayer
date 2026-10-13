/**
 * In-memory store for agent registrations, spending tracking, and
 * worker discovery data. Survives for the lifetime of the server process.
 *
 * In production this would be a database. For this demo the store is
 * seeded with a Research Agent and representative worker profiles.
 */

import { createHash, randomBytes } from 'crypto'
import type { AgentProfile, DailySpend, WorkerDiscoveryRecord } from './types'

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
