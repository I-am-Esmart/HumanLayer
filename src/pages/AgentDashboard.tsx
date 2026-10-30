import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { Cpu, Plus, CheckCircle2, AlertCircle, ArrowRight, Coins, Users, TrendingUp, Loader2, Bot, ExternalLink } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { api, type AgentRecord } from '../lib/api'
import {
  formatUSDC,
  formatTimeLeft,
  formatAddress,
  STATUS_STYLES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  progressPercent,
} from '../lib/utils'
import {
  CATEGORY_FROM_INDEX,
} from '../lib/bounty-meta'
import {
  useBountyCount,
  useAllBounties,
  useBountySubmissionIds,
  useSubmissions,
  BOUNTY_STATUS_MAP,
} from '../hooks/useHumanLayer'
import { getBountyMeta } from '../lib/bounty-meta'
import { ARC_CHAIN_NAME } from '../lib/contract'
import type { Bounty } from '../types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { NetworkGuard } from '../components/NetworkGuard'
import type { Page } from '../App'

interface AgentDashboardProps {
  onNavigate: (page: Page, bounty?: Bounty) => void
}

export function AgentDashboard({ onNavigate }: AgentDashboardProps) {
  const { address, isConnected } = useAccount()

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Cpu className="w-12 h-12 mx-auto mb-4 text-[var(--accent)]/40" />
        <h1 className="display text-2xl font-bold text-[var(--ink)] mb-2">Agent Dashboard</h1>
        <p className="text-[var(--muted)] mb-8">Connect your agent wallet to manage bounties, review submissions, and release payments.</p>
        <ConnectKitButton label="Connect Agent Wallet" customTheme={CK_THEME} />
      </div>
    )
  }

  return (
    <NetworkGuard>
      <AgentDashboardInner address={address!} onNavigate={onNavigate} />
    </NetworkGuard>
  )
}

function AgentDashboardInner({ address, onNavigate }: { address: `0x${string}`; onNavigate: (page: Page, bounty?: Bounty) => void }) {
  const { data: countRaw, isLoading: countLoading } = useBountyCount()
  const count = countRaw ? Number(countRaw) : 0
  const { bounties: allBounties, isLoading: bountiesLoading } = useAllBounties(count)

  // Try to look up the registered API agent for this wallet address
  const [apiAgent, setApiAgent] = useState<AgentRecord | null>(null)
  const [_apiAgentLoading, setApiAgentLoading] = useState(true)
  useEffect(() => {
    // POST /api/agents/register returns agent_id; we can't reverse-lookup by wallet without a dedicated endpoint.
    // Instead we call the /api/bounties?creator=<address> endpoint to get API-side stats.
    api.bounties.list({ creator: address, limit: 200 })
      .then(() => { /* server is up, no agent record needed */ })
      .catch(() => { /* silent */ })
      .finally(() => setApiAgentLoading(false))
  }, [address])

  const isLoading = countLoading || bountiesLoading

  // Filter to only bounties created by this wallet
  const myOnchainBounties = allBounties.filter(
    (b) => b.creator.toLowerCase() === address.toLowerCase()
  )

  const myBounties: Bounty[] = myOnchainBounties.map((ob) => {
    const status = BOUNTY_STATUS_MAP[ob.status] ?? 'Open'
    const category = CATEGORY_FROM_INDEX[ob.category] ?? 'Research'
    const meta = getBountyMeta(ob.taskRef)
    return {
      id: `onchain-${ob.bountyId}`,
      bountyId: Number(ob.bountyId),
      title: meta.title !== 'Onchain Task' ? meta.title : `Bounty #${ob.bountyId}`,
      description: meta.description,
      instructions: meta.instructions,
      category,
      taskType: meta.taskType,
      difficulty: meta.difficulty,
      rewardPerWorker: Number(ob.rewardPerWorker) / 1_000_000,
      requiredWorkers: ob.requiredWorkers,
      acceptedCount: ob.acceptedCount,
      deadline: Number(ob.deadline),
      status,
      creator: ob.creator,
      taskRef: ob.taskRef,
      totalFunded: Number(ob.totalFunded) / 1_000_000,
      totalPaid: Number(ob.totalPaid) / 1_000_000,
      createdAt: 0,
      tags: meta.tags,
      estimatedMinutes: meta.estimatedMinutes,
    }
  })

  const activeBounties = myBounties.filter((b) => b.status === 'Open' || b.status === 'InProgress')
  const totalFunded = myOnchainBounties.reduce((a, b) => a + b.totalFunded, 0n)
  const totalPaid = myOnchainBounties.reduce((a, b) => a + b.totalPaid, 0n)

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
        <p className="text-sm text-[var(--muted)]">Loading your bounties from {ARC_CHAIN_NAME}…</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold text-[var(--ink)] mb-1">Agent Dashboard</h1>
          <p className="mono text-sm text-[var(--muted)]">{formatAddress(address)}</p>
        </div>
        <Button onClick={() => onNavigate('create-bounty')} size="md">
          <Plus className="w-4 h-4" />
          Post Bounty
        </Button>
      </div>

      {/* Stats grid: 6 cards on sm+, 2 columns on mobile */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard icon={<Coins className="w-5 h-5" />} label="Funded" value={`$${formatUSDC(Number(totalFunded) / 1e6)}`} sub="USDC escrowed" color="#acc6e9" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Paid out" value={`$${formatUSDC(Number(totalPaid) / 1e6)}`} sub="USDC released" color="#4ade80" />
        <StatCard
          icon={<Coins className="w-5 h-5" />}
          label="Remaining"
          value={`$${formatUSDC(Math.max(0, Number(totalFunded - totalPaid) / 1e6))}`}
          sub="in escrow"
          color="#f59e0b"
        />
        <StatCard icon={<Users className="w-5 h-5" />} label="Open" value={activeBounties.length.toString()} sub="active bounties" color="#a78bfa" />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Completed"
          value={myBounties.filter((b) => b.status === 'Completed').length.toString()}
          sub="finished tasks"
          color="#4ade80"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Avg cost"
          value={myBounties.length > 0 ? `$${formatUSDC(Number(totalFunded) / 1e6 / myBounties.length)}` : '—'}
          sub="per bounty"
          color="#fb7185"
        />
      </div>

      <div className="glass rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="font-semibold text-[var(--ink)]">My Bounties</h2>
          <span className="text-xs text-[var(--subtle)]">{myBounties.length} total</span>
        </div>

        {myBounties.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--muted)] text-sm mb-4">You haven't posted any bounties yet.</p>
            <Button variant="outline" size="sm" onClick={() => onNavigate('create-bounty')}>Post your first bounty</Button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {myBounties.map((bounty) => (
              <AgentBountyRow key={bounty.id} bounty={bounty} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {/* Agent API registration panel */}
      {!apiAgent && (
        <div className="glass rounded-xl p-5 mb-4 border border-[var(--accent)]/20">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--ink)] mb-1">Agent API access</p>
              <p className="text-xs text-[var(--muted)] leading-relaxed mb-3">
                Register this wallet as an API agent to get a Bearer key, set spending limits, and let AI systems programmatically discover and create bounties without using the UI.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onNavigate('api-docs')}>
                  <ExternalLink className="w-3 h-3" />
                  View API docs
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate('api-playground')}>
                  Try the playground
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate('demo-agent')}>
                  See demo agent
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="glass rounded-xl p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
          <Cpu className="w-5 h-5 text-[var(--accent)]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--ink)] mb-1">Need human verification for your AI outputs?</p>
          <p className="text-xs text-[var(--muted)] leading-relaxed mb-3">
            Post a bounty with USDC rewards. Qualified humans verify your data, classify outputs, or perform specialized research. Results are settled onchain on Arc.
          </p>
          <Button size="sm" variant="outline" onClick={() => onNavigate('create-bounty')}>Post a bounty</Button>
        </div>
      </div>
    </div>
  )
}

function AgentBountyRow({ bounty, onNavigate }: {
  bounty: Bounty
  onNavigate: (page: Page, bounty?: Bounty) => void
}) {
  const catColor = CATEGORY_COLORS[bounty.category]
  const statusStyle = STATUS_STYLES[bounty.status]
  const progress = progressPercent(bounty.acceptedCount, bounty.requiredWorkers)

  // Load submission IDs for pending count
  const { ids } = useBountySubmissionIds(BigInt(bounty.bountyId))
  const { submissions } = useSubmissions(ids)
  const pendingCount = submissions.filter((s) => s.status === 0).length

  return (
    <div className="px-5 py-4 hover:bg-[var(--surface-strong)] transition-colors">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-semibold" style={{ color: catColor }}>{CATEGORY_LABELS[bounty.category]}</span>
            <span className="text-xs text-[var(--subtle)]">·</span>
            <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20">
                <AlertCircle className="w-3 h-3" /> {pendingCount} pending
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-[var(--ink)] mb-2 leading-snug">{bounty.title}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-32 h-1.5 bg-[var(--surface-muted)] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: progress === 100 ? 'var(--success)' : 'var(--accent)' }} />
            </div>
            <span className="text-xs text-[var(--subtle)] tabular-nums">{bounty.acceptedCount}/{bounty.requiredWorkers} workers</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="display text-lg font-bold text-[var(--ink)] tabular-nums">
            ${formatUSDC(bounty.rewardPerWorker * bounty.requiredWorkers)}
          </span>
          <span className="text-xs text-[var(--subtle)]">{formatTimeLeft(bounty.deadline)} left</span>
          {pendingCount > 0 && (
            <Button size="sm" variant="secondary" onClick={() => onNavigate('task-detail', bounty)}>
              Review <ArrowRight className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <p className="display text-xl font-bold text-[var(--ink)] tabular-nums">{value}</p>
      <p className="text-xs text-[var(--subtle)] mt-0.5">{label}</p>
      <p className="text-xs text-[var(--subtle)]/60 mt-0.5">{sub}</p>
    </div>
  )
}

const CK_THEME = {
  '--ck-font-family': "'DM Sans', sans-serif",
  '--ck-primary-button-background': '#acc6e9',
  '--ck-primary-button-color': '#0d1b2f',
  '--ck-primary-button-border-radius': '8px',
  '--ck-primary-button-hover-background': '#cad9f0',
  '--ck-body-background': '#0d1b2f',
  '--ck-body-color': '#f0f4fa',
} as const
