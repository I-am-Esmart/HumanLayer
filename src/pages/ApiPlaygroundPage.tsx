import { useState, useEffect } from 'react'
import { Play, Loader2, ChevronDown, Terminal, AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { api, DEMO_API_KEY, DEMO_AGENT_ID } from '../lib/api'

interface RequestLog {
  id: number
  method: string
  path: string
  status: number | null
  durationMs: number
  response: unknown
  error?: string
}

let logId = 0
function nowMs() { return Date.now() }

const PRESET_REQUESTS = [
  {
    label: 'Health check',
    method: 'GET',
    path: '/health',
    execute: () => api.health(),
  },
  {
    label: 'List open bounties',
    method: 'GET',
    path: '/api/bounties?status=OPEN',
    execute: () => api.bounties.list({ status: 'OPEN' }),
  },
  {
    label: 'List Research bounties',
    method: 'GET',
    path: '/api/bounties?category=Research',
    execute: () => api.bounties.list({ category: 'Research' }),
  },
  {
    label: 'Get bounty #1',
    method: 'GET',
    path: '/api/bounties/1',
    execute: () => api.bounties.get(1),
  },
  {
    label: 'Get bounty #1 submissions',
    method: 'GET',
    path: '/api/bounties/1/submissions',
    execute: () => api.bounties.submissions(1),
  },
  {
    label: 'Demo agent profile',
    method: 'GET',
    path: `/api/agents/${DEMO_AGENT_ID}`,
    execute: () => api.agents.get(DEMO_AGENT_ID),
  },
  {
    label: 'Demo agent reputation',
    method: 'GET',
    path: `/api/agents/${DEMO_AGENT_ID}/reputation`,
    execute: () => api.agents.reputation(DEMO_AGENT_ID),
  },
  {
    label: 'Demo agent activity',
    method: 'GET',
    path: `/api/agents/${DEMO_AGENT_ID}/activity`,
    execute: () => api.agents.activity(DEMO_AGENT_ID),
  },
  {
    label: 'Discover workers (Research)',
    method: 'GET',
    path: '/api/agents/workers?category=Research&min_reputation=80',
    execute: () => api.agents.workers({ category: 'Research', min_reputation: 80 }),
  },
  {
    label: 'Discover top workers (any)',
    method: 'GET',
    path: '/api/agents/workers?min_reputation=90',
    execute: () => api.agents.workers({ min_reputation: 90 }),
  },
  {
    label: 'Pre-flight bounty creation (demo key)',
    method: 'POST',
    path: '/api/bounties',
    execute: () => api.bounties.createIntent(DEMO_API_KEY, {
      title: 'Verify Climate Model Outputs',
      description: 'Cross-check findings from IPCC 2024 report against primary sources.',
      category: 'Research',
      task_type: 'Verify',
      reward_usdc: '1.50',
      required_workers: 2,
      days_until_deadline: 7,
    }),
  },
  {
    label: 'Pre-flight work submission',
    method: 'POST',
    path: '/api/bounties/1/submit',
    execute: () => api.bounties.submitWork(1, {
      worker_address: '0xD4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
      answer_ref: '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    }),
  },
]

function ResponsePanel({ log }: { log: RequestLog }) {
  const [open, setOpen] = useState(true)
  const statusColor =
    log.status === null ? 'text-[var(--subtle)]' :
    log.status < 300 ? 'text-emerald-400' :
    log.status < 500 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-strong)] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className={`mono text-xs font-bold ${log.method === 'GET' ? 'text-emerald-400' : 'text-blue-400'}`}>{log.method}</span>
        <span className="mono text-xs text-[var(--muted)] flex-1 text-left truncate">{log.path}</span>
        <span className={`mono text-xs font-semibold ${statusColor}`}>{log.status ?? '...'}</span>
        <span className="text-xs text-[var(--subtle)]">{log.durationMs}ms</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--subtle)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[var(--border)]">
          <pre className="mono text-xs p-4 overflow-x-auto text-[var(--ink)] leading-relaxed max-h-96 overflow-y-auto">
            {log.error
              ? `Error: ${log.error}`
              : JSON.stringify(log.response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ApiPlaygroundPage() {
  const [logs, setLogs] = useState<RequestLog[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null)

  // Probe backend availability once on mount
  useEffect(() => {
    api.health()
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false))
  }, [])

  async function runRequest(preset: typeof PRESET_REQUESTS[0]) {
    if (running) return
    setRunning(preset.label)
    const id = ++logId
    const start = nowMs()

    const pending: RequestLog = {
      id, method: preset.method, path: preset.path,
      status: null, durationMs: 0, response: null,
    }
    setLogs((prev) => [pending, ...prev])

    try {
      const res = await preset.execute()
      const ms = nowMs() - start
      setLogs((prev) => prev.map((l) => l.id === id ? { ...l, status: 200, durationMs: ms, response: res } : l))
    } catch (err: unknown) {
      const ms = nowMs() - start
      const e = err as { status?: number; message?: string; data?: unknown }
      // If the response looks like HTML (Netlify 404), give a friendly message
      const isHtmlError = typeof e.message === 'string' && (e.message.includes('DOCTYPE') || e.message.includes('not valid JSON'))
      setLogs((prev) => prev.map((l) =>
        l.id === id ? {
          ...l,
          status: e.status ?? 503,
          durationMs: ms,
          response: isHtmlError
            ? { note: 'Backend not available on this deployment. Run locally with `bun run start` to use the live API.' }
            : (e.data ?? null),
          error: isHtmlError ? 'Backend not available — showing static note' : e.message,
        } : l
      ))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <Terminal className="w-6 h-6 text-[var(--accent)]" />
        <h1 className="display text-2xl font-bold text-[var(--ink)]">API Playground</h1>
      </div>
      <p className="text-[var(--muted)] text-sm mb-4 max-w-2xl">
        Send live requests to the HumanLayer Agent API and inspect the responses. Click any preset to execute it.
      </p>

      {backendAvailable === false && (
        <div className="glass rounded-xl p-4 mb-6 border border-amber-400/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-400 mb-0.5">Backend not running on this deployment</p>
            <p className="text-xs text-[var(--muted)]">
              The API server requires a Node.js backend. To use the live playground, run the app locally:
              <span className="mono text-[var(--ink)]"> bun run start</span>.
              You can still click presets below — responses will show what the API would return.
            </p>
          </div>
        </div>
      )}
      {backendAvailable === true && (
        <div className="glass rounded-xl p-3 mb-6 border border-emerald-400/20 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <p className="text-xs text-emerald-400">Backend connected — all requests go to the live API.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Preset buttons */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider mb-3">Preset requests</p>
          {PRESET_REQUESTS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => { void runRequest(preset) }}
              disabled={!!running}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)] transition-colors disabled:opacity-50 flex items-center gap-3 group"
            >
              <span className={`mono text-xs font-bold flex-shrink-0 ${preset.method === 'GET' ? 'text-emerald-400' : 'text-blue-400'}`}>
                {preset.method}
              </span>
              <span className="text-xs text-[var(--muted)] flex-1 truncate group-hover:text-[var(--ink)]">{preset.label}</span>
              {running === preset.label
                ? <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin flex-shrink-0" />
                : <Play className="w-3 h-3 text-[var(--subtle)] group-hover:text-[var(--accent)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all" />
              }
            </button>
          ))}
        </div>

        {/* Response logs */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--subtle)] uppercase tracking-wider">Responses</p>
            {logs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Clear</Button>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <Terminal className="w-8 h-8 mx-auto mb-3 text-[var(--accent)]/30" />
              <p className="text-sm text-[var(--muted)]">Click a preset request to see the live API response.</p>
            </div>
          ) : (
            logs.map((log) => <ResponsePanel key={log.id} log={log} />)
          )}
        </div>
      </div>
    </div>
  )
}
