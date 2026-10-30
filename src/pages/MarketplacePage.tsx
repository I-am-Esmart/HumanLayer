import { useState, useMemo } from 'react'
import { Search, SlidersHorizontal, Loader2 } from 'lucide-react'
import { BountyCard } from '../components/BountyCard'
import type { Bounty, TaskCategory } from '../types'
import { CATEGORY_LABELS, getNowSec } from '../lib/utils'
import {
  getBountyMeta,
  formatUsdcAmount,
  CATEGORY_FROM_INDEX,
} from '../lib/bounty-meta'
import { useBountyCount, useAllBounties, BOUNTY_STATUS_MAP, type OnchainBounty } from '../hooks/useHumanLayer'
import { ARC_CHAIN_NAME } from '../lib/contract'
import type { Page } from '../App'

interface MarketplacePageProps {
  onNavigate: (page: Page, bounty?: Bounty) => void
}

const CATEGORIES: Array<TaskCategory | 'All'> = ['All', 'Science', 'Software', 'Research', 'ImageData', 'Language', 'BiologyMedicine']
const STATUS_FILTERS = ['All', 'Open', 'InProgress', 'Completed'] as const

/** Convert an onchain bounty to the frontend Bounty type, merging offchain metadata */
function onchainToBounty(ob: OnchainBounty): Bounty {
  const taskRefHex = ob.taskRef as string
  const meta = getBountyMeta(taskRefHex)
  const categoryIndex = ob.category
  const category: TaskCategory = CATEGORY_FROM_INDEX[categoryIndex] ?? 'Research'
  const status = BOUNTY_STATUS_MAP[ob.status] ?? 'Open'

  return {
    id: `onchain-${ob.bountyId.toString()}`,
    bountyId: Number(ob.bountyId),
    title: meta.title !== 'Onchain Task' ? meta.title : `Onchain Bounty #${ob.bountyId}`,
    description: meta.description,
    instructions: meta.instructions,
    category,
    taskType: meta.taskType,
    difficulty: meta.difficulty,
    rewardPerWorker: formatUsdcAmount(ob.rewardPerWorker),
    requiredWorkers: ob.requiredWorkers,
    acceptedCount: ob.acceptedCount,
    deadline: Number(ob.deadline),
    status,
    creator: ob.creator,
    taskRef: taskRefHex,
    totalFunded: formatUsdcAmount(ob.totalFunded),
    totalPaid: formatUsdcAmount(ob.totalPaid),
    createdAt: 0,
    tags: meta.tags,
    estimatedMinutes: meta.estimatedMinutes,
  }
}

export function MarketplacePage({ onNavigate }: MarketplacePageProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory | 'All'>('All')
  const [selectedStatus, setSelectedStatus] = useState<typeof STATUS_FILTERS[number]>('All')

  const { data: countRaw, isLoading: countLoading } = useBountyCount()
  const count = countRaw ? Number(countRaw) : 0
  const { bounties: onchainBounties, isLoading: bountiesLoading } = useAllBounties(count)

  const isLoading = countLoading || bountiesLoading

  const bounties: Bounty[] = useMemo(() => {
    if (onchainBounties.length === 0) return []
    return onchainBounties.map(onchainToBounty)
  }, [onchainBounties])

  const filtered = useMemo(() => {
    return bounties.filter((b) => {
      if (selectedCategory !== 'All' && b.category !== selectedCategory) return false
      if (selectedStatus !== 'All' && b.status !== selectedStatus) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !b.title.toLowerCase().includes(q) &&
          !b.description.toLowerCase().includes(q) &&
          !b.tags.some((t) => t.toLowerCase().includes(q))
        ) return false
      }
      return true
    })
  }, [bounties, selectedCategory, selectedStatus, search])

  // Active bounties (Open / InProgress) sorted by deadline
  const activeBounties = filtered
    .filter((b) => b.status === 'Open' || b.status === 'InProgress')
    .sort((a, b) => a.deadline - b.deadline)

  const otherBounties = filtered
    .filter((b) => b.status !== 'Open' && b.status !== 'InProgress')
    .sort((a, b) => b.bountyId - a.bountyId)

  const displayBounties = [...activeBounties, ...otherBounties]

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Demo mode banner — shown when no real onchain bounties exist yet */}
      {!isLoading && bounties.length === 0 && (
        <div className="glass rounded-xl p-4 mb-6 border border-amber-400/30 flex items-start gap-3">
          <span className="text-amber-400 text-lg flex-shrink-0">⚠</span>
          <div>
            <p className="text-sm font-semibold text-amber-400 mb-0.5">Demo mode — no live bounties yet</p>
            <p className="text-xs text-[var(--muted)]">
              No bounties have been posted to {ARC_CHAIN_NAME} yet. Connect a wallet and post the first real bounty, or explore the interface with demo data below.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold text-[var(--ink)] mb-1">Task Marketplace</h1>
          <p className="text-[var(--muted)] text-sm">
            {isLoading ? 'Loading live onchain bounties…' : `${bounties.length} bounties on ${ARC_CHAIN_NAME}`}
          </p>
        </div>
        <button
          onClick={() => onNavigate('create-bounty')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          + Post Bounty
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--subtle)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks, tags, categories…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)]/50 transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-xl border border-[var(--border)]">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--subtle)] ml-2 mr-1 flex-shrink-0" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedStatus(s)}
              className={['px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors', selectedStatus === s ? 'bg-[var(--surface-strong)] text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'].join(' ')}
            >
              {s === 'InProgress' ? 'Active' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap mb-8">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={['px-3 py-1.5 rounded-full text-xs font-medium transition-all border', selectedCategory === cat ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]'].join(' ')}
          >
            {cat === 'All' ? 'All categories' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex flex-col items-center py-24 gap-4">
          <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
          <p className="text-sm text-[var(--muted)]">Reading bounties from {ARC_CHAIN_NAME}…</p>
        </div>
      ) : displayBounties.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-[var(--muted)] text-sm mb-4">
            {bounties.length === 0 ? 'No bounties on-chain yet. Be the first to post!' : 'No bounties match your filter.'}
          </p>
          <button
            onClick={() => { setSearch(''); setSelectedCategory('All'); setSelectedStatus('All') }}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayBounties.map((bounty) => (
            <BountyCard
              key={bounty.id}
              bounty={bounty}
              onClick={() => onNavigate('task-detail', bounty)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
