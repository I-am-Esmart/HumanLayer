import { useMemo } from 'react'
import { Activity, CheckCircle2, Plus, Coins, XCircle, Loader2 } from 'lucide-react'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { useQuery } from '@tanstack/react-query'
import { formatRelativeTime } from '../lib/utils'
import { formatUsdcRaw } from '../lib/bounty-meta'
import { HUMANLAYER_ADDRESS } from '../lib/contract'
import { useBountyCount } from '../hooks/useHumanLayer'

type EventType = 'BountyCreated' | 'BountyFunded' | 'WorkSubmitted' | 'SubmissionApproved' | 'SubmissionRejected' | 'SubmissionDisputed' | 'RewardClaimed' | 'DisputeResolved' | 'BountyCancelled'

interface ActivityEvent {
  id: string
  type: EventType
  blockNumber: bigint
  ts: number
  actor: string
  subject: string
  amount?: bigint
  category?: number
  txHash: string
}

const EVENT_CONFIG: Record<EventType, { icon: typeof Activity; color: string; label: (e: ActivityEvent) => string }> = {
  BountyCreated:       { icon: Plus,          color: '#acc6e9', label: (e) => `New bounty #${e.subject} created` },
  BountyFunded:        { icon: Coins,         color: '#4ade80', label: (e) => `Bounty #${e.subject} funded` },
  WorkSubmitted:       { icon: Activity,      color: '#a78bfa', label: (e) => `Work submitted for bounty #${e.subject}` },
  SubmissionApproved:  { icon: CheckCircle2,  color: '#4ade80', label: (e) => `Submission approved on bounty #${e.subject}` },
  SubmissionRejected:  { icon: XCircle,       color: '#f87171', label: (e) => `Submission rejected on bounty #${e.subject}` },
  SubmissionDisputed:  { icon: Activity,      color: '#fb923c', label: (e) => `Submission disputed on bounty #${e.subject}` },
  RewardClaimed:       { icon: Coins,         color: '#fbbf24', label: (e) => `USDC claimed from bounty #${e.subject}` },
  DisputeResolved:     { icon: CheckCircle2,  color: '#34d399', label: (e) => `Dispute resolved on bounty #${e.subject}` },
  BountyCancelled:     { icon: XCircle,       color: '#f87171', label: (e) => `Bounty #${e.subject} cancelled` },
}

const EVENT_SIGNATURES = [
  { name: 'BountyCreated',      topic: 'BountyCreated(uint256,address,uint256,uint8,bytes32,uint256,uint256)',     type: 'BountyCreated'      as EventType },
  { name: 'BountyFunded',       topic: 'BountyFunded(uint256,address,uint256)',                                    type: 'BountyFunded'       as EventType },
  { name: 'WorkSubmitted',      topic: 'WorkSubmitted(uint256,uint256,address,bytes32)',                           type: 'WorkSubmitted'      as EventType },
  { name: 'SubmissionApproved', topic: 'SubmissionApproved(uint256,uint256,address)',                              type: 'SubmissionApproved' as EventType },
  { name: 'SubmissionRejected', topic: 'SubmissionRejected(uint256,uint256,address)',                              type: 'SubmissionRejected' as EventType },
  { name: 'SubmissionDisputed', topic: 'SubmissionDisputed(uint256,uint256,address)',                              type: 'SubmissionDisputed' as EventType },
  { name: 'RewardClaimed',      topic: 'RewardClaimed(uint256,uint256,address,uint256)',                           type: 'RewardClaimed'      as EventType },
  { name: 'DisputeResolved',    topic: 'DisputeResolved(uint256,uint256,bool,address)',                            type: 'DisputeResolved'    as EventType },
  { name: 'BountyCancelled',    topic: 'BountyCancelled(uint256,address,uint256)',                                 type: 'BountyCancelled'    as EventType },
]

function topicHash(sig: string): `0x${string}` {
  // keccak256 of the event signature — computed via viem
  // Import keccak256 from viem at top since we can't call it at module level safely here
  // We'll compute them dynamically using the ABI approach
  return sig as `0x${string}` // placeholder — replaced below
}

async function fetchEvents(): Promise<ActivityEvent[]> {
  const rpc = 'https://rpc.testnet.arc.io'

  // Get current block
  const blockRes = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  const blockJson = await blockRes.json() as { result?: string }
  const latestBlock = blockJson.result ? parseInt(blockJson.result, 16) : 0
  const fromBlock = Math.max(0, latestBlock - 5000)

  // Fetch all logs for the HumanLayer contract
  const logsRes = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_getLogs',
      params: [{
        address: HUMANLAYER_ADDRESS,
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: 'latest',
      }],
    }),
  })
  const logsJson = await logsRes.json() as { result?: Array<{
    topics: string[]
    data: string
    transactionHash: string
    blockNumber: string
    address: string
  }> }

  const logs = logsJson.result ?? []
  if (logs.length === 0) return []

  // Build timestamp map from unique block numbers
  const blockNums = [...new Set(logs.map((l) => l.blockNumber))]
  const blockTimestamps = new Map<string, number>()
  for (const bn of blockNums.slice(0, 30)) {
    try {
      const bRes = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_getBlockByNumber', params: [bn, false] }),
      })
      const bJson = await bRes.json() as { result?: { timestamp?: string } }
      if (bJson.result?.timestamp) {
        blockTimestamps.set(bn, parseInt(bJson.result.timestamp, 16))
      }
    } catch { /* skip */ }
  }

  // Decode logs using topic[0] matching
  const { keccak256, toEventSelector } = await import('viem')
  const topicMap = new Map<string, EventType>()
  for (const ev of EVENT_SIGNATURES) {
    try {
      const selector = toEventSelector(ev.topic)
      topicMap.set(selector.toLowerCase(), ev.type)
    } catch { /* skip malformed */ }
  }

  const events: ActivityEvent[] = []
  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase()
    if (!topic0) continue
    const eventType = topicMap.get(topic0)
    if (!eventType) continue

    const bountyIdHex = log.topics[1]
    const bountyId = bountyIdHex ? parseInt(bountyIdHex, 16).toString() : '?'
    const actor = log.topics[2]
      ? '0x' + log.topics[2].slice(-40)
      : log.transactionHash.slice(0, 10) + '…'

    // Parse amount from data for funded/claimed events
    let amount: bigint | undefined
    if (eventType === 'BountyFunded' || eventType === 'RewardClaimed' || eventType === 'BountyCancelled') {
      try {
        // data contains the amount as a uint256 (first 32 bytes)
        amount = BigInt('0x' + log.data.slice(2, 66))
      } catch { /* skip */ }
    }

    const ts = blockTimestamps.get(log.blockNumber) ?? Math.floor(Date.now() / 1000) - 3600

    events.push({
      id: `${log.transactionHash}-${log.topics.join('-')}`,
      type: eventType,
      blockNumber: BigInt(parseInt(log.blockNumber, 16)),
      ts,
      actor,
      subject: bountyId,
      amount,
      txHash: log.transactionHash,
    })
  }

  // Sort newest first
  return events.sort((a, b) => b.ts - a.ts).slice(0, 50)
}

export function ActivityPage() {
  const { data: countRaw } = useBountyCount()
  const bountyCount = countRaw ? Number(countRaw) : 0

  const { data: events, isLoading } = useQuery<ActivityEvent[]>({
    queryKey: ['humanlayer-events'],
    queryFn: fetchEvents,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const stats = useMemo(() => {
    if (!events) return { total: bountyCount, funded: 0, claimed: 0, totalClaimedRaw: 0n }
    const funded = events.filter((e) => e.type === 'BountyFunded').length
    const claimed = events.filter((e) => e.type === 'RewardClaimed').length
    const totalClaimedRaw = events
      .filter((e) => e.type === 'RewardClaimed' && e.amount)
      .reduce((a, e) => a + (e.amount ?? 0n), 0n)
    return { total: bountyCount, funded, claimed, totalClaimedRaw }
  }, [events, bountyCount])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="display text-3xl font-bold text-[var(--ink)] mb-1">Activity</h1>
        <p className="text-[var(--muted)] text-sm">Live onchain events from the HumanLayer network</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-xl p-4">
          <p className="display text-2xl font-bold text-[var(--ink)] tabular-nums">{stats.total}</p>
          <p className="text-xs text-[var(--subtle)] mt-0.5">Total bounties</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="display text-2xl font-bold text-emerald-400 tabular-nums">{stats.funded}</p>
          <p className="text-xs text-[var(--subtle)] mt-0.5">Bounties funded</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="display text-2xl font-bold text-[var(--ink)] tabular-nums">{stats.claimed}</p>
          <p className="text-xs text-[var(--subtle)] mt-0.5">Rewards claimed</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="display text-2xl font-bold text-amber-400 tabular-nums">
            ${formatUsdcRaw(stats.totalClaimedRaw)}
          </p>
          <p className="text-xs text-[var(--subtle)] mt-0.5">USDC paid out</p>
        </div>
      </div>

      <div className="glass rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="font-semibold text-[var(--ink)]">Network Activity</h2>
            <span className="text-xs text-[var(--subtle)] ml-auto">Updates every 30s</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center py-16 gap-4">
            <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
            <p className="text-sm text-[var(--muted)]">Loading onchain events…</p>
          </div>
        ) : !events || events.length === 0 ? (
          <div className="text-center py-16">
            <Activity className="w-10 h-10 mx-auto mb-3 text-[var(--subtle)]/40" />
            <p className="text-[var(--muted)] text-sm">No onchain events yet.</p>
            <p className="text-xs text-[var(--subtle)] mt-1">Events will appear here when bounties are created and funded.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {events.map((event) => {
              const config = EVENT_CONFIG[event.type]
              const Icon = config.icon

              return (
                <div key={event.id} className="px-5 py-4 flex items-start gap-4 hover:bg-[var(--surface-strong)] transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${config.color}15`, color: config.color }}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--ink)] leading-snug">{config.label(event)}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="mono text-xs text-[var(--subtle)]">{event.actor.slice(0, 6)}…{event.actor.slice(-4)}</span>
                      {event.amount !== undefined && event.amount > 0n && (
                        <span className="text-xs font-semibold text-amber-400 tabular-nums">
                          ${formatUsdcRaw(event.amount)} USDC
                        </span>
                      )}
                      <a
                        href={`https://explorer.testnet.arc.io/tx/${event.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono text-xs text-[var(--accent)] hover:underline"
                      >
                        {event.txHash.slice(0, 8)}…
                      </a>
                    </div>
                  </div>
                  <span className="text-xs text-[var(--subtle)] flex-shrink-0 mt-0.5">{formatRelativeTime(event.ts)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
