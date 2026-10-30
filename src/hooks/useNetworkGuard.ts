import { useAccount, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID, ARC_CHAIN_NAME } from '../lib/contract'

export function useNetworkGuard() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isCorrectChain = isConnected && chainId === ARC_CHAIN_ID
  const needsSwitch = isConnected && chainId !== ARC_CHAIN_ID

  function switchToArc() {
    switchChain({ chainId: ARC_CHAIN_ID })
  }

  return {
    isCorrectChain,
    needsSwitch,
    isSwitching,
    switchToArc,
    targetChainId: ARC_CHAIN_ID,
    targetChainName: ARC_CHAIN_NAME,
  }
}
