import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { Menu, X, Layers, ChevronDown, Bot, BookOpen, Terminal, Users, BarChart3 } from 'lucide-react'
import type { Page } from '../App'

interface NavbarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

const MAIN_NAV: { label: string; page: Page }[] = [
  { label: 'Marketplace', page: 'marketplace' },
  { label: 'Post Bounty', page: 'create-bounty' },
  { label: 'Workers', page: 'worker-dashboard' },
  { label: 'Agents', page: 'agent-dashboard' },
  { label: 'Activity', page: 'activity' },
]

const AGENT_API_NAV: { label: string; page: Page; icon: React.ReactNode }[] = [
  { label: 'API Docs', page: 'api-docs', icon: <BookOpen className="w-3.5 h-3.5" /> },
  { label: 'Playground', page: 'api-playground', icon: <Terminal className="w-3.5 h-3.5" /> },
  { label: 'Demo Agent', page: 'demo-agent', icon: <Bot className="w-3.5 h-3.5" /> },
  { label: 'Worker Discovery', page: 'worker-discovery', icon: <Users className="w-3.5 h-3.5" /> },
]

const AGENT_API_PAGES = new Set<Page>(['api-docs', 'api-playground', 'demo-agent', 'worker-discovery'])

export function Navbar({ currentPage, onNavigate }: NavbarProps) {
  const { isConnected } = useAccount()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)

  function nav(page: Page) {
    onNavigate(page)
    setMobileOpen(false)
    setAgentMenuOpen(false)
  }

  const isAgentApiActive = AGENT_API_PAGES.has(currentPage)

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[#0a1628]/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <button
          onClick={() => nav('landing')}
          className="flex items-center gap-2 group flex-shrink-0"
        >
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center">
            <Layers className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <span className="display font-bold text-base text-[var(--ink)] tracking-tight">
            HumanLayer
          </span>
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
          {MAIN_NAV.map((item) => (
            <button
              key={item.page}
              onClick={() => nav(item.page)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                currentPage === item.page
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}

          {/* Agent API dropdown */}
          <div className="relative">
            <button
              onClick={() => setAgentMenuOpen(!agentMenuOpen)}
              onBlur={() => setTimeout(() => setAgentMenuOpen(false), 150)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                isAgentApiActive
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              <Bot className="w-3.5 h-3.5" />
              Agent API
              <ChevronDown className={`w-3 h-3 transition-transform ${agentMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {agentMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-[#0d1b2f] border border-[var(--border)] rounded-xl shadow-xl py-1.5 z-50">
                {AGENT_API_NAV.map((item) => (
                  <button
                    key={item.page}
                    onClick={() => nav(item.page)}
                    className={[
                      'w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors',
                      currentPage === item.page
                        ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                        : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
                    ].join(' ')}
                  >
                    <span className="text-[var(--accent)]">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isConnected && (
            <button
              onClick={() => nav('admin')}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
                currentPage === 'admin'
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Admin
            </button>
          )}
        </div>

        {/* Right: wallet + mobile toggle */}
        <div className="flex items-center gap-3">
          <ConnectKitButton
            customTheme={{
              '--ck-font-family': "'DM Sans', sans-serif",
              '--ck-primary-button-background': 'rgba(172,198,233,0.12)',
              '--ck-primary-button-color': '#acc6e9',
              '--ck-primary-button-border-radius': '8px',
              '--ck-primary-button-border-color': 'rgba(172,198,233,0.25)',
              '--ck-primary-button-hover-background': 'rgba(172,198,233,0.2)',
              '--ck-body-background': '#0d1b2f',
              '--ck-body-color': '#f0f4fa',
              '--ck-overlay-background': 'rgba(0,0,0,0.6)',
              '--ck-modal-box-shadow': '0 0 0 1px rgba(172,198,233,0.15)',
            }}
          />
          <button
            className="md:hidden p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[#0a1628] px-4 py-3 flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
            <button
              key={item.page}
              onClick={() => nav(item.page)}
              className={[
                'text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                currentPage === item.page
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
          <div className="border-t border-[var(--border)] my-1 pt-1">
            <p className="text-xs text-[var(--subtle)] px-3 py-1 flex items-center gap-1.5">
              <Bot className="w-3 h-3" /> Agent API
            </p>
            {AGENT_API_NAV.map((item) => (
              <button
                key={item.page}
                onClick={() => nav(item.page)}
                className={[
                  'w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
                  currentPage === item.page
                    ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
                ].join(' ')}
              >
                <span className="text-[var(--accent)]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
          {isConnected && (
            <button
              onClick={() => nav('admin')}
              className={[
                'text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                currentPage === 'admin'
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
              ].join(' ')}
            >
              Admin
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
