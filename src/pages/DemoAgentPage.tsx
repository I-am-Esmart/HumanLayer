/**
 * Demo Research Agent panel.
 *
 * This page simulates what an autonomous AI agent would do with the
 * HumanLayer platform. ALL interactions shown here are SIMULATED —
 * no real onchain transactions are sent and no backend is required.
 *
 * The panel is clearly labelled as a demo throughout.
 */
import { useState } from 'react'
import { Bot, Coins, CheckCircle2, Clock, ArrowRight, Loader2, AlertTriangle, Zap, FileText, Users, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import type { AgentBountyFormat } from '../lib/api'
import { ARC_CHAIN_NAME } from '../lib/contract'
import type { Page } from '../App'

interface DemoAgentPageProps {
  onNavigate: (page: Page) => void
}

type Step =
  | { id: 'idle' }
  | { id: 'discovering' }
  | { id: 'discovered'; bounties: AgentBountyFormat[] }
  | { id: 'creating' }
  | { id: 'created'; bounty: AgentBountyFormat }
  | { id: 'waiting'; bounty: AgentBountyFormat }
  | { id: 'reviewing'; bounty: AgentBountyFormat; submissionCount: number }
  | { id: 'approving'; bounty: AgentBountyFormat }
  | { id: 'done'; bounty: AgentBountyFormat }

/* ---------- static demo data (no backend required) ---------- */

const DEMO_AGENT = {
  name: 'Research Verification Agent',
  reputation: 94,
  supported_categories: ['Research', 'Science', 'BiologyMedicine'],
  tasks_created: 12,
  spending_summary: {
    budget_usdc: '500.00',
    total_funded_usdc: '18.00',
    remaining_budget_usdc: '482.00',
  },
}

const DEMO_OPEN_BOUNTIES: AgentBountyFormat[] = [
  {
    id: 'demo-1', onchain_id: 1, category: 'Research', task_type: 'Verify',
    title: 'Verify mRNA Vaccine Efficacy Data', description: 'Cross-check published trial data.',
    instructions: '', reward_usdc: '2.00', reward_raw: '2000000', required_workers: 3,
    accepted_workers: 0, deadline_iso: new Date(Date.now() + 3 * 86400_000).toISOString(),
    deadline_unix: Math.floor(Date.now() / 1000) + 3 * 86400, required_reputation: 50,
    status: 'OPEN', creator_address: '0xA1B2…C3D4', task_ref: '0xaabb', total_funded_usdc: '6.00',
    tags: ['biology', 'medicine'], difficulty: 'Hard', estimated_minutes: 45,
  },
  {
    id: 'demo-2', onchain_id: 2, category: 'Research', task_type: 'Compare',
    title: 'Compare Protein Folding Simulations', description: 'Compare AlphaFold vs RoseTTAFold predictions.',
    instructions: '', reward_usdc: '1.50', reward_raw: '1500000', required_workers: 2,
    accepted_workers: 1, deadline_iso: new Date(Date.now() + 7 * 86400_000).toISOString(),
    deadline_unix: Math.floor(Date.now() / 1000) + 7 * 86400, required_reputation: 30,
    status: 'OPEN', creator_address: '0xE5F6…G7H8', task_ref: '0xccdd', total_funded_usdc: '3.00',
    tags: ['research', 'ai'], difficulty: 'Medium', estimated_minutes: 30,
  },
  {
    id: 'demo-3', onchain_id: 3, category: 'Research', task_type: 'Verify',
    title: 'Fact-check Climate Model Paper', description: 'Verify citations and methodology.',
    instructions: '', reward_usdc: '1.00', reward_raw: '1000000', required_workers: 2,
    accepted_workers: 0, deadline_iso: new Date(Date.now() + 5 * 86400_000).toISOString(),
    deadline_unix: Math.floor(Date.now() / 1000) + 5 * 86400, required_reputation: 20,
    status: 'OPEN', creator_address: '0xI9J0…K1L2', task_ref: '0xeeff', total_funded_usdc: '2.00',
    tags: ['research', 'climate'], difficulty: 'Easy', estimated_minutes: 20,
  },
]

const DEMO_BOUNTY: AgentBountyFormat = {
  id: 'demo-bounty-sim', onchain_id: 999, category: 'Research', task_type: 'Verify',
  title: 'Verify Protein Folding Study (DEMO)', description: 'Simulated demo bounty — not posted onchain.',
  instructions: 'Cross-check the methodology against 3 independent sources.',
  reward_usdc: '1.500000', reward_raw: '1500000', required_workers: 2, accepted_workers: 0,
  deadline_iso: new Date(Date.now() + 5 * 86400_000).toISOString(),
  deadline_unix: Math.floor(Date.now() / 1000) + 5 * 86400, required_reputation: 0,
  status: 'OPEN', creator_address: '0x0000000000000000000000000000000000000001',
  task_ref: '0xdemo', total_funded_usdc: '3.000000',
  tags: ['research', 'science', 'biology'], difficulty: 'Medium', estimated_minutes: 30,
}

/* ------------------------------------------------------------ */

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={[
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors',
            i < current
              ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
              : i === current
              ? 'bg-[var(--accent)]/15 border-[var(--accent)]/30 text-[var(--accent)]'
              : 'bg-[var(--surface-muted)] border-[var(--border)] text-[var(--subtle)]',
          ].join(' ')}>
            {i < current && <CheckCircle2 className="w-3 h-3" />}
            {i === current && <Loader2 className="w-3 h-3 animate-spin" />}
            {label}
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="w-3 h-3 text-[var(--border)] flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  )
}

const DEMO_STEPS = [
  'Discover bounties',
  'Validate creation',
  'Create bounty',
  'Wait for humans',
  'Review submission',
  'Approve + pay',
]

export function DemoAgentPage({ onNavigate }: DemoAgentPageProps) {
  const [step, setStep] = useState<Step>({ id: 'idle' })
  const [log, setLog] = useState<string[]>([])

  function addLog(msg: string) {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  async function runDemo() {
    setLog([])

    // Step 1: Discover (uses local demo data — no API call)
    setStep({ id: 'discovering' })
    addLog('Agent: scanning HumanLayer marketplace for open Research tasks…')
    await sleep(900)
    addLog(`Agent: found ${DEMO_OPEN_BOUNTIES.length} open Research bounties on ${ARC_CHAIN_NAME}.`)
    setStep({ id: 'discovered', bounties: DEMO_OPEN_BOUNTIES })
    await sleep(800)

    // Step 2: Validate / create intent (simulated spending check)
    setStep({ id: 'creating' })
    addLog('Agent: generating new research verification task…')
    await sleep(600)
    addLog('Agent: pre-flighting bounty creation against spending limits…')
    await sleep(500)
    addLog('Agent: reward $1.50 ≤ per-task max $5.00 — OK')
    addLog('Agent: daily spend $1.50 + $18.00 = $19.50 ≤ daily limit $50.00 — OK')
    addLog('Agent: remaining budget $482.00 ≥ $3.00 total escrow — OK')
    addLog('Agent: spending check PASSED.')
    addLog('Agent: returned 3-step onchain transaction sequence (createBounty → approveUSDC → fundBounty).')
    addLog(`DEMO NOTE: in a real deployment the agent wallet would sign and submit these transactions on ${ARC_CHAIN_NAME}.`)
    await sleep(700)

    setStep({ id: 'created', bounty: DEMO_BOUNTY })
    await sleep(1000)

    // Step 3: Wait for humans
    setStep({ id: 'waiting', bounty: DEMO_BOUNTY })
    addLog('Agent: bounty is OPEN. Polling for human submissions…')
    await sleep(1200)
    addLog('Agent: 0 submissions yet. Waiting…')
    await sleep(1400)
    addLog('Agent: 1 new submission detected from worker 0xD4e5…d2e3')

    setStep({ id: 'reviewing', bounty: DEMO_BOUNTY, submissionCount: 1 })
    await sleep(900)

    // Step 4: Review
    addLog('Agent: reading submission answer_ref from contract…')
    await sleep(600)
    addLog('Agent: fetching answer from IPFS ref 0xaabb…8899')
    await sleep(500)
    addLog('Agent: answer quality check PASSED (meets task criteria, 3 valid citations found).')

    // Step 5: Approve
    setStep({ id: 'approving', bounty: DEMO_BOUNTY })
    addLog('Agent: calling approveSubmission(submissionId) on the smart contract…')
    await sleep(800)
    addLog(`DEMO NOTE: in a real deployment this would submit a signed transaction to ${ARC_CHAIN_NAME}.`)
    addLog('Agent: submission approved. Contract releases 1.50 USDC reward to worker.')
    addLog('Agent: platform fee (2%) = $0.03 USDC accrued. Worker receives $1.47 USDC.')

    setStep({ id: 'done', bounty: DEMO_BOUNTY })
    addLog('Agent: task lifecycle complete. ✓')
  }

  const stepIndex: Record<Step['id'], number> = {
    idle: -1, discovering: 0, discovered: 0,
    creating: 1, created: 2, waiting: 3,
    reviewing: 4, approving: 5, done: 5,
  }

  const currentStepIdx = stepIndex[step.id]

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8 flex-wrap">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-6 h-6 text-[var(--accent)]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="display text-2xl font-bold text-[var(--ink)]">Research Verification Agent</h1>
            <Badge className="text-amber-400 bg-amber-400/10 border-amber-400/20 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> SIMULATED DEMO
            </Badge>
          </div>
          <p className="text-[var(--muted)] text-sm max-w-2xl">
            This panel shows how an AI agent would programmatically interact with HumanLayer.
            All interactions here are simulated — no real onchain transactions are submitted.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: agent profile (static demo data) */}
        <div className="space-y-4">
          <div className="glass rounded-xl p-5">
            <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-4">Agent Profile</p>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[var(--subtle)]">Name</p>
                <p className="text-sm font-medium text-[var(--ink)]">{DEMO_AGENT.name}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--subtle)]">Reputation</p>
                <p className="display text-2xl font-bold text-emerald-400">{DEMO_AGENT.reputation}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--subtle)]">Categories</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {DEMO_AGENT.supported_categories.map((c) => (
                    <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--muted)]">{c}</span>
                  ))}
                </div>
              </div>
              <div className="border-t border-[var(--border)] pt-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--subtle)]">Budget</span>
                  <span className="font-medium text-[var(--ink)]">${DEMO_AGENT.spending_summary.budget_usdc}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--subtle)]">Funded</span>
                  <span className="font-medium text-amber-400">${DEMO_AGENT.spending_summary.total_funded_usdc}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--subtle)]">Remaining</span>
                  <span className="font-medium text-emerald-400">${DEMO_AGENT.spending_summary.remaining_budget_usdc}</span>
                </div>
                <div className="h-1.5 bg-[var(--surface-muted)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full"
                    style={{
                      width: `${Math.min(100, (parseFloat(DEMO_AGENT.spending_summary.total_funded_usdc) / parseFloat(DEMO_AGENT.spending_summary.budget_usdc)) * 100)}%`
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Coins className="w-3.5 h-3.5 text-[var(--subtle)]" />
                <span className="text-xs text-[var(--muted)]">{DEMO_AGENT.tasks_created} tasks created</span>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider">Spending Limits</p>
            {[
              { label: 'Per-task max', value: '$5.00' },
              { label: 'Daily limit', value: '$50.00' },
              { label: 'Total budget', value: '$500.00' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-[var(--subtle)]">{label}</span>
                <span className="font-medium text-[var(--ink)]">{value}</span>
              </div>
            ))}
          </div>

          {/* Static API code sample */}
          <div className="glass rounded-xl p-4">
            <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-3">Example API call</p>
            <pre className="mono text-xs text-[var(--muted)] bg-[var(--surface-muted)] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">{`POST /api/bounties
Authorization: Bearer <api_key>

{
  "title": "Verify Study",
  "category": "Research",
  "task_type": "Verify",
  "reward_usdc": "1.50",
  "required_workers": 2,
  "days_until_deadline": 5
}`}</pre>
          </div>
        </div>

        {/* Right: demo runner */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <p className="text-sm font-semibold text-[var(--ink)]">Agent lifecycle simulation</p>
              <div className="flex gap-2">
                {step.id !== 'idle' && step.id !== 'done' && (
                  <Button variant="ghost" size="sm" disabled>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Running…
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => { void runDemo() }}
                  disabled={step.id !== 'idle' && step.id !== 'done'}
                >
                  <Zap className="w-3.5 h-3.5" />
                  {step.id === 'done' ? 'Run again' : 'Run demo'}
                </Button>
              </div>
            </div>

            {currentStepIdx >= 0 && (
              <div className="mb-5">
                <StepIndicator steps={DEMO_STEPS} current={currentStepIdx} />
              </div>
            )}

            {step.id === 'idle' && (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                <Bot className="w-10 h-10 mx-auto mb-3 text-[var(--accent)]/30" />
                Click "Run demo" to simulate the full agent lifecycle: discover → create → wait → approve → pay.
              </div>
            )}

            {step.id === 'discovered' && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--subtle)] mb-2">Open Research bounties found on {ARC_CHAIN_NAME}:</p>
                {step.bounties.slice(0, 3).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-[var(--surface-muted)] rounded-lg text-xs">
                    <span className="font-medium text-[var(--ink)] flex-1 truncate">{b.title}</span>
                    <span className="text-emerald-400 font-semibold">${b.reward_usdc}</span>
                    <Badge className="text-emerald-400 bg-emerald-400/10 border-emerald-400/20">{b.status}</Badge>
                  </div>
                ))}
              </div>
            )}

            {(step.id === 'created' || step.id === 'waiting') && (
              <div className="p-4 bg-[var(--surface-muted)] rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-sm font-medium text-[var(--ink)]">{step.bounty.title}</span>
                  <Badge className="text-amber-400 bg-amber-400/10 border-amber-400/20 text-xs">DEMO</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div><span className="text-[var(--subtle)]">Reward</span><p className="font-semibold text-[var(--ink)]">${step.bounty.reward_usdc} × {step.bounty.required_workers}</p></div>
                  <div><span className="text-[var(--subtle)]">Category</span><p className="font-semibold text-[var(--ink)]">{step.bounty.category}</p></div>
                  <div><span className="text-[var(--subtle)]">Status</span><p className="font-semibold text-emerald-400">OPEN</p></div>
                </div>
                {step.id === 'waiting' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <Clock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                    Waiting for human workers to submit…
                  </div>
                )}
              </div>
            )}

            {step.id === 'reviewing' && (
              <div className="p-4 bg-[var(--surface-muted)] rounded-lg space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-400">{step.submissionCount} submission received!</span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-[var(--subtle)]">Worker</span><span className="mono text-[var(--muted)]">0xD4e5…d2e3</span></div>
                  <div className="flex justify-between"><span className="text-[var(--subtle)]">Answer ref</span><span className="mono text-[var(--muted)]">0xaabb…8899</span></div>
                  <div className="flex justify-between"><span className="text-[var(--subtle)]">Worker reputation</span><span className="font-semibold text-emerald-400">98</span></div>
                  <div className="flex justify-between"><span className="text-[var(--subtle)]">Status</span><span className="text-amber-400">PENDING review</span></div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                  Agent evaluating submission…
                </div>
              </div>
            )}

            {(step.id === 'approving' || step.id === 'done') && (
              <div className="p-4 bg-[var(--surface-muted)] rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`w-4 h-4 ${step.id === 'done' ? 'text-emerald-400' : 'text-[var(--accent)] animate-pulse'}`} />
                  <span className={`text-sm font-medium ${step.id === 'done' ? 'text-emerald-400' : 'text-[var(--ink)]'}`}>
                    {step.id === 'done' ? 'Payment complete!' : 'Approving submission…'}
                  </span>
                </div>
                {step.id === 'done' && (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-[var(--subtle)]">Gross reward</span><span className="font-semibold text-[var(--ink)]">$1.50 USDC</span></div>
                    <div className="flex justify-between"><span className="text-[var(--subtle)]">Platform fee (2%)</span><span className="text-[var(--muted)]">−$0.03 USDC</span></div>
                    <div className="flex justify-between border-t border-[var(--border)] pt-1.5"><span className="font-semibold text-[var(--ink)]">Worker receives</span><span className="font-bold text-emerald-400">$1.47 USDC</span></div>
                    <div className="flex justify-between"><span className="text-[var(--subtle)]">Settlement</span><span className="text-[var(--muted)]">{ARC_CHAIN_NAME} · instant finality</span></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activity log */}
          {log.length > 0 && (
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider">Agent log</p>
                <Button variant="ghost" size="sm" onClick={() => setLog([])}>
                  <RefreshCw className="w-3 h-3" />
                  Clear
                </Button>
              </div>
              <div className="p-4 max-h-52 overflow-y-auto space-y-1">
                {log.map((line, i) => (
                  <p key={i} className="mono text-xs text-[var(--muted)] leading-relaxed">{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Navigation shortcuts */}
          <div className="glass rounded-xl p-4 flex flex-wrap gap-3">
            <Button variant="outline" size="sm" onClick={() => onNavigate('api-docs')}>
              API Documentation
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('api-playground')}>
              API Playground
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('worker-discovery')}>
              Discover Workers
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
