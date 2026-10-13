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
