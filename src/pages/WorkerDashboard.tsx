import { useAccount, useWriteContract } from 'wagmi'
import { Award, CheckCircle2, ArrowRight, Coins, Clock, Loader2 } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import {
  formatUSDC,
  formatRelativeTime,
  SUBMISSION_STATUS_STYLES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  formatAddress,
} from '../lib/utils'
import {
  useWorkerSubmissionIds,
  useSubmissions,
  useBounty,
  useWorkerReputation,
  SUBMISSION_STATUS_MAP,
  type OnchainSubmission,
} from '../hooks/useHumanLayer'
import {
  formatUsdcRaw,
  explorerTxUrl,
  shortHash,
  CATEGORY_FROM_INDEX,
  getSubmissionAnswer,
} from '../lib/bounty-meta'
import { HUMANLAYER_ABI, HUMANLAYER_ADDRESS } from '../lib/contract'
import { parseContractError, isUserRejection } from '../lib/errors'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { NetworkGuard } from '../components/NetworkGuard'
import type { Page } from '../App'

interface WorkerDashboardProps {
  onNavigate: (page: Page) => void
}

export function WorkerDashboard({ onNavigate }: WorkerDashboardProps) {
  const { address, isConnected } = useAccount()

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Award className="w-12 h-12 mx-auto mb-4 text-[var(--accent)]/40" />
        <h1 className="display text-2xl font-bold text-[var(--ink)] mb-2">Worker Dashboard</h1>
        <p className="text-[var(--muted)] mb-8">Connect your wallet to view your submissions, earnings, and reputation.</p>
        <ConnectKitButton label="Connect Wallet" customTheme={CK_THEME} />
      </div>
    )
  }

  return (
    <NetworkGuard>
      <WorkerDashboardInner address={address!} onNavigate={onNavigate} />
    </NetworkGuard>
  )
}

function WorkerDashboardInner({ address, onNavigate }: { address: `0x${string}`; onNavigate: (page: Page) => void }) {
  const { ids, isLoading: idsLoading, refetch: refetchIds } = useWorkerSubmissionIds(address)
  const { submissions, isLoading: subsLoading, refetch: refetchSubs } = useSubmissions(ids)
  const { reputation } = useWorkerReputation(address)
  const { writeContractAsync } = useWriteContract()

  const isLoading = idsLoading || subsLoading

  const approvedSubs = submissions.filter((s) => s.status === 1) // Approved
  const pendingSubs = submissions.filter((s) => s.status === 0)  // Pending
  const claimableSubs = approvedSubs.filter((s) => !s.rewardClaimed)

  function refetchAll() {
    void refetchIds()
    void refetchSubs()
  }

  async function handleClaim(sub: OnchainSubmission) {
    try {
      const hash = await writeContractAsync({
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'claimReward',
        args: [sub.submissionId],
      })
      toast.loading('Claiming reward…', { id: `claim-${sub.submissionId}` })
      await waitForReceipt(hash)
      toast.success(
        <span>
          Reward claimed!{' '}
          <a href={explorerTxUrl(hash)} target="_blank" rel="noopener noreferrer" className="underline">
            View tx
          </a>
        </span>,
        { id: `claim-${sub.submissionId}` }
      )
      refetchAll()
    } catch (err: unknown) {
      if (isUserRejection(err)) toast.dismiss(`claim-${sub.submissionId}`)
      else toast.error(parseContractError(err), { id: `claim-${sub.submissionId}` })
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
        <p className="text-sm text-[var(--muted)]">Loading your submissions from Arc Testnet…</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="display text-3xl font-bold text-[var(--ink)] mb-1">Worker Dashboard</h1>
        <p className="mono text-sm text-[var(--muted)]">{formatAddress(address)}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Award className="w-5 h-5" />} label="Reputation" value={reputation.toString()} sub="approved tasks" color="#acc6e9" />
        <StatCard icon={<Coins className="w-5 h-5" />} label="Claimable" value={`${claimableSubs.length}`} sub="unclaimed rewards" color="#4ade80" />
        <StatCard icon={<Clock className="w-5 h-5" />} label="Pending" value={pendingSubs.length.toString()} sub="awaiting review" color="#fbbf24" />
        <StatCard icon={<CheckCircle2 className="w-5 h-5" />} label="Submissions" value={submissions.length.toString()} sub="total submitted" color="#a78bfa" />
      </div>

      {/* Claimable rewards banner */}
      {claimableSubs.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-400/5 border border-emerald-400/20 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-emerald-400">You have unclaimed rewards</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{claimableSubs.length} approved submission{claimableSubs.length > 1 ? 's' : ''} ready to claim</p>
          </div>
        </div>
      )}

      <div className="glass rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="font-semibold text-[var(--ink)]">My Submissions</h2>
          <button onClick={() => onNavigate('marketplace')} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
            Find more tasks <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {submissions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--muted)] text-sm mb-4">No submissions yet.</p>
            <Button variant="outline" size="sm" onClick={() => onNavigate('marketplace')}>Browse tasks</Button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {submissions.map((sub) => (
              <SubmissionRow key={sub.submissionId.toString()} sub={sub} onClaim={() => { void handleClaim(sub) }} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 glass rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <Award className="w-5 h-5 text-[var(--accent)]" />
          <h3 className="font-semibold text-[var(--ink)]">Reputation Score: {reputation.toString()}</h3>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Your reputation increases with each approved submission. Higher reputation establishes your credibility as a trusted worker.
        </p>
      </div>
    </div>
  )
}

function SubmissionRow({ sub, onClaim }: { sub: OnchainSubmission; onClaim: () => void }) {
  const status = SUBMISSION_STATUS_MAP[sub.status] ?? 'Pending'
  const style = SUBMISSION_STATUS_STYLES[status]
  const canClaim = status === 'Approved' && !sub.rewardClaimed
  const storedAnswer = getSubmissionAnswer(sub.submissionId.toString())

  // Load the bounty to show title and reward
  const { bounty } = useBounty(sub.bountyId)
  const rewardPerWorker = bounty ? bounty.rewardPerWorker : undefined
  const catColor = bounty ? CATEGORY_COLORS[CATEGORY_FROM_INDEX[bounty.category] ?? 'Research'] : '#acc6e9'
  const catLabel = bounty ? CATEGORY_LABELS[CATEGORY_FROM_INDEX[bounty.category] ?? 'Research'] : ''

  return (
    <div className="px-5 py-4 hover:bg-[var(--surface-strong)] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {catLabel && <span className="text-xs font-medium" style={{ color: catColor }}>{catLabel}</span>}
            <span className="text-xs text-[var(--subtle)]">· Bounty #{sub.bountyId.toString()}</span>
            <span className="text-xs text-[var(--subtle)]">· {formatRelativeTime(Number(sub.submittedAt))}</span>
          </div>
          {storedAnswer && (
            <p className="text-xs text-[var(--subtle)] truncate max-w-sm mt-1">{storedAnswer.slice(0, 80)}{storedAnswer.length > 80 ? '…' : ''}</p>
          )}
          {!storedAnswer && (
            <p className="mono text-xs text-[var(--subtle)]">answerRef: {shortHash(sub.answerRef)}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Badge className={style.className}>{style.label}</Badge>
          {rewardPerWorker !== undefined && (
            <span className="text-sm font-bold text-[var(--ink)] tabular-nums">
              ${formatUsdcRaw(rewardPerWorker)} USDC
            </span>
          )}
          {canClaim && (
            <Button size="sm" variant="primary" onClick={onClaim}>
              Claim USDC
            </Button>
          )}
          {status === 'Approved' && sub.rewardClaimed && (
            <span className="text-xs text-emerald-400">Claimed</span>
          )}
        </div>
      </div>
    </div>
  )
}

async function waitForReceipt(hash: `0x${string}`) {
  const rpc = 'https://rpc.testnet.arc.io'
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
    })
    const json = await res.json() as { result?: unknown }
    if (json.result) return
  }
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
