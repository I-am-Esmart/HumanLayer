// HumanLayer contract ABI and address
// v3 deployed on Arc Testnet: 0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2
// v2 (deprecated): 0x4ec5cd39ccdf09e9b6f3f5a46f8777ad6ab5072d
// v1 (deprecated): 0xe90817facedd83dfbf3ed8949d8ea042d12c6657

import artifact from '../../contracts/out/HumanLayer.sol/HumanLayer.json'

export const HUMANLAYER_ADDRESS = '0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2' as const

export const HUMANLAYER_ABI = artifact.abi

export const HUMANLAYER_CONTRACT = {
  address: HUMANLAYER_ADDRESS,
  abi: HUMANLAYER_ABI,
} as const

// Category index mapping (matches contract enum order)
export const CATEGORY_INDEX = {
  Science: 0,
  Software: 1,
  Research: 2,
  ImageData: 3,
  Language: 4,
  BiologyMedicine: 5,
} as const

// Chain ID for Arc Testnet
export const ARC_TESTNET_CHAIN_ID = 5042002
