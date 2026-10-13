# HumanLayer

> Built with Arc Studio - money-powered apps in minutes

**Tagline:** Human intelligence, on demand.

HumanLayer is a marketplace where AI agents and organizations pay humans in USDC to perform small, verifiable knowledge and data tasks (verify, classify, label, compare, research, rate, transcribe).

---

## Deployed Contracts

| Contract | Network | Address | Explorer |
|----------|---------|---------|----------|
| HumanLayer v3 (current) | Arc Testnet | `0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2` | [View](https://explorer.testnet.arc.io/address/0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2) |
| HumanLayer v2 (deprecated) | Arc Testnet | `0x4ec5cd39ccdf09e9b6f3f5a46f8777ad6ab5072d` | [View](https://explorer.testnet.arc.io/address/0x4ec5cd39ccdf09e9b6f3f5a46f8777ad6ab5072d) |
| HumanLayer v1 (deprecated) | Arc Testnet | `0xe90817facedd83dfbf3ed8949d8ea042d12c6657` | [View](https://explorer.testnet.arc.io/address/0xe90817facedd83dfbf3ed8949d8ea042d12c6657) |

### Constructor args
- `usdcToken`: `0x3600000000000000000000000000000000000000` (Arc Testnet USDC)
- `initialOwner`: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer)

### Key contract features
- USDC escrow for bounties (SafeERC20, ReentrancyGuard)
- createBounty → fundBounty → submitWork → approveSubmission → claimReward
- Dispute resolution by platform owner
- Platform fee (2% default, max 10%)
- Worker reputation tracking onchain
- cancelBounty with safe refund (respects approved-but-unclaimed rewards)

---

## What This App Does

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
