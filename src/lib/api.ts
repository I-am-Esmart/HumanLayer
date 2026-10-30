/**
 * Client-side API helper for the HumanLayer Agent API.
 * All calls go through the Vite proxy at /api/*.
 */
import { ARC_CHAIN_ID, ARC_CHAIN_NAME } from './contract'

export interface AgentBountyFormat {
  id: string
  onchain_id: number
  category: string
  task_type: string
  title: string
  description: string
  instructions: string
  reward_usdc: string
  reward_raw: string
  required_workers: number
  accepted_workers: number
  deadline_iso: string
  deadline_unix: number
  required_reputation: number
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
  creator_address: string
  task_ref: string
  total_funded_usdc: string
  tags: string[]
  difficulty: string
  estimated_minutes: number
}

export interface AgentSubmissionFormat {
  submission_id: string
  bounty_id: string
  worker_address: string
  answer_ref: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISPUTED'
  reward_claimed: boolean
  submitted_at_iso: string
  submitted_at_unix: number
}

export interface WorkerRecord {
  address: string
  reputation: number
  category_reputations: Record<string, number>
  completed_tasks: number
  dispute_rate: number
  avg_completion_time_min: number
  last_active_iso: string
  is_available: boolean
  onchain_approved_submissions?: number
  total_submissions?: number
}

export interface AgentRecord {
  agent_id: string
  name: string
  description: string
  owner_wallet: string
  supported_categories: string[]
  tasks_created: number
  reputation: number
  is_demo: boolean
  registered_at: string
  spending_summary: {
    total_funded_usdc: string
    total_spent_usdc: string
    budget_usdc: string
    remaining_budget_usdc: string
  }
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  const apiChainId = res.headers.get('X-HumanLayer-Chain-ID')
  if (apiChainId === null || Number(apiChainId) !== ARC_CHAIN_ID) {
    throw new Error(
      apiChainId === null
        ? `API did not identify its Arc chain. Expected ${ARC_CHAIN_NAME} (${ARC_CHAIN_ID}).`
        : `API is configured for Arc chain ${apiChainId}; this app expects ${ARC_CHAIN_NAME} (${ARC_CHAIN_ID}).`,
    )
  }
  const data = await res.json() as T
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? 'API error'), { status: res.status, data })
  return data
}

export const api = {
  bounties: {
    list: (params?: { status?: string; category?: string; creator?: string; limit?: number }) => {
      const q = new URLSearchParams()
      if (params?.status) q.set('status', params.status)
      if (params?.category) q.set('category', params.category)
      if (params?.creator) q.set('creator', params.creator)
      if (params?.limit) q.set('limit', String(params.limit))
      return apiFetch<{ total: number; bounties: AgentBountyFormat[]; chain: string; chain_id: number; contract_address: string }>(`/api/bounties?${q}`)
    },
    get: (id: number) => apiFetch<AgentBountyFormat>(`/api/bounties/${id}`),
    submissions: (id: number) => apiFetch<{ total: number; submissions: AgentSubmissionFormat[] }>(`/api/bounties/${id}/submissions`),
    createIntent: (apiKey: string, body: Record<string, unknown>, idempotencyKey = crypto.randomUUID()) =>
      apiFetch<Record<string, unknown>>('/api/bounties', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      }),
    confirmReservation: (apiKey: string, reservationId: string, body: { tx_hash: string; bounty_id: string | number }) =>
      apiFetch<Record<string, unknown>>(`/api/bounties/reservations/${encodeURIComponent(reservationId)}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }),
    releaseReservation: (apiKey: string, reservationId: string, body: { tx_hash: string }) =>
      apiFetch<Record<string, unknown>>(`/api/bounties/reservations/${encodeURIComponent(reservationId)}/release`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }),
    submitWork: (bountyId: number, body: { worker_address: string; answer_ref: string }) =>
      apiFetch<Record<string, unknown>>(`/api/bounties/${bountyId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  agents: {
    register: (body: Record<string, unknown>) =>
      apiFetch<{ agent_id: string; api_key: string; name: string }>('/api/agents/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (id: string) => apiFetch<AgentRecord>(`/api/agents/${id}`),
    reputation: (id: string) => apiFetch<Record<string, unknown>>(`/api/agents/${id}/reputation`),
    activity: (id: string) => apiFetch<Record<string, unknown>>(`/api/agents/${id}/activity`),
    workers: (params?: { category?: string; min_reputation?: number; max_dispute_rate?: number; available_only?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.category) q.set('category', params.category)
      if (params?.min_reputation !== undefined) q.set('min_reputation', String(params.min_reputation))
      if (params?.max_dispute_rate !== undefined) q.set('max_dispute_rate', String(params.max_dispute_rate))
      if (params?.available_only !== undefined) q.set('available_only', String(params.available_only))
      return apiFetch<{ total: number; workers: WorkerRecord[] }>(`/api/agents/workers?${q}`)
    },
  },

  workers: {
    get: (address: string) => apiFetch<WorkerRecord>(`/api/workers/${address}`),
  },

  health: () => apiFetch<{
    status: string
    service: string
    chain: string
    chain_id: number
    contract_address: string | null
    contract_configured: boolean
  }>('/health'),
}

export const DEMO_AGENT_ID = 'demo-research-agent-001'
export const DEMO_API_KEY = 'hl_demo_research_agent_key_not_for_production'
