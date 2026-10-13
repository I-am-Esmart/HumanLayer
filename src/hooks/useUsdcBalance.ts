import { useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'

const CHAIN_ID = arcTestnet.id
const usdc = getUsdc(CHAIN_ID)
export const USDC_ADDRESS = usdc?.address as `0x${string}` | undefined
export const USDC_DECIMALS = usdcDecimalsFor(CHAIN_ID)

export function useUsdcBalance(address: `0x${string}` | undefined) {
  const { data: raw, isLoading, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!USDC_ADDRESS },
  })

  const formatted = raw !== undefined
    ? Amount.fromRaw(raw, USDC_DECIMALS).toFixed(2)
    : undefined

  return { raw, formatted, isLoading, refetch }
}

export function useUsdcAllowance(
  owner: `0x${string}` | undefined,
  spender: `0x${string}` | undefined
) {
  const { data: raw, isLoading, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && spender ? [owner, spender] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!owner && !!spender && !!USDC_ADDRESS },
  })

  return { raw: raw ?? 0n, isLoading, refetch }
}
