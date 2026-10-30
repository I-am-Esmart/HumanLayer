import { useState } from 'react'
import { ArrowLeft, CheckCircle2, Info, ExternalLink } from 'lucide-react'
import { useAccount, useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import type { TaskCategory, TaskType, DifficultyLevel } from '../types'
import { Button } from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import { NetworkGuard } from '../components/NetworkGuard'
import { CATEGORY_LABELS, CATEGORY_COLORS, formatUSDC, getNowSec } from '../lib/utils'
import {
  parseUsdcAmount,
  formatUsdcRaw,
  buildTaskRef,
  storeBountyMeta,
  explorerTxUrl,
  shortHash,
  CATEGORY_INDEX,
} from '../lib/bounty-meta'
import { ARC_CHAIN_ID, ARC_CHAIN_NAME, ARC_RPC_URL, HUMANLAYER_ABI, HUMANLAYER_ADDRESS } from '../lib/contract'
import { USDC_ADDRESS } from '../hooks/useUsdcBalance'
import { parseContractError, isUserRejection } from '../lib/errors'
import type { Page } from '../App'

interface CreateBountyPageProps {
  onNavigate: (page: Page) => void
}

const CATEGORIES: TaskCategory[] = ['Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']
const TASK_TYPES: TaskType[] = ['Verify', 'Classify', 'Label', 'Compare', 'Research', 'Rate', 'Transcribe']
const DIFFICULTIES: DifficultyLevel[] = ['Easy', 'Medium', 'Hard']

type Step = 'details' | 'reward' | 'review' | 'submitting' | 'success'
const STEP_ORDER: Step[] = ['details', 'reward', 'review']

// Tx phases for the multi-step submit flow
type TxPhase =
  | 'idle'
  | 'create-pending'    // waiting for createBounty wallet confirm
  | 'create-confirming' // create tx confirming
  | 'approve-pending'   // waiting for USDC approve wallet confirm
  | 'approve-confirming'
  | 'fund-pending'      // waiting for fundBounty wallet confirm
  | 'fund-confirming'
  | 'done'

interface SuccessData {
  bountyId: bigint
  fundHash: `0x${string}`
  amountFunded: bigint
}

export function CreateBountyPage({ onNavigate }: CreateBountyPageProps) {
  const { isConnected, address } = useAccount()
  const [step, setStep] = useState<Step>('details')

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [category, setCategory] = useState<TaskCategory | ''>('')
  const [taskType, setTaskType] = useState<TaskType | ''>('')
  const [difficulty, setDifficulty] = useState<DifficultyLevel | ''>('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('30')
  const [rewardPerWorker, setRewardPerWorker] = useState('')
  const [requiredWorkers, setRequiredWorkers] = useState('3')
  const [daysUntilDeadline, setDaysUntilDeadline] = useState('7')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [txPhase, setTxPhase] = useState<TxPhase>('idle')
  const [txError, setTxError] = useState('')
  const [successData, setSuccessData] = useState<SuccessData | null>(null)

  // Computed from form
  const rewardRaw = parseUsdcAmount(rewardPerWorker)
  const workersNum = parseInt(requiredWorkers) || 0
  const totalRaw = rewardRaw * BigInt(workersNum)
  // NOTE: escrow amount = rewardPerWorker * requiredWorkers (platform fee taken on claim, not on fund)
  const escrowRaw = totalRaw
  const totalDisplayed = parseFloat(rewardPerWorker || '0') * workersNum
  const platformFeeDisplayed = totalDisplayed * 0.02

  // Contract write hooks
  const { writeContractAsync } = useWriteContract()

  // Create tx hash tracking for display
  const [createHash, setCreateHash] = useState<`0x${string}` | undefined>()
  const [_approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [_fundHash, setFundHash] = useState<`0x${string}` | undefined>()

  function validateDetails() {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Title is required'
    if (title.length > 120) e.title = 'Max 120 characters'
    if (!description.trim()) e.description = 'Description is required'
    if (!instructions.trim()) e.instructions = 'Instructions are required'
    if (!category) e.category = 'Select a category'
    if (!taskType) e.taskType = 'Select a task type'
    if (!difficulty) e.difficulty = 'Select a difficulty'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function validateReward() {
    const e: Record<string, string> = {}
    const reward = parseFloat(rewardPerWorker)
    const workers = parseInt(requiredWorkers)
    const days = parseInt(daysUntilDeadline)
    if (!rewardPerWorker || isNaN(reward) || reward <= 0) e.rewardPerWorker = 'Enter a reward amount'
    if (reward < 1) e.rewardPerWorker = 'Minimum reward is $1.00 USDC'
    if (!requiredWorkers || isNaN(workers) || workers < 1) e.requiredWorkers = 'At least 1 worker required'
    if (workers > 50) e.requiredWorkers = 'Max 50 workers per bounty'
    if (!daysUntilDeadline || isNaN(days) || days < 1) e.daysUntilDeadline = 'At least 1 day required'
    if (days > 30) e.daysUntilDeadline = 'Max 30 days'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function goNext() {
    const idx = STEP_ORDER.indexOf(step)
    if (step === 'details' && !validateDetails()) return
    if (step === 'reward' && !validateReward()) return
    if (step === 'review') {
      void handleFundAndPublish()
      return
    }
    setStep(STEP_ORDER[idx + 1])
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1])
  }

  async function handleFundAndPublish() {
    if (!address || !USDC_ADDRESS) return
    setTxError('')
    setStep('submitting')

    const deadline = getNowSec() + parseInt(daysUntilDeadline) * 86400
    const taskRefHex = buildTaskRef(title, address)

    try {
      // ── Step 1: createBounty ─────────────────────────────────────────────
      setTxPhase('create-pending')
      let createdBountyId: bigint | null = null

      const createTxHash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'createBounty',
        args: [
          CATEGORY_INDEX[category as TaskCategory],
          taskRefHex,
          workersNum,
          rewardRaw,
          BigInt(deadline),
        ],
      })
      setCreateHash(createTxHash)
      setTxPhase('create-confirming')

      // Wait for receipt and parse BountyCreated event
      const receipt = await waitForReceipt(createTxHash)
      // Parse BountyId from logs — BountyCreated is the first indexed event
      for (const log of receipt.logs) {
        try {
          // BountyCreated(uint256 indexed bountyId, ...)
          // topic[0] = event sig, topic[1] = bountyId
          if (log.topics[1]) {
            createdBountyId = BigInt(log.topics[1])
            break
          }
        } catch { /* skip */ }
      }

      if (!createdBountyId) throw new Error('Could not determine bounty ID from transaction.')

      // Store metadata offchain (session)
      storeBountyMeta(taskRefHex, {
        title,
        description,
        instructions,
        taskType: taskType as TaskType,
        difficulty: difficulty as DifficultyLevel,
        estimatedMinutes: parseInt(estimatedMinutes) || 30,
        tags: [],
        isDemoContent: false,
      })

      // ── Step 2: USDC approve ─────────────────────────────────────────────
      setTxPhase('approve-pending')
      const approveTxHash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [HUMANLAYER_ADDRESS, escrowRaw],
      })
      setApproveHash(approveTxHash)
      setTxPhase('approve-confirming')
      await waitForReceipt(approveTxHash)

      // ── Step 3: fundBounty ───────────────────────────────────────────────
      setTxPhase('fund-pending')
      const fundTxHash = await writeContractAsync({
        chainId: ARC_CHAIN_ID,
        address: HUMANLAYER_ADDRESS,
        abi: HUMANLAYER_ABI,
        functionName: 'fundBounty',
        args: [createdBountyId],
      })
      setFundHash(fundTxHash)
      setTxPhase('fund-confirming')
      await waitForReceipt(fundTxHash)

      setSuccessData({ bountyId: createdBountyId, fundHash: fundTxHash, amountFunded: escrowRaw })
      setTxPhase('done')
      setStep('success')
    } catch (err: unknown) {
      if (isUserRejection(err)) {
        setStep('review')
        setTxPhase('idle')
        toast.info('Transaction cancelled.')
        return
      }
      const msg = parseContractError(err)
      setTxError(msg)
      setTxPhase('idle')
      setStep('review')
    }
  }

  // Utility: wait for a tx receipt via fetch loop on Arc RPC
  async function waitForReceipt(hash: `0x${string}`): Promise<{ logs: { topics: string[] }[] }> {
    const rpc = ARC_RPC_URL
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      })
      const json = await res.json() as { result?: { logs: { topics: string[] }[] } | null }
      if (json.result) return json.result
    }
    throw new Error('Transaction receipt timeout. Please check the explorer.')
  }

  const submitting = step === 'submitting'

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="display text-2xl font-bold text-[var(--ink)] mb-2">Post a Bounty</h1>
        <p className="text-[var(--muted)] mb-8">
          Connect your wallet to create a bounty and fund it with USDC.
        </p>
        <ConnectKitButton label="Connect Wallet" customTheme={CK_THEME} />
      </div>
    )
  }

  if (step === 'success' && successData) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <CheckCircle2 className="w-16 h-16 mx-auto mb-6 text-emerald-400" />
        <h1 className="display text-2xl font-bold text-[var(--ink)] mb-3">Bounty live on Arc</h1>
        <p className="text-[var(--muted)] mb-6 text-pretty">
          Your bounty is onchain and fully funded. Workers can discover and submit immediately.
        </p>

        <div className="glass rounded-xl p-5 text-left space-y-3 mb-8">
          <div className="flex justify-between text-sm">
            <span className="text-[var(--subtle)]">Bounty ID</span>
            <span className="font-mono font-semibold text-[var(--ink)] tabular-nums">#{successData.bountyId.toString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--subtle)]">Amount escrowed</span>
            <span className="font-semibold text-emerald-400 tabular-nums">
              ${formatUsdcRaw(successData.amountFunded)} USDC
            </span>
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-[var(--subtle)]">Fund transaction</span>
            <a
              href={explorerTxUrl(successData.fundHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[var(--accent)] hover:underline mono text-xs"
            >
              {shortHash(successData.fundHash)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={() => onNavigate('marketplace')} size="lg">View in Marketplace</Button>
          <Button variant="ghost" onClick={() => { setStep('details'); setTitle(''); setDescription(''); setInstructions(''); setCategory(''); setTaskType(''); setDifficulty(''); setRewardPerWorker(''); setRequiredWorkers('3'); setDaysUntilDeadline('7'); setSuccessData(null); setTxPhase('idle'); }}>
            Post another bounty
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'submitting') {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center mx-auto mb-6">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
        <h1 className="display text-xl font-bold text-[var(--ink)] mb-3">{TX_PHASE_LABELS[txPhase]}</h1>
        <p className="text-[var(--muted)] text-sm text-pretty mb-6">
          {TX_PHASE_SUBLABELS[txPhase]}
        </p>

        {/* Step indicators */}
        <div className="flex justify-center gap-2">
          {(['create', 'approve', 'fund'] as const).map((phase, i) => {
            const done = txPhase === 'done' || phaseIndex(txPhase) > i
            const active = txPhase !== 'done' && Math.floor(phaseIndex(txPhase) / 2) === i
            return (
              <div key={phase} className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--accent)] text-[#0d1b2f] animate-pulse' : 'bg-[var(--surface-muted)] text-[var(--subtle)]'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className="text-xs text-[var(--subtle)]">{['Create', 'Approve', 'Fund'][i]}</span>
              </div>
            )
          })}
        </div>

        {createHash && (
          <p className="mt-6 text-xs text-[var(--subtle)]">
            Create tx:{' '}
            <a href={explorerTxUrl(createHash)} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline mono">{shortHash(createHash)}</a>
          </p>
        )}
      </div>
    )
  }

  const stepIndex = STEP_ORDER.indexOf(step)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <NetworkGuard>
        <button
          onClick={() => step === 'details' ? onNavigate('marketplace') : goBack()}
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--ink)] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 'details' ? 'Back to Marketplace' : 'Back'}
        </button>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {['Task Details', 'Reward & Timeline', 'Review & Fund'].map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div className={['w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all', stepIndex > i ? 'bg-emerald-500 text-white' : stepIndex === i ? 'bg-[var(--accent)] text-[#0d1b2f]' : 'bg-[var(--surface-muted)] text-[var(--subtle)]'].join(' ')}>
                  {stepIndex > i ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${stepIndex === i ? 'text-[var(--ink)] font-medium' : 'text-[var(--subtle)]'}`}>
                  {label}
                </span>
              </div>
              {i < 2 && <div className={`flex-1 h-px ${stepIndex > i ? 'bg-emerald-500/40' : 'bg-[var(--border)]'}`} />}
            </div>
          ))}
        </div>

        {txError && (
          <div className="mb-4 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-sm text-red-300">
            {txError}
          </div>
        )}

        <div className="glass rounded-xl p-6">
          {step === 'details' && (
            <div className="space-y-5">
              <div>
                <h2 className="display text-xl font-bold text-[var(--ink)] mb-1">Task Details</h2>
                <p className="text-sm text-[var(--muted)]">Describe the task clearly so workers know what to do.</p>
              </div>

              <Input label="Title" placeholder="e.g. Verify protein structure annotations" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} maxLength={120} />
              <Textarea label="Short Description" placeholder="2–3 sentence summary" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
              <Textarea label="Full Instructions" placeholder="Step-by-step instructions. Be specific about format, length, quality expectations, and deliverables." rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} error={errors.instructions} />

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Category {errors.category && <span className="text-red-400 ml-2 normal-case font-normal">{errors.category}</span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CATEGORIES.map((c) => (
                    <button key={c} type="button" onClick={() => setCategory(c)}
                      className={['px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border', category === c ? 'border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]'].join(' ')}>
                      <span style={{ color: category === c ? CATEGORY_COLORS[c] : undefined }}>{CATEGORY_LABELS[c]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Task Type {errors.taskType && <span className="text-red-400 ml-2 normal-case font-normal">{errors.taskType}</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  {TASK_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => setTaskType(t)}
                      className={['px-3 py-1.5 rounded-lg text-xs font-medium transition-all border', taskType === t ? 'border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]'].join(' ')}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Difficulty {errors.difficulty && <span className="text-red-400 ml-2 normal-case font-normal">{errors.difficulty}</span>}
                </p>
                <div className="flex gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button key={d} type="button" onClick={() => setDifficulty(d)}
                      className={['px-4 py-2 rounded-lg text-xs font-medium transition-all border flex-1', difficulty === d ? 'border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)]'].join(' ')}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <Input label="Estimated Time (minutes)" type="number" min="5" max="480" placeholder="30" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} />
            </div>
          )}

          {step === 'reward' && (
            <div className="space-y-5">
              <div>
                <h2 className="display text-xl font-bold text-[var(--ink)] mb-1">Reward & Timeline</h2>
                <p className="text-sm text-[var(--muted)]">Set the USDC reward and bounty duration.</p>
              </div>

              <Input label="Reward per Worker (USDC)" type="number" min="1" step="0.01" placeholder="10.00" value={rewardPerWorker} onChange={(e) => setRewardPerWorker(e.target.value)} prefix="$" suffix="USDC" error={errors.rewardPerWorker} hint="Amount paid to each approved worker (net of 2% platform fee)" />
              <Input label="Number of Workers Required" type="number" min="1" max="50" placeholder="3" value={requiredWorkers} onChange={(e) => setRequiredWorkers(e.target.value)} error={errors.requiredWorkers} hint="Bounty closes after this many workers are approved" />
              <Input label="Deadline (days from now)" type="number" min="1" max="30" placeholder="7" value={daysUntilDeadline} onChange={(e) => setDaysUntilDeadline(e.target.value)} error={errors.daysUntilDeadline} />

              {totalDisplayed > 0 && (
                <div className="bg-[var(--surface-muted)] rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-3">Cost Breakdown</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Worker rewards ({requiredWorkers} × ${formatUSDC(parseFloat(rewardPerWorker) || 0)})</span>
                    <span className="text-[var(--ink)] font-medium tabular-nums">${formatUSDC(totalDisplayed)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Platform fee (2%, deducted on claim)</span>
                    <span className="text-[var(--ink)]/50 tabular-nums text-xs">not charged upfront</span>
                  </div>
                  <div className="border-t border-[var(--border)] pt-2 flex justify-between">
                    <span className="text-sm font-semibold text-[var(--ink)]">Amount to approve & escrow</span>
                    <span className="text-sm font-bold text-[var(--accent)] tabular-nums">${formatUSDC(totalDisplayed)} USDC</span>
                  </div>
                  <p className="text-xs text-[var(--subtle)] mt-1">
                    Workers receive {formatUSDC(totalDisplayed - platformFeeDisplayed)} USDC total net. Platform fee is deducted when each reward is claimed.
                  </p>
                </div>
              )}

              <div className="flex items-start gap-2 p-3 bg-[var(--accent)]/5 border border-[var(--accent)]/15 rounded-lg">
                <Info className="w-4 h-4 text-[var(--accent)] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Funds are held in USDC escrow on the HumanLayer smart contract on {ARC_CHAIN_NAME} and released only when you approve a submission.
                </p>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              <div>
                <h2 className="display text-xl font-bold text-[var(--ink)] mb-1">Review & Fund</h2>
                <p className="text-sm text-[var(--muted)]">Confirm the details. Three wallet transactions will follow.</p>
              </div>

              <div className="divide-y divide-[var(--border)]">
                <ReviewRow label="Title" value={title} />
                <ReviewRow label="Category" value={CATEGORY_LABELS[category as TaskCategory] ?? category} />
                <ReviewRow label="Task type" value={taskType} />
                <ReviewRow label="Difficulty" value={difficulty} />
                <ReviewRow label="Est. time" value={`${estimatedMinutes} min`} />
                <ReviewRow label="Reward/worker" value={`$${formatUSDC(parseFloat(rewardPerWorker))} USDC`} />
                <ReviewRow label="Workers needed" value={requiredWorkers} />
                <ReviewRow label="Deadline" value={`${daysUntilDeadline} day${parseInt(daysUntilDeadline) !== 1 ? 's' : ''}`} />
                <ReviewRow label="Amount to escrow" value={`$${formatUsdcRaw(escrowRaw)} USDC`} highlight />
              </div>

              <div className="space-y-2 p-3 bg-[var(--surface-muted)] rounded-lg">
                <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider">3 wallet transactions</p>
                <ol className="space-y-1.5">
                  {['Create bounty onchain', 'Approve USDC transfer to escrow', 'Fund escrow contract'].map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="w-4 h-4 rounded-full bg-[var(--surface-strong)] text-[var(--subtle)] flex items-center justify-center text-xs flex-shrink-0">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-6 pt-5 border-t border-[var(--border)]">
            <Button variant="ghost" onClick={step === 'details' ? () => onNavigate('marketplace') : goBack}>
              {step === 'details' ? 'Cancel' : 'Back'}
            </Button>
            <Button onClick={goNext} loading={submitting} size="md">
              {step === 'details' && 'Continue'}
              {step === 'reward' && 'Continue'}
              {step === 'review' && 'Fund & Publish'}
            </Button>
          </div>
        </div>
      </NetworkGuard>
    </div>
  )
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-xs text-[var(--subtle)]">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}>{value}</span>
    </div>
  )
}

const TX_PHASE_LABELS: Record<TxPhase, string> = {
  idle: '',
  'create-pending': 'Confirm in wallet',
  'create-confirming': 'Creating bounty…',
  'approve-pending': 'Approve USDC in wallet',
  'approve-confirming': 'Approving USDC…',
  'fund-pending': 'Confirm funding in wallet',
  'fund-confirming': 'Funding escrow…',
  done: 'Complete',
}

const TX_PHASE_SUBLABELS: Record<TxPhase, string> = {
  idle: '',
  'create-pending': 'Sign the createBounty transaction in your wallet.',
  'create-confirming': `Waiting for on-chain confirmation on ${ARC_CHAIN_NAME}…`,
  'approve-pending': 'Sign the USDC approval to allow the contract to receive your funds.',
  'approve-confirming': 'Waiting for USDC approval confirmation…',
  'fund-pending': 'Sign the fundBounty transaction to transfer USDC into escrow.',
  'fund-confirming': 'Transferring USDC to the HumanLayer escrow contract…',
  done: 'All transactions confirmed.',
}

function phaseIndex(phase: TxPhase): number {
  const order: TxPhase[] = ['create-pending', 'create-confirming', 'approve-pending', 'approve-confirming', 'fund-pending', 'fund-confirming']
  return order.indexOf(phase)
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
