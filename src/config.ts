/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arcMainnet, arcTestnet } from './lib/arc-chain'
import { ARC_CHAIN_ID } from './lib/contract'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

// Only offer the chain selected for this deployment. This prevents wallets from
// trying to add/switch to Testnet when the production app targets Arc Mainnet.
const appChain = ARC_CHAIN_ID === arcMainnet.id ? arcMainnet : arcTestnet

export const config = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(appChain.rpcUrls.default.http[0]),
  },
})
