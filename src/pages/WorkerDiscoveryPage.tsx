import { useState, useEffect, useCallback } from 'react'
import { Search, Star, CheckCircle2, AlertTriangle, Clock, Loader2, ExternalLink } from 'lucide-react'
import { api, type WorkerRecord } from '../lib/api'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { explorerAddrUrl } from '../lib/bounty-meta'

const CATEGORIES = ['', 'Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']

/** Fallback demo workers shown when the API backend is not reachable (e.g. static deployment). */
const DEMO_WORKERS: WorkerRecord[] = [
  {
    address: '0xD4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3', reputation: 98,
    category_reputations: { Research: 99, Science: 95, BiologyMedicine: 97 },
    completed_tasks: 214, dispute_rate: 0.009, avg_completion_time_min: 22,
    last_active_iso: new Date(Date.now() - 3600_000).toISOString(), is_available: true,
  },
  {
    address: '0xA1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', reputation: 91,
    category_reputations: { Software: 94, Research: 88, Science: 82 },
    completed_tasks: 87, dispute_rate: 0.023, avg_completion_time_min: 35,
    last_active_iso: new Date(Date.now() - 7200_000).toISOString(), is_available: true,
  },
  {
    address: '0xF1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0', reputation: 84,
    category_reputations: { Language: 92, Research: 78, ImageData: 71 },
    completed_tasks: 56, dispute_rate: 0.036, avg_completion_time_min: 28,
    last_active_iso: new Date(Date.now() - 86400_000).toISOString(), is_available: false,
  },
  {
    address: '0xB2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1', reputation: 76,
    category_reputations: { ImageData: 88, Science: 74, BiologyMedicine: 65 },
    completed_tasks: 31, dispute_rate: 0.065, avg_completion_time_min: 41,
    last_active_iso: new Date(Date.now() - 172800_000).toISOString(), is_available: true,
  },
  {
    address: '0xC3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2', reputation: 62,
    category_reputations: { Language: 70, Research: 58 },
    completed_tasks: 12, dispute_rate: 0.083, avg_completion_time_min: 55,
    last_active_iso: new Date(Date.now() - 432000_000).toISOString(), is_available: false,
  },
]

function reputationColor(rep: number): string {
  if (rep >= 90) return 'text-emerald-400'
  if (rep >= 70) return 'text-amber-400'
  return 'text-red-400'
}

function WorkerCard({ worker, onClick }: { worker: WorkerRecord; onClick: () => void }) {
  return (
    <div className="glass rounded-xl p-5 hover:border-[var(--border-strong)] transition-all cursor-pointer" onClick={onClick}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-lg bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center flex-shrink-0">
            <span className="mono text-xs font-bold text-[var(--muted)]">
              {worker.address.slice(2, 4).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="mono text-xs text-[var(--muted)]">
              {worker.address.slice(0, 8)}…{worker.address.slice(-6)}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {worker.is_available ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Available
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[var(--subtle)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--subtle)]" />
                  Busy
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className={`display text-2xl font-bold tabular-nums ${reputationColor(worker.reputation)}`}>
            {worker.reputation}
          </p>
          <p className="text-xs text-[var(--subtle)]">reputation</p>
        </div>
      </div>

      {/* Category reputations */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {Object.entries(worker.category_reputations)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, score]) => (
            <span key={cat} className="text-xs px-2 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--muted)]">
              {cat} <span className={`font-semibold ${reputationColor(score)}`}>{score}</span>
            </span>
          ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-3">
        <div className="text-center">
          <p className="text-sm font-bold text-[var(--ink)] tabular-nums">{worker.completed_tasks}</p>
          <p className="text-xs text-[var(--subtle)]">tasks</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-[var(--ink)] tabular-nums">
            {(worker.dispute_rate * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-[var(--subtle)]">dispute rate</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-[var(--ink)] tabular-nums">{worker.avg_completion_time_min}m</p>
          <p className="text-xs text-[var(--subtle)]">avg time</p>
        </div>
      </div>
    </div>
  )
}

function WorkerDetailPanel({ worker, onClose }: { worker: WorkerRecord; onClose: () => void }) {
  return (
    <div className="glass rounded-xl p-6 border-2 border-[var(--accent)]/30">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="mono text-sm text-[var(--muted)] mb-1">{worker.address}</p>
          <div className="flex items-center gap-2">
            {worker.is_available ? (
              <Badge className="text-emerald-400 bg-emerald-400/10 border-emerald-400/20">Available</Badge>
            ) : (
              <Badge className="text-[var(--subtle)] bg-[var(--surface-muted)] border-[var(--border)]">Busy</Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { icon: Star, label: 'Reputation', value: worker.reputation, color: reputationColor(worker.reputation) },
          { icon: CheckCircle2, label: 'Completed', value: worker.completed_tasks, color: 'text-[var(--ink)]' },
          { icon: AlertTriangle, label: 'Dispute rate', value: `${(worker.dispute_rate * 100).toFixed(1)}%`, color: worker.dispute_rate < 0.05 ? 'text-emerald-400' : 'text-amber-400' },
          { icon: Clock, label: 'Avg time', value: `${worker.avg_completion_time_min}m`, color: 'text-[var(--ink)]' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="glass rounded-lg p-3 text-center">
            <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
            <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-[var(--subtle)]">{label}</p>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">Category reputation</p>
        <div className="space-y-2">
          {Object.entries(worker.category_reputations)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, score]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-28 flex-shrink-0">{cat}</span>
                <div className="flex-1 h-1.5 bg-[var(--surface-muted)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${score}%`, background: score >= 90 ? 'var(--success)' : 'var(--accent)' }}
                  />
                </div>
                <span className={`text-xs font-semibold tabular-nums w-8 text-right ${reputationColor(score)}`}>{score}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
        <a
          href={explorerAddrUrl(worker.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View on explorer
        </a>
      </div>
    </div>
  )
}

export function WorkerDiscoveryPage() {
  const [workers, setWorkers] = useState<WorkerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)
  const [category, setCategory] = useState('')
  const [minRep, setMinRep] = useState('')
  const [availOnly, setAvailOnly] = useState(false)
  const [selected, setSelected] = useState<WorkerRecord | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setUsingDemo(false)
    api.agents.workers({
      category: category || undefined,
      min_reputation: minRep ? parseInt(minRep) : undefined,
      available_only: availOnly || undefined,
    }).then((res) => {
      setWorkers(res.workers)
    }).catch(() => {
      // Backend not reachable (e.g. static deploy) — show demo workers instead of an error
      let demo = DEMO_WORKERS
      if (category) demo = demo.filter((w) => category in w.category_reputations)
      if (minRep) demo = demo.filter((w) => w.reputation >= parseInt(minRep))
      if (availOnly) demo = demo.filter((w) => w.is_available)
      setWorkers(demo)
      setUsingDemo(true)
    }).finally(() => {
      setLoading(false)
    })
  }, [category, minRep, availOnly])

  // oxlint-disable-next-line react/set-state-in-effect -- data fetch on filter change is the intended pattern
  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="display text-3xl font-bold text-[var(--ink)] mb-2">Worker Discovery</h1>
        <p className="text-[var(--muted)] text-sm max-w-2xl">
          AI agents can discover and rank human workers by category expertise, reputation score, dispute rate, and availability.
          These profiles are readable by any agent via the API without authentication.
        </p>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-36">
          <label className="text-xs text-[var(--subtle)] block mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c || 'All categories'}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <label className="text-xs text-[var(--subtle)] block mb-1">Min reputation</label>
          <Input
            value={minRep}
            onChange={(e) => setMinRep(e.target.value)}
            placeholder="0–100"
            type="number"
            min={0}
            max={100}
          />
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input
            id="avail"
            type="checkbox"
            checked={availOnly}
            onChange={(e) => setAvailOnly(e.target.checked)}
            className="w-4 h-4 accent-[var(--accent)]"
          />
          <label htmlFor="avail" className="text-sm text-[var(--muted)] cursor-pointer">Available only</label>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <Search className="w-3.5 h-3.5" />
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {usingDemo && (
        <div className="glass rounded-xl p-4 mb-6 border border-amber-400/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400">
            Showing demo worker profiles — the API backend is not reachable on this deployment.
            Run the app locally with <span className="mono">bun run start</span> to see live data.
          </p>
        </div>
      )}

      {selected && (
        <div className="mb-6">
          <WorkerDetailPanel worker={selected} onClose={() => setSelected(null)} />
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
          <p className="text-sm text-[var(--muted)]">Loading worker profiles…</p>
        </div>
      ) : workers.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted)] text-sm">
          No workers match your filters. Try adjusting the criteria.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map((w) => (
            <WorkerCard
              key={w.address}
              worker={w}
              onClick={() => setSelected(selected?.address === w.address ? null : w)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
