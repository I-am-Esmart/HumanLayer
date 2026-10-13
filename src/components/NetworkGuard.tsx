import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/Button'
import { useNetworkGuard } from '../hooks/useNetworkGuard'

export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { needsSwitch, isSwitching, switchToArc } = useNetworkGuard()

  if (needsSwitch) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="display text-xl font-bold text-[var(--ink)] mb-2">Wrong Network</h2>
        <p className="text-[var(--muted)] text-sm mb-6 text-pretty">
          HumanLayer runs on Arc Testnet. Switch your wallet to continue.
        </p>
        <Button onClick={switchToArc} loading={isSwitching} size="lg">
          Switch to Arc Testnet
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
