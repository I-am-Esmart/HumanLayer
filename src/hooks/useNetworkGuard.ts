import { useAccount, useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'

const TARGET_CHAIN_ID = arcTestnet.id

export function useNetworkGuard() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isCorrectChain = isConnected && chainId === TARGET_CHAIN_ID
  const needsSwitch = isConnected && chainId !== TARGET_CHAIN_ID

  function switchToArc() {
    switchChain({ chainId: TARGET_CHAIN_ID })
  }

  return { isCorrectChain, needsSwitch, isSwitching, switchToArc, targetChainId: TARGET_CHAIN_ID }
}
