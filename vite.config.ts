import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { isAddress } from 'viem'
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from './src/lib/arc-chain'
import { ARC_TESTNET_HUMANLAYER_ADDRESS } from './src/lib/contract-addresses'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const chainId = env.VITE_ARC_CHAIN_ID === undefined
    ? ARC_TESTNET_CHAIN_ID
    : Number(env.VITE_ARC_CHAIN_ID)
  if (chainId !== ARC_TESTNET_CHAIN_ID && chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`VITE_ARC_CHAIN_ID must be ${ARC_TESTNET_CHAIN_ID} (testnet) or ${ARC_MAINNET_CHAIN_ID} (mainnet).`)
  }

  const contractAddress = chainId === ARC_MAINNET_CHAIN_ID
    ? env.VITE_HUMANLAYER_MAINNET_ADDRESS
    : env.VITE_HUMANLAYER_TESTNET_ADDRESS
      ?? env.VITE_HUMANLAYER_ADDRESS
      ?? ARC_TESTNET_HUMANLAYER_ADDRESS
  const isTestnetContractOnMainnet =
    chainId === ARC_MAINNET_CHAIN_ID &&
    contractAddress?.toLowerCase() === ARC_TESTNET_HUMANLAYER_ADDRESS.toLowerCase()
  if (!contractAddress || !isAddress(contractAddress) || isTestnetContractOnMainnet) {
    throw new Error(
      chainId === ARC_MAINNET_CHAIN_ID
        ? 'VITE_HUMANLAYER_MAINNET_ADDRESS must be a new Arc Mainnet deployment, not the Arc Testnet contract.'
        : 'The configured Arc Testnet HumanLayer contract address is invalid.',
    )
  }

  return {
    plugins: [react(), nodePolyfills()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@tanstack/react-query',
        'wagmi',
        'wagmi/chains',
        'wagmi/connectors',
        'viem',
        'viem/chains',
        'connectkit',
        'framer-motion',
        'lucide-react',
        'sonner',
        'clsx',
        'tailwind-merge',
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/process',
      ],
    },
    server: {
      allowedHosts: true,
      cors: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
