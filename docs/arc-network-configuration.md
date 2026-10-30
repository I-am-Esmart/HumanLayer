# Arc network configuration

The app supports Arc Testnet and Arc Mainnet through one selected chain setting. The frontend, Vercel API, and local API server must use the same chain ID and matching HumanLayer contract address.

## Verified network facts

| Network | Chain ID | RPC | Explorer | USDC address | USDC decimals | Native gas decimals |
|---|---:|---|---|---|---:|---:|
| Arc Testnet | `5042002` | `https://rpc.testnet.arc.io` | `https://explorer.testnet.arc.io` | `0x3600000000000000000000000000000000000000` | 6 | 18 |
| Arc Mainnet | `5042` | `https://rpc.mainnet.arc.io` | `https://explorer.arc.io` | `0x3600000000000000000000000000000000000000` | 6 | 18 |

The network values are sourced from the Arc onchain facts registry in [`src/onchain-facts.ts`](../src/onchain-facts.ts) and should be checked against the [official Arc documentation](https://docs.arc.io/) before future network changes. Arc's native gas token and ERC-20 USDC use different decimal counts.

## Environment variables

Set the following public variables on each Vercel deployment. `VITE_` variables are included in browser builds; never put secrets in them.

| Variable | Preview/Testnet | Production/Mainnet |
|---|---|---|
| `VITE_ARC_CHAIN_ID` | `5042002` | `5042` |
| `VITE_HUMANLAYER_TESTNET_ADDRESS` | Existing Testnet deployment `0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2` | Optional; only used if explicitly selecting Testnet |
| `VITE_HUMANLAYER_MAINNET_ADDRESS` | Not required | Required: address of a **newly deployed Mainnet contract** |

The legacy `VITE_HUMANLAYER_ADDRESS` remains a Testnet-only fallback for existing deployments. It is never used when `VITE_ARC_CHAIN_ID=5042`. The Vite configuration fails before building if Mainnet is selected without a valid, distinct `VITE_HUMANLAYER_MAINNET_ADDRESS`; the API reports an unconfigured contract instead of falling back to the Testnet deployment.

Use the same chain ID and address values for the Vite build and the serverless API runtime. Keep Preview on Testnet while validating changes. Do not select Mainnet in Production until the new contract has been deployed and verified.

## Mainnet readiness checklist

1. Review and deploy the contract through the project-approved wallet process. Deployment and transactions require explicit owner approval and wallet involvement.
2. Record the new Mainnet address. Never copy the Testnet contract address into the Mainnet variable.
3. Read back the contract owner, USDC token, fee recipient, and platform fee from the deployed contract and verify them against the approved deployment parameters.
4. Configure `VITE_ARC_CHAIN_ID=5042` and `VITE_HUMANLAYER_MAINNET_ADDRESS=<verified-new-address>` in Vercel Production, then deploy the application.
5. Confirm `/health` reports chain ID `5042` and `contract_configured: true`; verify wallet switching, USDC balance display, explorer links, API bounty reads, and contract reads all target Mainnet.
6. Only after read-only verification, perform small-value create, fund, submit, approve, and claim flows with the approved wallet and funded account.

No Mainnet contract address is currently configured by this change. It does not deploy contracts, change Vercel settings, or submit blockchain transactions.
