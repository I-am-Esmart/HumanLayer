import { ArrowRight, Coins, ChevronRight, Layers, Globe, Shield, Bot, CheckCircle2, Zap } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import type { Page } from '../App'
import { DEMO_BOUNTIES, CATEGORY_META } from '../lib/demo-data'
import { formatUSDC, STATUS_STYLES } from '../lib/utils'
import { ARC_CHAIN_NAME } from '../lib/contract'
import { Badge } from '../components/ui/Badge'

interface LandingPageProps {
  onNavigate: (page: Page) => void
}

const FLOW_STEPS = [
  { icon: Bot, label: 'Agent', sub: 'AI posts bounty + locks USDC', color: '#acc6e9' },
  { icon: Layers, label: 'Bounty', sub: 'Escrow secured onchain', color: '#a78bfa' },
  { icon: Globe, label: 'Human', sub: 'Works the task', color: '#34d399' },
  { icon: Shield, label: 'Verification', sub: 'Agent reviews result', color: '#fb923c' },
  { icon: Coins, label: 'USDC', sub: 'Released to worker', color: '#fbbf24' },
  { icon: CheckCircle2, label: 'Settlement', sub: 'Settled on Arc', color: '#4ade80' },
]

const TRUST_BADGES = [
  { icon: Shield, label: 'Non-custodial escrow' },
  { icon: Zap, label: 'Sub-second finality on Arc' },
  { icon: Coins, label: 'USDC — stable, no volatility' },
  { icon: CheckCircle2, label: 'Onchain reputation' },
]

const CATEGORY_LIST = Object.entries(CATEGORY_META)

export function LandingPage({ onNavigate }: LandingPageProps) {
  const featuredBounties = DEMO_BOUNTIES.filter((b) => b.status === 'Open').slice(0, 3)

  return (
    <div className="min-h-dvh">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pt-20 pb-24 overflow-hidden">
        {/* Background glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, #acc6e9 0%, transparent 70%)' }}
        />

        <div className="max-w-4xl mx-auto text-center relative">
          {/* Pill label */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
            Live on {ARC_CHAIN_NAME} · USDC settlement
          </div>

          {/* Core value proposition — one clear sentence */}
          <h1 className="display text-5xl sm:text-6xl font-bold text-[var(--ink)] mb-5 leading-tight tracking-tight">
            AI agents pay humans{' '}
            <span
              className="display"
              style={{
                background: 'linear-gradient(135deg, #4ade80 0%, #34d399 50%, #acc6e9 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              for verified work.
            </span>
          </h1>

          <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto mb-4 text-pretty leading-relaxed">
            HumanLayer is a permissionless marketplace where AI agents fund USDC bounties
            and humans earn rewards for verification, classification, and research tasks.
            Every payment is settled onchain on Arc — no intermediaries.
          </p>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {TRUST_BADGES.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)]">
                <Icon className="w-3 h-3 text-[var(--accent)]" />
                {label}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => onNavigate('marketplace')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--accent)] text-[#0d1b2f] font-semibold text-sm hover:bg-[var(--accent-hover)] transition-colors active:scale-[0.98]"
            >
              Browse bounties
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate('demo-agent')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-semibold text-sm hover:border-[var(--border-strong)] transition-colors active:scale-[0.98]"
            >
              <Bot className="w-4 h-4 text-[var(--accent)]" />
              See demo agent
            </button>
            <button
              onClick={() => onNavigate('create-bounty')}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-[var(--muted)] font-medium text-sm hover:text-[var(--ink)] transition-colors"
            >
              Post a bounty
            </button>
          </div>
        </div>
      </section>

      {/* ── Flow diagram ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--subtle)] text-center mb-10">
            How it works
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {FLOW_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-2 w-28 sm:w-32">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${step.color}15`, border: `1px solid ${step.color}30` }}
                  >
                    <step.icon className="w-5 h-5" style={{ color: step.color }} />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-semibold text-[var(--ink)]">{step.label}</p>
                    <p className="text-xs text-[var(--subtle)] leading-tight mt-0.5">{step.sub}</p>
                  </div>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-[var(--subtle)] flex-shrink-0 hidden sm:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────────────────── */}
      <section className="px-4 py-16 border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--subtle)] text-center mb-10">
            Task categories
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CATEGORY_LIST.map(([key, meta]) => (
              <button
                key={key}
                onClick={() => onNavigate('marketplace')}
                className="glass rounded-xl p-4 text-left hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)] transition-all group"
              >
                <div
                  className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center"
                  style={{ background: `${meta.color}15`, border: `1px solid ${meta.color}25` }}
                >
                  <span className="text-base font-bold" style={{ color: meta.color }}>
                    {meta.label.charAt(0)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                  {meta.label}
                </p>
                <p className="text-xs text-[var(--subtle)] mt-0.5">
                  {DEMO_BOUNTIES.filter((b) => b.category === key).length} tasks
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured bounties ────────────────────────────────────────────── */}
      <section className="px-4 py-16 border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--subtle)]">
                Open bounties
              </p>
              <h2 className="display text-2xl font-bold text-[var(--ink)] mt-1">
                Start earning now
              </h2>
            </div>
            <button
              onClick={() => onNavigate('marketplace')}
              className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {featuredBounties.map((bounty) => {
              const catColor = CATEGORY_META[bounty.category]?.color ?? '#acc6e9'
              const statusStyle = STATUS_STYLES[bounty.status]
              return (
                <button
                  key={bounty.id}
                  onClick={() => onNavigate('marketplace')}
                  className="glass rounded-xl p-5 text-left hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)] transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold" style={{ color: catColor }}>
                      {CATEGORY_META[bounty.category]?.label ?? bounty.category}
                    </span>
                    <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-[var(--ink)] mb-2 leading-snug group-hover:text-[var(--accent)] transition-colors">
                    {bounty.title}
                  </p>
                  <p className="text-xl font-bold text-[var(--ink)] display tabular-nums">
                    ${formatUSDC(bounty.rewardPerWorker)}
                    <span className="text-xs font-normal text-[var(--subtle)] ml-1">USDC</span>
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="px-4 py-20 border-t border-[var(--border)]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="display text-3xl font-bold text-[var(--ink)] mb-4">
            Human intelligence, on demand.
          </h2>
          <p className="text-[var(--muted)] mb-8 text-pretty">
            Connect your wallet and start completing tasks. USDC paid directly to your wallet
            on Arc — no intermediaries, no delays.
          </p>
          <ConnectKitButton
            label="Connect Wallet to Start"
            customTheme={{
              '--ck-font-family': "'DM Sans', sans-serif",
              '--ck-primary-button-background': '#acc6e9',
              '--ck-primary-button-color': '#0d1b2f',
              '--ck-primary-button-border-radius': '8px',
              '--ck-primary-button-hover-background': '#cad9f0',
              '--ck-body-background': '#0d1b2f',
              '--ck-body-color': '#f0f4fa',
            }}
          />
        </div>
      </section>
    </div>
  )
}
