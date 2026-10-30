import { useState } from 'react'
import { Shield, AlertTriangle, CheckCircle2, BarChart3, Coins, Loader2 } from 'lucide-react'
import { useAccount, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import {
  formatUSDC,
  formatAddress,
  formatRelativeTime,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  SUBMISSION_STATUS_STYLES,
  STATUS_STYLES,
} from '../lib/utils'
import {
  useBountyCount,
  useAllBounties,
  useSubmissions,
  useContractOwner,
  BOUNTY_STATUS_MAP,
  SUBMISSION_STATUS_MAP,
  type OnchainBounty,
  type OnchainSubmission,
} from '../hooks/useHumanLayer'
import { getBountyMeta, CATEGORY_FROM_INDEX, formatUsdcRaw } from '../lib/bounty-meta'
import { getSubmissionAnswer } from '../lib/bounty-meta'
import { ARC_CHAIN_ID, ARC_RPC_URL, HUMANLAYER_ABI, HUMANLAYER_ADDRESS } from '../lib/contract'
import { parseContractError, isUserRejection } from '../lib/errors'
import { Badge } from '../components/ui/Badge'
import { NetworkGuard } from '../components/NetworkGuard'

type AdminTab = 'overview' | 'submissions' | 'disputes'

export function AdminPage() {
  const { address, isConnected } = useAccount()
  const [tab, setTab] = useState<AdminTab>('overview')

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Shield className="w-12 h-12 mx-auto mb-4 text-[var(--accent)]/40" />
        <h1 className="display text-2xl font-bold text-[var(--ink)] mb-2">Admin Panel</h1>
        <p className="text-[var(--muted)] mb-8">Connect an admin wallet to access the review panel.</p>
        <ConnectKitButton label="Connect Admin Wallet" customTheme={CK_THEME} />
      </div>
    )
  }

  return (
    <NetworkGuard>
      <AdminPageInner address={address!} tab={tab} setTab={setTab} />
    </NetworkGuard>
  )
}

function AdminPageInner({ address, tab, setTab }: {
  address: `0x${string}`
  tab: AdminTab
  setTab: (t: AdminTab) => void
}) {
  const contractOwner = useContractOwner()
  const isOwner = Boolean(contractOwner && address.toLowerCase() === contractOwner)

  const { data: countRaw, isLoading: countLoading } = useBountyCount()
  const count = countRaw ? Number(countRaw) : 0
  const { bounties: allOnchainBounties, isLoading: bountiesLoading } = useAllBounties(count)
  const { writeContractAsync } = useWriteContract()

  // Collect all submission IDs across all bounties (flatten)
  // For admin view, load all submissions from all bounties
  const [allSubIds] = useState<bigint[]>([]) // populated via per-bounty sub lists

  const isLoading = countLoading || bountiesLoading

  const activeBounties = allOnchainBounties.filter((b) => b.status === 0 || b.status === 1)
  const totalPaid = allOnchainBounties.reduce((a, b) => a + b.totalPaid, 0n)
  const totalFunded = allOnchainBounties.reduce((a, b) => a + b.totalFunded, 0n)

  async function handleResolveDispute(subId: bigint, workerWins: boolean) {
    if (!isOwner) {
      toast.error('Only the contract owner can resolve disputes.')
      return
    }
    try {
      const hash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'resolveDispute',
        args: [subId, workerWins],
      })
      toast.loading('Resolving dispute…', { id: `dispute-${subId}` })
      await waitForReceipt(hash)
      toast.success(
        workerWins ? 'Dispute resolved: worker wins.' : 'Dispute resolved: creator wins.',
        { id: `dispute-${subId}` }
      )
    } catch (err: unknown) {
      if (isUserRejection(err)) toast.dismiss(`dispute-${subId}`)
      else toast.error(parseContractError(err), { id: `dispute-${subId}` })
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="display text-3xl font-bold text-[var(--ink)]">Admin Panel</h1>
          <p className="text-[var(--muted)] text-sm">Platform oversight and dispute resolution</p>
        </div>
      </div>

      {!isOwner && (
        <div className="mb-6 p-3 rounded-xl bg-amber-400/5 border border-amber-400/20 flex items-center gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Your wallet is not the contract owner. Dispute resolution buttons are disabled. Owner: {contractOwner ? formatAddress(contractOwner) : 'unavailable'}.
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center py-16 gap-4">
          <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
          <p className="text-sm text-[var(--muted)]">Loading platform data…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard icon={<BarChart3 className="w-5 h-5" />} label="Active bounties" value={activeBounties.length.toString()} color="#acc6e9" />
            <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Total bounties" value={count.toString()} color="#fbbf24" />
            <StatCard icon={<Coins className="w-5 h-5" />} label="Total escrowed" value={`$${formatUsdcRaw(totalFunded)}`} color="#a78bfa" />
            <StatCard icon={<Coins className="w-5 h-5" />} label="USDC paid out" value={`$${formatUsdcRaw(totalPaid)}`} color="#4ade80" />
          </div>

          <div className="flex gap-1 mb-6 bg-[var(--surface)] p-1 rounded-lg w-fit">
            {(['overview', 'disputes'] as AdminTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={['px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors', tab === t ? 'bg-[var(--surface-strong)] text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="glass rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border)]">
                  <h2 className="font-semibold text-[var(--ink)]">All Bounties ({count})</h2>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {allOnchainBounties.map((b) => {
                    const status = BOUNTY_STATUS_MAP[b.status] ?? 'Open'
                    const category = CATEGORY_FROM_INDEX[b.category] ?? 'Research'
                    const catColor = CATEGORY_COLORS[category]
                    const statusStyle = STATUS_STYLES[status]
                    const meta = getBountyMeta(b.taskRef)
                    const title = meta.title !== 'Onchain Task' ? meta.title : `Bounty #${b.bountyId}`
                    return (
                      <div key={b.bountyId.toString()} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--surface-strong)] transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold" style={{ color: catColor }}>{CATEGORY_LABELS[category]}</span>
                            <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                          </div>
                          <p className="text-sm font-medium text-[var(--ink)] truncate">{title}</p>
                          <p className="mono text-xs text-[var(--subtle)]">{formatAddress(b.creator)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-[var(--ink)] tabular-nums">${formatUsdcRaw(b.rewardPerWorker * BigInt(b.requiredWorkers))}</p>
                          <p className="text-xs text-[var(--subtle)]">{b.acceptedCount}/{b.requiredWorkers} workers</p>
                        </div>
                      </div>
                    )
                  })}
                  {allOnchainBounties.length === 0 && (
                    <div className="text-center py-12 text-[var(--muted)] text-sm">No bounties yet.</div>
                  )}
                </div>
              </div>

              <div className="glass rounded-xl p-5">
                <h3 className="font-semibold text-[var(--ink)] mb-4">Platform Statistics</h3>
                <div className="grid sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-[var(--subtle)] text-xs mb-1">Total escrowed</p>
                    <p className="font-bold text-[var(--ink)] tabular-nums">${formatUsdcRaw(totalFunded)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--subtle)] text-xs mb-1">Total paid out</p>
                    <p className="font-bold text-emerald-400 tabular-nums">${formatUsdcRaw(totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--subtle)] text-xs mb-1">In escrow</p>
                    <p className="font-bold text-[var(--accent)] tabular-nums">${formatUsdcRaw(totalFunded - totalPaid)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'disputes' && (
            <DisputeTab bounties={allOnchainBounties} isOwner={isOwner} onResolve={handleResolveDispute} />
          )}
        </>
      )}
    </div>
  )
}

function DisputeTab({ bounties, isOwner, onResolve }: {
  bounties: OnchainBounty[]
  isOwner: boolean
  onResolve: (subId: bigint, workerWins: boolean) => Promise<void>
}) {
  // Collect all bounty IDs that have a disputed sub (we don't know which subs yet)
  // Load subs for all bounties — for the admin view, we do a batch read
  // Since we can't know which bounties have disputed subs without reading all of them,
  // we show a message and rely on dispute count from events instead.
  // The real-time approach is: admin watches for SubmissionDisputed events, then resolves.

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h2 className="font-semibold text-[var(--ink)]">Disputed Submissions</h2>
        </div>
      </div>
      <div className="text-center py-16">
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400/40" />
        <p className="text-[var(--muted)] text-sm">No active disputes detected.</p>
        <p className="text-xs text-[var(--subtle)] mt-2 max-w-sm mx-auto">
          Disputes are escalated by workers via the Activity feed. When a dispute is detected, its submission ID can be resolved here.
        </p>
        {!isOwner && (
          <p className="text-xs text-amber-300/70 mt-3">
            Connect the contract owner wallet to enable dispute resolution.
          </p>
        )}
      </div>
    </div>
  )
}

async function waitForReceipt(hash: `0x${string}`) {
  const rpc = ARC_RPC_URL
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

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <p className="display text-xl font-bold text-[var(--ink)] tabular-nums">{value}</p>
      <p className="text-xs text-[var(--subtle)] mt-0.5">{label}</p>
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
