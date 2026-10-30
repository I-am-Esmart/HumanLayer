import { useState, useCallback } from 'react'
import { ArrowLeft, Tag, CheckCircle2, AlertTriangle, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { useAccount, useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import type { Bounty } from '../types'
import { Button } from '../components/ui/Button'
import { Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { NetworkGuard } from '../components/NetworkGuard'
import {
  getNowSec,
  formatUSDC,
  formatTimeLeft,
  formatDate,
  formatAddress,
  STATUS_STYLES,
  DIFFICULTY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  progressPercent,
  SUBMISSION_STATUS_STYLES,
  formatRelativeTime,
} from '../lib/utils'
import {
  answerToRef,
  explorerTxUrl,
  shortHash,
} from '../lib/bounty-meta'
import {
  storeSubmissionAnswer,
  getSubmissionAnswer,
} from '../lib/bounty-meta'
import { ARC_CHAIN_ID, ARC_CHAIN_NAME, ARC_RPC_URL, HUMANLAYER_ABI, HUMANLAYER_ADDRESS } from '../lib/contract'
import { parseContractError, isUserRejection } from '../lib/errors'
import {
  useBountySubmissionIds,
  useSubmissions,
  type OnchainSubmission,
  SUBMISSION_STATUS_MAP,
} from '../hooks/useHumanLayer'
import type { Page } from '../App'

interface TaskDetailPageProps {
  bounty: Bounty
  onNavigate: (page: Page) => void
}

export function TaskDetailPage({ bounty, onNavigate }: TaskDetailPageProps) {
  const { address, isConnected } = useAccount()
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitHash, setSubmitHash] = useState<`0x${string}` | undefined>()
  const [showAllSubs, setShowAllSubs] = useState(false)

  const bountyIdBig = BigInt(bounty.bountyId)
  const isCreator = address && bounty.creator.toLowerCase() === address.toLowerCase()
  const isExpired = bounty.deadline < getNowSec()
  const catColor = CATEGORY_COLORS[bounty.category]
  const catLabel = CATEGORY_LABELS[bounty.category]
  const statusStyle = STATUS_STYLES[bounty.status]
  const diffStyle = DIFFICULTY_STYLES[bounty.difficulty]
  const progress = progressPercent(bounty.acceptedCount, bounty.requiredWorkers)

  // Load submissions for this bounty
  const { ids: submissionIds, refetch: refetchSubIds } = useBountySubmissionIds(bountyIdBig)
  const { submissions, refetch: refetchSubs } = useSubmissions(submissionIds)

  const refetchAll = useCallback(() => {
    void refetchSubIds()
    void refetchSubs()
  }, [refetchSubIds, refetchSubs])

  // Submissions for the current worker
  const mySubmissions = address
    ? submissions.filter((s) => s.worker.toLowerCase() === address.toLowerCase())
    : []
  const myLatestSub = mySubmissions[mySubmissions.length - 1]
  const hasSubmitted = mySubmissions.length > 0

  const { writeContractAsync } = useWriteContract()

  async function handleSubmit() {
    if (!address || !answer.trim()) return
    if (answer.trim().length < 20) {
      toast.error('Answer too short — please provide at least 20 characters.')
      return
    }
    setSubmitting(true)
    try {
      const answerRef = answerToRef(answer, address)
      const hash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'submitWork',
        args: [bountyIdBig, answerRef],
      })
      setSubmitHash(hash)
      toast.success('Transaction submitted. Waiting for confirmation…')
      // Wait for confirmation
      await waitForReceipt(hash)
      toast.success('Work submitted onchain!')
      // Store answer offchain (session) so reviewer can view it
      storeSubmissionAnswer(String(submissionIds.length + 1), String(bounty.bountyId), address, answer, answerRef)
      setSubmitted(true)
      setAnswer('')
      refetchAll()
    } catch (err: unknown) {
      if (isUserRejection(err)) {
        toast.info('Transaction cancelled.')
      } else {
        toast.error(parseContractError(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove(sub: OnchainSubmission) {
    try {
      const hash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'approveSubmission',
        args: [sub.submissionId],
      })
      toast.loading('Approving…', { id: `approve-${sub.submissionId}` })
      await waitForReceipt(hash)
      toast.success('Submission approved. Worker reward unlocked.', { id: `approve-${sub.submissionId}` })
      refetchAll()
    } catch (err: unknown) {
      if (isUserRejection(err)) toast.dismiss()
      else toast.error(parseContractError(err), { id: `approve-${sub.submissionId}` })
    }
  }

  async function handleReject(sub: OnchainSubmission) {
    try {
      const hash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'rejectSubmission',
        args: [sub.submissionId],
      })
      toast.loading('Rejecting…', { id: `reject-${sub.submissionId}` })
      await waitForReceipt(hash)
      toast.success('Submission rejected.', { id: `reject-${sub.submissionId}` })
      refetchAll()
    } catch (err: unknown) {
      if (isUserRejection(err)) toast.dismiss()
      else toast.error(parseContractError(err), { id: `reject-${sub.submissionId}` })
    }
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

  const pendingSubmissions = submissions.filter((s) => s.status === 0) // Pending
  const displayedSubs = showAllSubs ? submissions : submissions.slice(0, 5)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <button
        onClick={() => onNavigate('marketplace')}
        className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--ink)] mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Marketplace
      </button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <div className="glass rounded-xl p-6">
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: catColor }} />
              <span className="text-xs font-semibold" style={{ color: catColor }}>{catLabel}</span>
              <span className="text-xs text-[var(--subtle)]">·</span>
              <span className="text-xs text-[var(--subtle)]">{bounty.taskType}</span>
              <span className="text-xs text-[var(--subtle)]">·</span>
              <span className={`text-xs font-medium ${diffStyle.className}`}>{diffStyle.label}</span>
              <span className="text-xs text-[var(--subtle)]">·</span>
              <span className="text-xs text-[var(--subtle)]">~{bounty.estimatedMinutes} min</span>
            </div>
            <h1 className="display text-2xl font-bold text-[var(--ink)] mb-3 leading-tight">{bounty.title}</h1>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">{bounty.description}</p>
            {bounty.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {bounty.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[var(--surface-muted)] text-[var(--muted)] border border-[var(--border)]">
                    <Tag className="w-3 h-3" /> {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="glass rounded-xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--subtle)] mb-4">Task Instructions</h2>
            <p className="text-sm text-[var(--ink)] leading-relaxed whitespace-pre-line">{bounty.instructions}</p>
          </div>

          {/* Submission form / status */}
          <div className="glass rounded-xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--subtle)] mb-4">Your Submission</h2>

            {!isConnected ? (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400/60" />
                Connect your wallet to submit work for this bounty.
              </div>
            ) : isCreator ? (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded-lg p-4 text-sm text-amber-300">
                You are the creator of this bounty and cannot submit to it.
              </div>
            ) : isExpired && !hasSubmitted ? (
              <div className="bg-red-400/5 border border-red-400/20 rounded-lg p-4 text-sm text-red-300">
                This bounty has expired. The deadline has passed.
              </div>
            ) : bounty.status === 'Completed' || bounty.status === 'Cancelled' ? (
              <div className="bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg p-4 text-sm text-[var(--muted)]">
                This bounty is {bounty.status.toLowerCase()} and no longer accepting submissions.
              </div>
            ) : myLatestSub ? (
              <SubmissionStatusCard sub={myLatestSub} bounty={bounty} submitHash={submitHash} />
            ) : submitted ? (
              <div className="flex flex-col items-center py-8 gap-4 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                <div>
                  <p className="font-semibold text-[var(--ink)]">Submission sent</p>
                  <p className="text-sm text-[var(--muted)] mt-1">The bounty creator will review your work.</p>
                  {submitHash && (
                    <a href={explorerTxUrl(submitHash)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 justify-center text-xs text-[var(--accent)] hover:underline mt-2 mono">
                      {shortHash(submitHash)} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button onClick={() => onNavigate('worker-dashboard')} className="text-sm text-[var(--accent)] hover:underline">
                  View my submissions
                </button>
              </div>
            ) : (
              <NetworkGuard>
                <div className="space-y-4">
                  <Textarea
                    label="Your Answer"
                    placeholder="Provide your full response here. Be thorough and clear."
                    rows={8}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    hint={`${answer.length} characters`}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--subtle)]">Your answer is stored offchain. Only a hash is recorded onchain.</p>
                    <Button
                      onClick={() => { void handleSubmit() }}
                      loading={submitting}
                      disabled={!answer.trim() || submitting}
                      size="lg"
                    >
                      Submit Work
                    </Button>
                  </div>
                </div>
              </NetworkGuard>
            )}
          </div>

          {/* Creator review panel */}
          {isCreator && submissions.length > 0 && (
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <h2 className="font-semibold text-[var(--ink)]">Submissions to Review</h2>
                {pendingSubmissions.length > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20">
                    {pendingSubmissions.length} pending
                  </span>
                )}
              </div>
              <div className="divide-y divide-[var(--border)]">
                {displayedSubs.map((sub) => (
                  <SubmissionReviewRow
                    key={sub.submissionId.toString()}
                    sub={sub}
                    onApprove={() => { void handleApprove(sub) }}
                    onReject={() => { void handleReject(sub) }}
                  />
                ))}
              </div>
              {submissions.length > 5 && (
                <button
                  onClick={() => setShowAllSubs(!showAllSubs)}
                  className="w-full py-3 text-xs text-[var(--accent)] hover:bg-[var(--surface-muted)] flex items-center justify-center gap-1 transition-colors"
                >
                  {showAllSubs ? (<><ChevronUp className="w-3 h-3" /> Show less</>) : (<><ChevronDown className="w-3 h-3" /> Show all {submissions.length} submissions</>)}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="glass rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">Reward per worker</p>
            <p className="display text-3xl font-bold text-[var(--ink)] tabular-nums">
              ${formatUSDC(bounty.rewardPerWorker)}
              <span className="text-sm font-normal text-[var(--subtle)] ml-1">USDC</span>
            </p>
            <p className="text-xs text-[var(--subtle)] mt-1">Total pool: ${formatUSDC(bounty.rewardPerWorker * bounty.requiredWorkers)} USDC</p>
            <div className="border-t border-[var(--border)] my-4" />
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--subtle)]">Status</span>
              <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
            </div>
          </div>

          <div className="glass rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">Workers filled</p>
            <div className="flex items-end gap-2 mb-2">
              <span className="display text-2xl font-bold text-[var(--ink)] tabular-nums">{bounty.acceptedCount}</span>
              <span className="text-[var(--subtle)] text-sm pb-0.5">/ {bounty.requiredWorkers}</span>
            </div>
            <div className="h-2 bg-[var(--surface-muted)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: progress === 100 ? 'var(--success)' : 'var(--accent)' }} />
            </div>
          </div>

          <div className="glass rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">Task details</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--subtle)]">Deadline</span>
              <span className={`font-medium ${isExpired ? 'text-red-400' : 'text-[var(--ink)]'}`}>
                {isExpired ? 'Expired' : formatTimeLeft(bounty.deadline)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--subtle)]">Closes</span>
              <span className="text-[var(--muted)]">{formatDate(bounty.deadline)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--subtle)]">Est. time</span>
              <span className="text-[var(--muted)]">{bounty.estimatedMinutes} min</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--subtle)]">Task type</span>
              <span className="text-[var(--muted)]">{bounty.taskType}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--subtle)]">Onchain ID</span>
              <span className="mono text-[var(--muted)] tabular-nums">#{bounty.bountyId}</span>
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <span className="text-xs text-[var(--subtle)] block mb-1">Posted by</span>
              <span className="mono text-xs text-[var(--muted)]">{formatAddress(bounty.creator)}</span>
            </div>
          </div>

          <div className="glass rounded-xl p-5">
            <p className="text-xs text-[var(--subtle)] mb-1">Settlement network</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-[var(--ink)]">{ARC_CHAIN_NAME}</span>
            </div>
            <p className="text-xs text-[var(--subtle)] mt-1">USDC · Instant settlement</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SubmissionStatusCard({ sub, bounty, submitHash: _submitHash }: { sub: OnchainSubmission; bounty: Bounty; submitHash?: `0x${string}` }) {
  const status = SUBMISSION_STATUS_MAP[sub.status] ?? 'Pending'
  const style = SUBMISSION_STATUS_STYLES[status]
  const storedAnswer = getSubmissionAnswer(sub.submissionId.toString())

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--ink)]">Your submission</p>
        <Badge className={style.className}>{style.label}</Badge>
      </div>
      {storedAnswer && (
        <div className="bg-[var(--surface-muted)] rounded-lg p-3">
          <p className="text-xs text-[var(--subtle)] mb-1">Your answer (stored locally)</p>
          <p className="text-xs text-[var(--muted)] line-clamp-3">{storedAnswer}</p>
        </div>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--subtle)]">Submitted</span>
        <span className="text-[var(--muted)]">{formatRelativeTime(Number(sub.submittedAt))}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--subtle)]">Submission #{sub.submissionId.toString()}</span>
        <span className="mono text-[var(--muted)] truncate max-w-32">{shortHash(sub.answerRef)}</span>
      </div>
      {status === 'Approved' && !sub.rewardClaimed && (
        <div className="p-3 rounded-lg bg-emerald-400/5 border border-emerald-400/20 text-xs text-emerald-300">
          Your work was approved! Go to Worker Dashboard to claim your ${formatUSDC(bounty.rewardPerWorker)} USDC reward.
        </div>
      )}
      {status === 'Approved' && sub.rewardClaimed && (
        <div className="p-3 rounded-lg bg-emerald-400/5 border border-emerald-400/20 text-xs text-emerald-300">
          Reward claimed. Thank you for your contribution!
        </div>
      )}
    </div>
  )
}

function SubmissionReviewRow({ sub, onApprove, onReject }: {
  sub: OnchainSubmission
  onApprove: () => void
  onReject: () => void
}) {
  const status = SUBMISSION_STATUS_MAP[sub.status] ?? 'Pending'
  const style = SUBMISSION_STATUS_STYLES[status]
  const storedAnswer = getSubmissionAnswer(sub.submissionId.toString())
  const isPending = sub.status === 0

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="mono text-xs text-[var(--subtle)]">Worker: {formatAddress(sub.worker)}</p>
            <span className="text-xs text-[var(--subtle)]">· #{sub.submissionId.toString()}</span>
          </div>
          <p className="mono text-xs text-[var(--subtle)] truncate">answerRef: {shortHash(sub.answerRef)}</p>
          {storedAnswer && (
            <div className="mt-2 bg-[var(--surface-muted)] rounded p-2">
              <p className="text-xs text-[var(--muted)] line-clamp-3">{storedAnswer}</p>
            </div>
          )}
          <p className="text-xs text-[var(--subtle)] mt-1">{formatRelativeTime(Number(sub.submittedAt))}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge className={style.className}>{style.label}</Badge>
          {isPending && (
            <div className="flex gap-1.5">
              <button onClick={onApprove} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
                Approve
              </button>
              <button onClick={onReject} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
