import { defineChain } from 'viem'
import { requireChain } from '../onchain-facts'

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_MAINNET_CHAIN_ID = 5042

function createArcChain(chainId: number) {
  const facts = requireChain(chainId)
  const name = facts.isTestnet ? facts.name : `${facts.name} Mainnet`
  return defineChain({
    id: facts.chainId,
    name,
    nativeCurrency: {
      name: facts.nativeCurrency.symbol,
      symbol: facts.nativeCurrency.symbol,
      decimals: facts.nativeCurrency.decimals,
    },
    rpcUrls: { default: { http: facts.rpcUrls } },
    blockExplorers: { default: { name: `${name} Explorer`, url: facts.explorerBase } },
    testnet: facts.isTestnet,
  })
}

export const arcTestnet = createArcChain(ARC_TESTNET_CHAIN_ID)
export const arcMainnet = createArcChain(ARC_MAINNET_CHAIN_ID)

export function getArcChain(chainId: number) {
  if (chainId === ARC_TESTNET_CHAIN_ID) return arcTestnet
  if (chainId === ARC_MAINNET_CHAIN_ID) return arcMainnet
  throw new Error(`Unsupported Arc chain ID: ${chainId}`)
}
