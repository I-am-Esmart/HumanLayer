/**
 * useHumanLayer — all contract reads and writes for HumanLayer.
 * Economic amounts are bigint (6-decimal USDC raw units).
 * Never use floating-point for onchain values.
 */
import { useReadContract, useReadContracts } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { Abi } from 'viem'
import { HUMANLAYER_ABI, HUMANLAYER_ADDRESS } from '../lib/contract'

const CHAIN_ID = arcTestnet.id

// ─── Onchain struct shapes returned by the contract ─────────────────────────

export interface OnchainBounty {
  bountyId: bigint
  creator: `0x${string}`
  rewardPerWorker: bigint
  category: number
  taskRef: `0x${string}`
  requiredWorkers: number
  acceptedCount: number
  deadline: bigint
  status: number          // BountyStatus enum index
  totalFunded: bigint
  totalPaid: bigint
  pendingApprovedReward: bigint
}

export interface OnchainSubmission {
  submissionId: bigint
  bountyId: bigint
  worker: `0x${string}`
  answerRef: `0x${string}`
  status: number           // SubmissionStatus enum index
  rewardClaimed: boolean
  submittedAt: bigint
}

export const BOUNTY_STATUS_MAP = ['Open', 'InProgress', 'Completed', 'Disputed', 'Cancelled'] as const
export const SUBMISSION_STATUS_MAP = ['Pending', 'Approved', 'Rejected', 'Disputed'] as const

// ─── Read: bounty count ──────────────────────────────────────────────────────

export function useBountyCount() {
  return useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'getBountyCount',
    chainId: CHAIN_ID,
  })
}

// ─── Read: single bounty ─────────────────────────────────────────────────────

export function useBounty(bountyId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'getBounty',
    args: bountyId !== undefined ? [bountyId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: bountyId !== undefined },
  })
  return { bounty: data as OnchainBounty | undefined, isLoading, error, refetch }
}

// ─── Read: all bounties (batch) ──────────────────────────────────────────────

export function useAllBounties(count: number) {
  const contracts = Array.from({ length: count }, (_, i) => ({
    address: HUMANLAYER_ADDRESS as `0x${string}`,
    abi: HUMANLAYER_ABI as readonly unknown[] as Abi,
    functionName: 'getBounty' as const,
    args: [BigInt(i + 1)] as [bigint],
    chainId: CHAIN_ID,
  }))

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: { enabled: count > 0 },
  })

  const bounties: OnchainBounty[] = (data ?? [])
    .map((r) => r.result as OnchainBounty | undefined)
    .filter((b): b is OnchainBounty => !!b && b.bountyId !== 0n)

  return { bounties, isLoading, error, refetch }
}

// ─── Read: worker submissions ────────────────────────────────────────────────

export function useWorkerSubmissionIds(worker: `0x${string}` | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'getWorkerSubmissions',
    args: worker ? [worker] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!worker },
  })
  return { ids: (data as bigint[] | undefined) ?? [], isLoading, error, refetch }
}

// ─── Read: bounty submissions ────────────────────────────────────────────────

export function useBountySubmissionIds(bountyId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'getBountySubmissions',
    args: bountyId !== undefined ? [bountyId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: bountyId !== undefined },
  })
  return { ids: (data as bigint[] | undefined) ?? [], isLoading, error, refetch }
}

// ─── Read: batch submissions ─────────────────────────────────────────────────

export function useSubmissions(ids: bigint[]) {
  const contracts = ids.map((id) => ({
    address: HUMANLAYER_ADDRESS as `0x${string}`,
    abi: HUMANLAYER_ABI as readonly unknown[] as Abi,
    functionName: 'getSubmission' as const,
    args: [id] as [bigint],
    chainId: CHAIN_ID,
  }))

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: { enabled: ids.length > 0 },
  })

  const submissions: OnchainSubmission[] = (data ?? [])
    .map((r) => r.result as OnchainSubmission | undefined)
    .filter((s): s is OnchainSubmission => !!s && s.submissionId !== 0n)

  return { submissions, isLoading, error, refetch }
}

// ─── Read: platform fee ───────────────────────────────────────────────────────

export function usePlatformFee() {
  const { data } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'platformFeeBps',
    chainId: CHAIN_ID,
  })
  return (data as bigint | undefined) ?? 200n
}

// ─── Read: contract owner ─────────────────────────────────────────────────────

export function useContractOwner() {
  const { data } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'owner',
    chainId: CHAIN_ID,
  })
  return (data as `0x${string}` | undefined)?.toLowerCase()
}

// ─── Read: worker reputation ──────────────────────────────────────────────────

export function useWorkerReputation(worker: `0x${string}` | undefined) {
  const { data, isLoading } = useReadContract({
    address: HUMANLAYER_ADDRESS,
    abi: HUMANLAYER_ABI,
    functionName: 'workerReputation',
    args: worker ? [worker] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!worker },
  })
  return { reputation: (data as bigint | undefined) ?? 0n, isLoading }
}
