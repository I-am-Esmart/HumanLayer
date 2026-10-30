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
| `VITE_HUMANLAYER_MAINNET_ADDRESS` | Not required | `0x43762D26A9c035d70c04D3cef58Db46227073e1E` |

The legacy `VITE_HUMANLAYER_ADDRESS` remains a Testnet-only fallback for existing deployments. It is never used when `VITE_ARC_CHAIN_ID=5042`. The Vite configuration fails before building if Mainnet is selected without a valid, distinct `VITE_HUMANLAYER_MAINNET_ADDRESS`; the API reports an unconfigured contract instead of falling back to the Testnet deployment.

Use the same chain ID and address values for the Vite build and the serverless API runtime. Keep Preview on Testnet while validating changes. Do not select Mainnet in Production until the new contract has been deployed and verified.

## Mainnet readiness checklist

1. Review and deploy the contract through the project-approved wallet process. Deployment and transactions require explicit owner approval and wallet involvement.
2. Record the new Mainnet address. Never copy the Testnet contract address into the Mainnet variable.
3. Read back the contract owner, USDC token, fee recipient, and platform fee from the deployed contract and verify them against the approved deployment parameters.
4. Configure `VITE_ARC_CHAIN_ID=5042` and `VITE_HUMANLAYER_MAINNET_ADDRESS=<verified-new-address>` in Vercel Production, then deploy the application.
5. Confirm `/health` reports chain ID `5042` and `contract_configured: true`; verify wallet switching, USDC balance display, explorer links, API bounty reads, and contract reads all target Mainnet.
6. Only after read-only verification, perform small-value create, fund, submit, approve, and claim flows with the approved wallet and funded account.

The active Arc Mainnet deployment is `0x43762D26A9c035d70c04D3cef58Db46227073e1E` (transaction `0xc5b63974d9f364170aa2fc3321727b51c8fda3802e2c6044fcfcbb7b23c89c33`). It was compiled from the current Solidity source, including fee snapshots. The prior deployment `0x3F77cBAeC7798024C1ea91755dFFeb0c516767FE` is preserved in [`contracts/deployments/arc-mainnet-HumanLayer-v3.json`](../contracts/deployments/arc-mainnet-HumanLayer-v3.json); it predates the latest contract layout. The active deployment record is [`contracts/deployments/arc-mainnet-HumanLayer.json`](../contracts/deployments/arc-mainnet-HumanLayer.json).

## Arc Mainnet contract deployment

The Circle/Compass deployment path remains available for chains it supports. Arc Mainnet does not have the Circle Developer-Controlled Wallet contract-execution path required by that script, so HumanLayer uses a separate conventional EVM deployment path based on viem. This is a normal CREATE deployment; CREATE2 is not needed because the application consumes the address from configuration and does not require deterministic deployment addresses.

### Prepare local credentials

1. Choose the production owner wallet or multisig. The initial owner is also the initial fee recipient; do not default to the Testnet owner without confirming it is the intended production owner.
2. Create or use a dedicated deployer wallet, fund it with enough Arc Mainnet native USDC for gas, and keep its signing key in a local `.env` file or a managed secret store. Never use a frontend `VITE_` variable for a key.
3. Copy `.env.example` to `.env` and set `ARC_MAINNET_OWNER_ADDRESS`. Keep the RPC at Arc's official Mainnet endpoint and the USDC address at the canonical address shown above. `ARC_MAINNET_PRIVATE_KEY` is required only for broadcast.

### Check, then broadcast

Run from the repository root after Bun, dependencies, and Foundry are installed. Rebuild immediately before each deployment so the artifact matches the Solidity source:

```bash
bun install --frozen-lockfile
bun run contracts:build
bun run test:mainnet-deploy-config
bun run deploy:arc-mainnet --check
bun run deploy:arc-mainnet --broadcast
```

`--check` is read-only: it validates the configured addresses, confirms that the RPC returns chain ID `5042`, checks that USDC has deployed bytecode, and checks the compiled constructor. `--broadcast` is the only mode that submits a Mainnet transaction. It derives and prints the deployer address, verifies its gas balance, waits for one confirmation, checks deployed bytecode and reads back owner, USDC, fee recipient, and the default 200 bps platform fee. It writes the confirmed deployment details to `contracts/deployments/arc-mainnet-HumanLayer.json`. To preserve an earlier deployment record during a replacement deployment, pass a versioned record name with `--record arc-mainnet-HumanLayer-v4.json`.

The private key is read from the process environment (Bun loads local `.env` files); it is never printed or recorded. Do not put a production private key in Vercel because the key is only needed by the deployment script, not by the running application. Back up the deployment JSON and verify/publish the source and compiler settings using Arc Explorer's supported verification flow.

After confirming the onchain readbacks, set `VITE_ARC_CHAIN_ID=5042` and `VITE_HUMANLAYER_MAINNET_ADDRESS` in Vercel Production and deploy. Keep Preview on Testnet. See the readiness checklist above for post-deploy checks and the small-value USDC transaction sequence.

### Important remaining launch requirements

- Complete an independent smart-contract security audit before holding real user funds. The implementation's API spend reservations are advisory for API traffic and do not impose a hard spending cap on direct wallet calls.
- Deployment and bounty-flow transactions consume real Mainnet gas and USDC. The deployer key, production owner, and funded wallet must be configured by the project owner.
- Arc Microgrants: Built with Arc Studio requires a live Mainnet app, contract address plus a real USDC transaction, Arc Studio project URL, public repository, public builder profile, and a video walkthrough. The submission must not claim these artifacts until they exist.
