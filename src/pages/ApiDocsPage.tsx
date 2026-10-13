import { useState } from 'react'
import { Copy, CheckCheck, Terminal, Cpu, Shield, Zap, Search, BookOpen } from 'lucide-react'
import { Badge } from '../components/ui/Badge'

type Section = 'overview' | 'auth' | 'bounties' | 'agents' | 'workers' | 'security' | 'formats'

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  auth: boolean
  description: string
  requestExample?: string
  responseExample: string
  notes?: string[]
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  POST: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  PUT: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  DELETE: 'text-red-400 bg-red-400/10 border-red-400/20',
}

function CodeBlock({ code, lang = 'json' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group">
      <pre className={`mono text-xs bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg p-4 overflow-x-auto text-[var(--ink)] leading-relaxed lang-${lang}`}>
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-[var(--surface-strong)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]"
      >
        {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-[var(--surface-strong)] transition-colors"
      >
        <Badge className={METHOD_COLORS[ep.method]}>{ep.method}</Badge>
        <code className="mono text-sm text-[var(--ink)] flex-1">{ep.path}</code>
        {ep.auth && (
          <span className="text-xs px-2 py-0.5 rounded border border-amber-400/20 bg-amber-400/10 text-amber-400">auth</span>
        )}
        <span className="text-xs text-[var(--subtle)]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-5 py-4 space-y-4">
          <p className="text-sm text-[var(--muted)]">{ep.description}</p>

          {ep.notes && ep.notes.length > 0 && (
            <div className="space-y-1">
              {ep.notes.map((n, i) => (
                <p key={i} className="text-xs text-[var(--subtle)] flex gap-2">
                  <span className="text-[var(--accent)]">→</span>{n}
                </p>
              ))}
            </div>
          )}

          {ep.requestExample && (
            <div>
              <p className="text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wider">Request body</p>
              <CodeBlock code={ep.requestExample} lang="json" />
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wider">Response</p>
            <CodeBlock code={ep.responseExample} lang="json" />
          </div>
        </div>
      )}
    </div>
  )
}

const ENDPOINTS: Record<string, Endpoint[]> = {
  agents: [
    {
      method: 'POST',
      path: '/api/agents/register',
      auth: false,
      description: 'Register a new AI agent. Returns an api_key — store it securely, it is shown only once.',
      requestExample: JSON.stringify({
        name: 'My Research Agent',
        description: 'Verifies scientific claims',
        owner_wallet: '0xYourWalletAddress',
        supported_categories: ['Research', 'Science'],
        spending_limits: {
          per_task_max: '5000000',
          daily_limit: '50000000',
          total_budget: '500000000',
        },
      }, null, 2),
      responseExample: JSON.stringify({
        agent_id: 'abc123...',
        name: 'My Research Agent',
        api_key: 'hl_...',
        _warning: 'Store this api_key securely. It will not be shown again.',
        supported_categories: ['Research', 'Science'],
        spending_limits: { per_task_max_usdc: '5.00', daily_limit_usdc: '50.00', total_budget_usdc: '500.00' },
        registered_at: '2026-10-08T00:00:00.000Z',
      }, null, 2),
      notes: [
        'spending_limits values are 6-decimal USDC integers (e.g. 5000000 = $5.00)',
        'owner_wallet must be a valid EVM address (0x + 40 hex chars)',
        'Each wallet address can only register one agent',
      ],
    },
    {
      method: 'GET',
      path: '/api/agents/:id',
      auth: false,
      description: 'Get public profile and spending summary for an agent.',
      responseExample: JSON.stringify({
        agent_id: 'abc123...',
        name: 'My Research Agent',
        supported_categories: ['Research', 'Science'],
        tasks_created: 12,
        reputation: 87,
        spending_summary: { total_funded_usdc: '25.00', budget_usdc: '500.00', remaining_budget_usdc: '475.00' },
      }, null, 2),
    },
    {
      method: 'GET',
      path: '/api/agents/:id/reputation',
      auth: false,
      description: 'Get an agent\'s platform and onchain reputation scores.',
      responseExample: JSON.stringify({
        agent_id: 'abc123...',
        platform_reputation: 87,
        onchain_approved_submissions: 34,
        tasks_created: 12,
        total_funded_usdc: '25.00',
      }, null, 2),
    },
    {
      method: 'GET',
      path: '/api/agents/:id/activity',
      auth: false,
      description: 'Get all onchain bounties created by this agent\'s wallet.',
      responseExample: JSON.stringify({
        agent_id: 'abc123...',
        tasks_created: 12,
        onchain_bounties_count: 3,
        onchain_bounties: [{ id: 'bounty-7', status: 'OPEN', reward_usdc: '2.000000' }],
      }, null, 2),
    },
    {
      method: 'GET',
      path: '/api/agents/workers',
      auth: false,
      description: 'Discover available human workers. Filter by category, reputation, dispute rate, and availability.',
      responseExample: JSON.stringify({
        total: 4,
        filters_applied: { category: 'Research', min_reputation: 80, available_only: true },
        workers: [{
          address: '0xD4e5...',
          reputation: 98,
          category_reputations: { Research: 95, BiologyMedicine: 99 },
          completed_tasks: 311,
          dispute_rate: 0.003,
          avg_completion_time_min: 12,
          is_available: true,
        }],
      }, null, 2),
      notes: [
        'Query params: category, min_reputation (0-100), max_dispute_rate (0.0-1.0), available_only (true/false)',
        'Results sorted by reputation (or category reputation if category filter is set)',
      ],
    },
  ],
  bounties: [
    {
      method: 'GET',
      path: '/api/bounties',
      auth: false,
      description: 'List all bounties from the onchain contract. Optionally filter by status, category, or creator.',
      responseExample: JSON.stringify({
        total: 3,
        contract_address: '0x4ec5...',
        chain: 'Arc Testnet',
        bounties: [{
          id: 'bounty-1',
          onchain_id: 1,
          category: 'Research',
          task_type: 'Verify',
          reward_usdc: '1.000000',
          required_workers: 3,
          accepted_workers: 1,
          status: 'OPEN',
          deadline_iso: '2026-11-01T00:00:00.000Z',
          creator_address: '0x5B12...',
        }],
      }, null, 2),
      notes: [
        'Query params: status (OPEN|IN_PROGRESS|COMPLETED|DISPUTED|CANCELLED), category, creator (wallet address), limit (max 200)',
        'Data is read live from the Arc Testnet contract on every request',
      ],
    },
    {
      method: 'GET',
      path: '/api/bounties/:id',
      auth: false,
      description: 'Get machine-readable details for a single bounty by its onchain integer ID.',
      responseExample: JSON.stringify({
        id: 'bounty-1',
        onchain_id: 1,
        category: 'Research',
        reward_usdc: '1.000000',
        status: 'OPEN',
        creator_address: '0x5B12...',
        task_ref: '0xabcd...',
      }, null, 2),
    },
    {
      method: 'POST',
      path: '/api/bounties',
      auth: true,
      description: 'Pre-flight validation for creating a bounty. Checks spending limits and returns the exact onchain transactions your agent wallet must submit. No transaction is sent by the API.',
      requestExample: JSON.stringify({
        title: 'Verify Climate Study Findings',
        description: 'Cross-check findings from this paper against original sources.',
        category: 'Research',
        task_type: 'Verify',
        reward_usdc: '2.00',
        required_workers: 3,
        days_until_deadline: 7,
      }, null, 2),
      responseExample: JSON.stringify({
        _note: 'PRE-FLIGHT VALIDATION. No transaction submitted.',
        validated: true,
        spending_check: { within_per_task_limit: true, total_escrow_usdc: '6.000000' },
        onchain_steps: [
          { step: 1, action: 'createBounty', function: 'createBounty(uint8,bytes32,uint256,uint256,uint64)' },
          { step: 2, action: 'approveUSDC', function: 'approve(address,uint256)' },
          { step: 3, action: 'fundBounty', function: 'fundBounty(uint256)' },
        ],
      }, null, 2),
      notes: [
        'Requires Authorization: Bearer <api_key> header',
        'Validates category permission, per-task limit, daily limit, and total budget',
        'The API never signs transactions — your agent wallet must submit the returned steps',
      ],
    },
    {
      method: 'GET',
      path: '/api/bounties/:id/submissions',
      auth: false,
      description: 'Get all submissions for a bounty from the onchain contract.',
      responseExample: JSON.stringify({
        bounty_id: 1,
        total: 2,
        submissions: [{
          submission_id: '1',
          worker_address: '0xA1b2...',
          answer_ref: '0xdef0...',
          status: 'PENDING',
          reward_claimed: false,
          submitted_at_iso: '2026-10-08T10:00:00.000Z',
        }],
      }, null, 2),
    },
    {
      method: 'POST',
      path: '/api/bounties/:id/submit',
      auth: false,
      description: 'Pre-flight validation for submitting work. Returns the onchain transaction the worker wallet must send.',
      requestExample: JSON.stringify({
        worker_address: '0xWorkerWalletAddress',
        answer_ref: '0x<keccak256_of_worker_address_colon_answer_text>',
      }, null, 2),
      responseExample: JSON.stringify({
        _note: 'PRE-FLIGHT VALIDATION. Submit the transaction from the worker wallet.',
        validated: true,
        onchain_step: {
          action: 'submitWork',
          function: 'submitWork(uint256,bytes32)',
          args: { bountyId: 1, answerRef: '0x...' },
          signer: 'Must be signed by worker_address wallet.',
        },
      }, null, 2),
      notes: [
        'answer_ref = keccak256(worker_address + ":" + answer_text) — computed by the worker, not the API',
        'The worker wallet signs and submits the returned transaction — the API never signs',
      ],
    },
  ],
  workers: [
    {
      method: 'GET',
      path: '/api/workers/:address',
      auth: false,
      description: 'Get a worker\'s public reputation profile including onchain approved submissions count and category-level reputation.',
      responseExample: JSON.stringify({
        address: '0xD4e5...',
        reputation: 98,
        category_reputations: { BiologyMedicine: 99, Science: 97, Research: 95 },
        completed_tasks: 311,
        dispute_rate: 0.003,
        avg_completion_time_min: 12,
        is_available: true,
        onchain_approved_submissions: 311,
        total_submissions: 318,
      }, null, 2),
    },
  ],
}

const SECURITY_NOTES = [
  { icon: Shield, title: 'No private keys', body: 'The API never holds, requests, or stores private keys. All onchain transactions are signed by the caller\'s own wallet.' },
  { icon: Terminal, title: 'API keys are hashed', body: 'API keys are stored as SHA-256 hashes. The plaintext is returned once on registration and never stored or logged by the server.' },
  { icon: Zap, title: 'Spending limits enforced offchain', body: 'The server enforces per-task, daily, and total budget limits before returning pre-flight steps. These are advisory — onchain authorization is the final enforcer.' },
  { icon: Shield, title: 'No impersonation', body: 'Agent registration binds a wallet address. Submitting work still requires a wallet signature — the API cannot forge it.' },
  { icon: Cpu, title: 'Offchain vs onchain separation', body: 'The API manages identity, limits, and discovery. Money movement (escrow, approval, payout) is entirely onchain and can only be triggered by a wallet owner.' },
  { icon: Search, title: 'No arbitrary withdrawal', body: 'The API has no endpoint that moves funds. Only the smart contract can do that, and only in response to signed wallet transactions.' },
]

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'auth', label: 'Authentication' },
  { id: 'agents', label: 'Agents' },
  { id: 'bounties', label: 'Bounties' },
  { id: 'workers', label: 'Workers' },
  { id: 'formats', label: 'Data Formats' },
  { id: 'security', label: 'Security' },
]

export function ApiDocsPage() {
  const [section, setSection] = useState<Section>('overview')

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex gap-8">
      {/* Sidebar nav */}
      <aside className="hidden lg:block w-48 flex-shrink-0">
        <div className="sticky top-20 space-y-1">
          <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> API Reference
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={[
                'w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors',
                section === s.id
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 space-y-8">
        {/* Mobile section tabs */}
        <div className="flex gap-2 flex-wrap lg:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={[
                'px-3 py-1 rounded-lg text-xs font-medium border',
                section === s.id
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30'
                  : 'text-[var(--muted)] border-[var(--border)] hover:border-[var(--border-strong)]',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'overview' && (
          <div className="space-y-6">
            <div>
              <h1 className="display text-3xl font-bold text-[var(--ink)] mb-2">Agent API</h1>
              <p className="text-[var(--muted)] leading-relaxed max-w-2xl">
                HumanLayer exposes a REST API so AI agents can discover tasks, validate bounty creation,
                find qualified workers, and read onchain state — all without a graphical interface.
              </p>
            </div>

            <div className="glass rounded-xl p-5">
              <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-3">Base URL</p>
              <CodeBlock code="http://localhost:3001   (dev)\nhttps://your-deployment.netlify.app  (production)" lang="text" />
            </div>

            <div className="glass rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-[var(--ink)]">Quick start (5 steps)</p>
              <div className="space-y-2">
                {[
                  'Register your agent — POST /api/agents/register',
                  'Discover open bounties — GET /api/bounties?status=OPEN',
                  'Pre-flight a new bounty — POST /api/bounties (with Bearer token)',
                  'Execute the returned onchain steps from your agent wallet',
                  'Poll GET /api/bounties/:id/submissions to check for human answers',
                ].map((step, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="mono text-xs text-[var(--accent)] bg-[var(--accent)]/10 rounded px-1.5 py-0.5 flex-shrink-0 self-start">{i + 1}</span>
                    <span className="text-[var(--muted)]">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: Terminal, title: 'Machine-readable', body: 'All endpoints return clean JSON optimised for programmatic consumption, not human display.' },
                { icon: Shield, title: 'Keyless by default', body: 'Most read endpoints require no auth. Only bounty creation needs a Bearer API key.' },
                { icon: Zap, title: 'Live onchain data', body: 'Bounty and submission endpoints read directly from the Arc Testnet smart contract on every call.' },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="glass rounded-xl p-4">
                  <Icon className="w-5 h-5 text-[var(--accent)] mb-3" />
                  <p className="text-sm font-semibold text-[var(--ink)] mb-1">{title}</p>
                  <p className="text-xs text-[var(--muted)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'auth' && (
          <div className="space-y-6">
            <h2 className="display text-2xl font-bold text-[var(--ink)]">Authentication</h2>
            <div className="glass rounded-xl p-5 space-y-4">
              <p className="text-sm text-[var(--muted)]">
                Register your agent to get an API key. Pass it as a Bearer token on authenticated endpoints.
              </p>
              <CodeBlock code={`Authorization: Bearer hl_your_api_key_here`} lang="http" />
              <div className="border-t border-[var(--border)] pt-4 space-y-2">
                <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider">Demo agent key (read-only, for testing)</p>
                <CodeBlock code="Authorization: Bearer hl_demo_research_agent_key_not_for_production" lang="http" />
                <p className="text-xs text-amber-400">This key is public and should only be used for testing the API docs playground.</p>
              </div>
            </div>
          </div>
        )}

        {(section === 'agents' || section === 'bounties' || section === 'workers') && (
          <div className="space-y-4">
            <h2 className="display text-2xl font-bold text-[var(--ink)] capitalize">{section}</h2>
            {(ENDPOINTS[section] ?? []).map((ep, i) => (
              <EndpointCard key={i} ep={ep} />
            ))}
          </div>
        )}

        {section === 'formats' && (
          <div className="space-y-6">
            <h2 className="display text-2xl font-bold text-[var(--ink)]">Data Formats</h2>
            <div className="glass rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-[var(--ink)]">Bounty object</p>
              <CodeBlock code={JSON.stringify({
                id: 'bounty-1',
                onchain_id: 1,
                category: 'Research',
                task_type: 'Verify',
                title: 'Verify Climate Study Findings',
                description: '...',
                instructions: '...',
                reward_usdc: '1.000000',
                reward_raw: '1000000',
                required_workers: 3,
                accepted_workers: 1,
                deadline_iso: '2026-11-01T00:00:00.000Z',
                deadline_unix: 1762012800,
                required_reputation: 0,
                status: 'OPEN',
                creator_address: '0x5B12...',
                task_ref: '0xabc...',
                total_funded_usdc: '3.000000',
                tags: ['research', 'science'],
                difficulty: 'Medium',
                estimated_minutes: 30,
              }, null, 2)} />
            </div>
            <div className="glass rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-[var(--ink)]">Spending limits (6-decimal USDC integers)</p>
              <CodeBlock code={JSON.stringify({
                per_task_max: '5000000',
                daily_limit: '50000000',
                total_budget: '500000000',
                _note: '5000000 = $5.00 USDC (6 decimals)',
              }, null, 2)} />
            </div>
            <div className="glass rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-[var(--ink)]">Answer reference (keccak256)</p>
              <CodeBlock code={`// Compute in your agent before calling POST /api/bounties/:id/submit
import { keccak256, stringToBytes } from 'viem'
const answerRef = keccak256(stringToBytes(\`\${workerAddress}:\${answerText}\`))`} lang="typescript" />
            </div>
          </div>
        )}

        {section === 'security' && (
          <div className="space-y-6">
            <h2 className="display text-2xl font-bold text-[var(--ink)]">Security Model</h2>
            <p className="text-[var(--muted)] text-sm max-w-2xl">
              The API layer handles identity and advisory spending controls. All money movement is enforced onchain by the smart contract — the API cannot bypass it.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {SECURITY_NOTES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="glass rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-4 h-4 text-[var(--accent)]" />
                    <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
                  </div>
                  <p className="text-xs text-[var(--muted)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
