import { getAddress, isAddress, type Address, type Hex } from 'viem';

export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_MAINNET_DEFAULT_RPC_URL = 'https://rpc.mainnet.arc.io';
export const ARC_MAINNET_USDC_ADDRESS = getAddress('0x3600000000000000000000000000000000000000');
export const ARC_TESTNET_HUMANLAYER_ADDRESS = getAddress('0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2');

export interface ArcMainnetDeploymentConfig {
  rpcUrl: string;
  privateKey?: Hex;
  usdcAddress: Address;
  ownerAddress: Address;
}

export interface ArcMainnetDeploymentEnv {
  ARC_MAINNET_RPC_URL?: string;
  ARC_MAINNET_PRIVATE_KEY?: string;
  ARC_MAINNET_USDC_ADDRESS?: string;
  ARC_MAINNET_OWNER_ADDRESS?: string;
}

function requiredAddress(value: string | undefined, name: string): Address {
  if (!value || !isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  return getAddress(value);
}

export function readArcMainnetDeploymentConfig(
  env: ArcMainnetDeploymentEnv,
  options: { requirePrivateKey?: boolean } = {},
): ArcMainnetDeploymentConfig {
  const rpcUrl = env.ARC_MAINNET_RPC_URL?.trim() || ARC_MAINNET_DEFAULT_RPC_URL;
  let parsedRpcUrl: URL;
  try {
    parsedRpcUrl = new URL(rpcUrl);
  } catch {
    throw new Error('ARC_MAINNET_RPC_URL must be a valid HTTPS URL.');
  }
  if (parsedRpcUrl.protocol !== 'https:') {
    throw new Error('ARC_MAINNET_RPC_URL must use HTTPS.');
  }

  const usdcAddress = requiredAddress(env.ARC_MAINNET_USDC_ADDRESS, 'ARC_MAINNET_USDC_ADDRESS');
  if (usdcAddress !== ARC_MAINNET_USDC_ADDRESS) {
    throw new Error(`ARC_MAINNET_USDC_ADDRESS must be Arc Mainnet USDC (${ARC_MAINNET_USDC_ADDRESS}).`);
  }

  const ownerAddress = requiredAddress(env.ARC_MAINNET_OWNER_ADDRESS, 'ARC_MAINNET_OWNER_ADDRESS');
  if (ownerAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('ARC_MAINNET_OWNER_ADDRESS cannot be the zero address.');
  }

  const rawPrivateKey = env.ARC_MAINNET_PRIVATE_KEY?.trim();
  if (options.requirePrivateKey && !rawPrivateKey) {
    throw new Error('ARC_MAINNET_PRIVATE_KEY is required to broadcast a deployment.');
  }
  if (rawPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {
    throw new Error('ARC_MAINNET_PRIVATE_KEY must be a 32-byte 0x-prefixed key.');
  }

  return {
    rpcUrl,
    ...(rawPrivateKey ? { privateKey: rawPrivateKey as Hex } : {}),
    usdcAddress,
    ownerAddress,
  };
}
