// HumanLayer contract ABI and address
// v3 deployed on Arc Testnet: 0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2
// v2 (deprecated): 0x4ec5cd39ccdf09e9b6f3f5a46f8777ad6ab5072d
// v1 (deprecated): 0xe90817facedd83dfbf3ed8949d8ea042d12c6657

import artifact from '../../contracts/out/HumanLayer.sol/HumanLayer.json'
import { getAddress, isAddress } from 'viem'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, getArcChain } from './arc-chain'
import { ARC_TESTNET_HUMANLAYER_ADDRESS } from './contract-addresses'

const configuredChainId = import.meta.env.VITE_ARC_CHAIN_ID
export const ARC_CHAIN_ID = configuredChainId === undefined
  ? ARC_TESTNET_CHAIN_ID
  : Number(configuredChainId)

if (ARC_CHAIN_ID !== ARC_TESTNET_CHAIN_ID && ARC_CHAIN_ID !== ARC_MAINNET_CHAIN_ID) {
  throw new Error(`VITE_ARC_CHAIN_ID must be ${ARC_TESTNET_CHAIN_ID} (testnet) or ${ARC_MAINNET_CHAIN_ID} (mainnet).`)
}

const configuredChain = getArcChain(ARC_CHAIN_ID)
export const ARC_CHAIN_NAME = configuredChain.name
export const ARC_RPC_URL = configuredChain.rpcUrls.default.http[0]

const configuredContractAddress = ARC_CHAIN_ID === ARC_MAINNET_CHAIN_ID
  ? import.meta.env.VITE_HUMANLAYER_MAINNET_ADDRESS
  : import.meta.env.VITE_HUMANLAYER_TESTNET_ADDRESS
    ?? import.meta.env.VITE_HUMANLAYER_ADDRESS
    ?? ARC_TESTNET_HUMANLAYER_ADDRESS

if (ARC_CHAIN_ID === ARC_MAINNET_CHAIN_ID &&
  configuredContractAddress?.toLowerCase() === ARC_TESTNET_HUMANLAYER_ADDRESS.toLowerCase()) {
  throw new Error('The Arc Testnet HumanLayer contract address cannot be used for Arc Mainnet.')
}

if (!configuredContractAddress || !isAddress(configuredContractAddress)) {
  throw new Error(
    ARC_CHAIN_ID === ARC_MAINNET_CHAIN_ID
      ? 'VITE_HUMANLAYER_MAINNET_ADDRESS must be set to the newly deployed Arc Mainnet contract.'
      : 'The configured Arc Testnet HumanLayer contract address is invalid.',
  )
}

export const HUMANLAYER_ADDRESS = getAddress(configuredContractAddress)

export const HUMANLAYER_ABI = artifact.abi

export const HUMANLAYER_CONTRACT = {
  address: HUMANLAYER_ADDRESS,
  abi: HUMANLAYER_ABI,
} as const

// Category index mapping (matches contract enum order).
export const CATEGORY_INDEX = {
  Science: 0,
  Software: 1,
  Research: 2,
  ImageData: 3,
  Language: 4,
  BiologyMedicine: 5,
} as const
