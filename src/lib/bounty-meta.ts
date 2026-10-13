/**
 * Offchain task metadata store.
 * 
 * The onchain contract stores only hashes (taskRef) and economic state.
 * This module maps taskRef bytes32 values to rich display metadata.
 * 
 * For demo bounties, taskRef is derived from the demo seed slug.
 * For user-created bounties, metadata is stored in sessionStorage keyed by taskRef.
 * In a production system this would be an IPFS or offchain API lookup.
 */

import type { TaskCategory, TaskType, DifficultyLevel } from '../types'
import { DEMO_BOUNTIES } from './demo-data'
import { toHex, keccak256, stringToBytes } from 'viem'

export interface BountyMeta {
  title: string
  description: string
  instructions: string
  taskType: TaskType
  difficulty: DifficultyLevel
  estimatedMinutes: number
  tags: string[]
  isDemoContent: boolean
}

const DEFAULT_META: BountyMeta = {
  title: 'Onchain Task',
  description: 'A real bounty posted onchain. Task metadata is stored offchain.',
  instructions: 'The bounty creator has not provided a metadata reference for this task. Contact them directly.',
  taskType: 'Verify',
  difficulty: 'Medium',
  estimatedMinutes: 30,
  tags: [],
  isDemoContent: false,
}

// Build lookup from demo taskRef (string) → metadata
const DEMO_META_MAP = new Map<string, BountyMeta>()
for (const b of DEMO_BOUNTIES) {
  // normalize: lowercase, no spaces
  const refHex = taskRefToHex(b.taskRef)
  DEMO_META_MAP.set(refHex.toLowerCase(), {
    title: b.title,
    description: b.description,
    instructions: b.instructions,
    taskType: b.taskType,
    difficulty: b.difficulty,
    estimatedMinutes: b.estimatedMinutes,
    tags: b.tags,
    isDemoContent: true,
  })
}

/** Convert a raw demo taskRef string to a bytes32 hex for lookup */
export function taskRefToHex(taskRef: string): string {
  // If it's already 0x + 64 hex chars, return as-is
  if (/^0x[0-9a-fA-F]{64}$/.test(taskRef)) return taskRef.toLowerCase()
  // Hash short strings to bytes32
  return keccak256(stringToBytes(taskRef)).toLowerCase()
}

/** Bytes32 → human-readable shortRef for display */
export function shortTaskRef(hex: string): string {
  if (!hex || hex.length < 10) return hex
  return hex.slice(0, 10) + '…'
}

/** Get metadata for a given bytes32 taskRef from the contract */
export function getBountyMeta(taskRefHex: string): BountyMeta {
  const key = taskRefHex.toLowerCase()

  // 1. Demo map
  if (DEMO_META_MAP.has(key)) return DEMO_META_MAP.get(key)!

  // 2. Session storage (user-created bounties in this session)
  try {
    const stored = sessionStorage.getItem(`hl:meta:${key}`)
    if (stored) return { ...DEFAULT_META, ...JSON.parse(stored) as Partial<BountyMeta>, isDemoContent: false }
  } catch { /* ignore */ }

  return DEFAULT_META
}

/** Store metadata for a newly created bounty (session lifetime) */
export function storeBountyMeta(taskRefHex: string, meta: Partial<BountyMeta>): void {
  try {
    sessionStorage.setItem(`hl:meta:${taskRefHex.toLowerCase()}`, JSON.stringify(meta))
  } catch { /* ignore */ }
}

/** Store a submission answer offchain (session lifetime) */
export function storeSubmissionAnswer(
  submissionId: string,
  bountyId: string,
  worker: string,
  answer: string,
  answerRefHex: string
): void {
  try {
    const key = `hl:answer:${submissionId}`
    sessionStorage.setItem(key, JSON.stringify({ submissionId, bountyId, worker, answer, answerRefHex, storedAt: Date.now() }))
  } catch { /* ignore */ }
}

/** Get a stored submission answer */
export function getSubmissionAnswer(submissionId: string): string | null {
  try {
    const raw = sessionStorage.getItem(`hl:answer:${submissionId}`)
    if (!raw) return null
    return (JSON.parse(raw) as { answer: string }).answer
  } catch { return null }
}

/** Derive a bytes32 answer reference from answer text (keccak256) */
export function answerToRef(answer: string, worker: string): `0x${string}` {
  return keccak256(stringToBytes(`${worker}:${answer}`))
}

/** Build a taskRef bytes32 from form data */
export function buildTaskRef(title: string, creator: string): `0x${string}` {
  const slug = `${creator}:${title}:${Date.now()}`
  return keccak256(stringToBytes(slug))
}

// Re-export CATEGORY_INDEX for use in contract calls
export const CATEGORY_INDEX: Record<TaskCategory, number> = {
  Science: 0,
  Software: 1,
  Research: 2,
  ImageData: 3,
  Language: 4,
  BiologyMedicine: 5,
}

export const CATEGORY_FROM_INDEX: TaskCategory[] = [
  'Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine'
]

/** Convert USDC human-readable (e.g. "10.50") to raw bigint (6 decimals) */
export function parseUsdcAmount(humanReadable: string | number): bigint {
  const num = typeof humanReadable === 'string' ? parseFloat(humanReadable) : humanReadable
  if (isNaN(num) || num < 0) return 0n
  // Multiply by 1e6, round to avoid floating-point issues
  return BigInt(Math.round(num * 1_000_000))
}

/** Convert raw bigint (6 decimals) to human-readable USDC */
export function formatUsdcAmount(raw: bigint): number {
  return Number(raw) / 1_000_000
}

/** Format raw bigint USDC to 2dp string */
export function formatUsdcRaw(raw: bigint): string {
  return formatUsdcAmount(raw).toFixed(2)
}

/** Build explorer tx link */
export function explorerTxUrl(hash: `0x${string}`): string {
  return `https://explorer.testnet.arc.io/tx/${hash}`
}

export function explorerAddrUrl(addr: string): string {
  return `https://explorer.testnet.arc.io/address/${addr}`
}

/** Format a short tx hash for display */
export function shortHash(hash: string): string {
  if (!hash || hash.length < 14) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

// Encode demo bounty taskRefs so they match the contract lookup
export function getDemoTaskRefHex(demoTaskRef: string): string {
  return taskRefToHex(demoTaskRef)
}

/** All demo bounty task refs pre-computed */
export const DEMO_TASK_REFS: Map<string, typeof DEMO_BOUNTIES[0]> = new Map(
  DEMO_BOUNTIES.map((b) => [taskRefToHex(b.taskRef).toLowerCase(), b])
)

// Unused hex helper kept for re-use
export { toHex }
