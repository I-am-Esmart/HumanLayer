import { useState } from 'react'
import { Navbar } from './components/Navbar'
import { LandingPage } from './pages/LandingPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { WorkerDashboard } from './pages/WorkerDashboard'
import { AgentDashboard } from './pages/AgentDashboard'
import { CreateBountyPage } from './pages/CreateBountyPage'
import { ActivityPage } from './pages/ActivityPage'
import { AdminPage } from './pages/AdminPage'
import { ApiDocsPage } from './pages/ApiDocsPage'
import { ApiPlaygroundPage } from './pages/ApiPlaygroundPage'
import { WorkerDiscoveryPage } from './pages/WorkerDiscoveryPage'
import { DemoAgentPage } from './pages/DemoAgentPage'
import type { Bounty } from './types'

export type Page =
  | 'landing'
  | 'marketplace'
  | 'task-detail'
  | 'worker-dashboard'
  | 'agent-dashboard'
  | 'create-bounty'
  | 'activity'
  | 'admin'
  | 'api-docs'
  | 'api-playground'
  | 'worker-discovery'
  | 'demo-agent'

export default function App() {
  const [page, setPage] = useState<Page>('landing')
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null)

  function navigate(nextPage: Page, bounty?: Bounty) {
    if (bounty) setSelectedBounty(bounty)
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Navbar currentPage={page} onNavigate={navigate} />

      {page === 'landing' && <LandingPage onNavigate={navigate} />}
      {page === 'marketplace' && <MarketplacePage onNavigate={navigate} />}

      {page === 'task-detail' && selectedBounty ? (
        <TaskDetailPage bounty={selectedBounty} onNavigate={navigate} />
      ) : page === 'task-detail' ? (
        <div className="max-w-4xl mx-auto px-4 py-20 text-center">
          <p className="text-[var(--muted)]">No task selected. Browse the marketplace.</p>
          <button
            onClick={() => navigate('marketplace')}
            className="mt-4 text-sm text-[var(--accent)] hover:underline"
          >
            Go to Marketplace
          </button>
        </div>
      ) : null}

      {page === 'worker-dashboard' && <WorkerDashboard onNavigate={navigate} />}
      {page === 'agent-dashboard' && <AgentDashboard onNavigate={navigate} />}
      {page === 'create-bounty' && <CreateBountyPage onNavigate={navigate} />}
      {page === 'activity' && <ActivityPage />}
      {page === 'admin' && <AdminPage />}
      {page === 'api-docs' && <ApiDocsPage />}
      {page === 'api-playground' && <ApiPlaygroundPage />}
      {page === 'worker-discovery' && <WorkerDiscoveryPage />}
      {page === 'demo-agent' && <DemoAgentPage onNavigate={navigate} />}
    </div>
  )
}
