# HumanLayer — Production Readiness Audit Report

**Date:** October 8, 2026  
**Contract version:** v3 — `0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2` (Arc Testnet); this report predates the current Mainnet candidate changes.
**Auditors:** solidity-auditor (max severity), functional-auditor (max severity)  
**Tests:** 34 Foundry tests — all pass (`contracts/test/HumanLayer.t.sol`)  

---

## 1. Critical Issues — RESOLVED

### C-1: Unbounded approvals causing approved-but-unpayable workers
**Was:** `approveSubmission` and `resolveDispute(workerWins=true)` both incremented `acceptedCount` without checking `acceptedCount < requiredWorkers`. A creator could approve more submissions than the funded escrow could cover. Workers approved past the funding limit would receive `Approved` status but `claimReward` would revert with `InsufficientFunds`.  
**Fix applied:** Added `if (bounty.acceptedCount >= bounty.requiredWorkers) revert BountyFull();` in both `approveSubmission` (line ~228) and `resolveDispute` workerWins path (line ~282) before any state mutation.  
**Test:** `test_ApproveSubmission_CannotExceedRequiredWorkers`, `test_ResolveDispute_WorkerWins_BountyFull` — both pass.  
**Status:** FIXED

---

## 2. High Priority Issues — RESOLVED

### H-1: Fee recipient can freeze all worker claims (push-fee DoS)
**Was:** `claimReward` pushed fee to `feeRecipient` in the same transaction as the worker payout. A blocklisted or reverting `feeRecipient` would cause all `claimReward` calls to revert, permanently locking approved workers out of their rewards.  
**Fix applied:** Switched to pull-fee accounting. Fees are now accrued in `pendingFees[feeRecipient]` and the recipient must call `withdrawFees()` explicitly. Worker payouts are now independent of fee-recipient behaviour.  
**Test:** `test_ClaimReward_FeeGoesToPendingFees`, `test_WithdrawFees_Success`, `test_WithdrawFees_NoFees` — all pass.  
**Status:** FIXED

### H-2: Missing events on admin setters (auditability gap)
**Was:** `setFeeRecipient` and `setPlatformFee` mutated economically critical state with no events, making fee policy changes invisible to monitoring systems.  
**Fix applied:** Added `FeeRecipientUpdated(oldRecipient, newRecipient)` and `PlatformFeeUpdated(oldBps, newBps)` events with emission on both setters.  
**Test:** `test_SetPlatformFee_EmitsEvent`, `test_SetFeeRecipient_EmitsEvent` — both pass.  
**Status:** FIXED

---

## 3. Medium Priority Issues

### M-1: No deadline gate on `approveSubmission`
**Finding:** `submitWork` enforces `block.timestamp <= deadline`, but `approveSubmission` has no deadline check. A creator can approve pending submissions long after the deadline.  
**Decision:** Not fixed in this pass. Post-deadline approval is a feature, not a bug — the creator may be reviewing legitimately submitted work. Changing this would strand approved workers who submitted before deadline.  
**Mitigation:** Workers can always escalate via `disputeSubmission` after deadline passes, triggering owner review.  
**Status:** ACCEPTED — known limitation, documented.

### M-2: No timelock on fee changes
**Finding:** Owner can change `platformFeeBps` immediately with full effect on pending claims.  
**Current safeguard:** Fee is capped at 10% (`feeBps > 1000` reverts). Fee changes emit an event.  
**Resolution in the current Mainnet candidate:** Each bounty snapshots both `platformFeeBps` and `feeRecipient` at creation. Later owner changes apply only to new bounties, so pending work cannot have its economics changed. The current testnet v3 contract is unchanged; the snapshot requires a new deployment.
**Status:** FIXED in source; pending new deployment and verification.

### M-3: `uint8 acceptedCount` theoretical overflow
**Finding:** `acceptedCount` is `uint8` (max 255). `requiredWorkers` is also `uint8` (max 100 enforced). With the C-1 fix, `acceptedCount` is now bounded by `requiredWorkers` (max 100), so overflow is impossible.  
**Status:** CLOSED by C-1 fix.

---

## 4. Backend Security

### B-1: Rate limiting
**Was:** No rate limiting — any IP could flood the API.  
**Fix applied:** In-memory per-IP rate limiting: 120 req/min for GET, 20 req/min for POST. Buckets auto-evict after the window expires.  
**Limitation:** In-memory; rate limits reset on server restart and do not work across multiple server instances. Sufficient for demo/testnet. Production requires Redis-backed rate limiting.

### B-2: Request body size cap
**Was:** No body size limit — potential memory exhaustion DoS.  
**Fix applied:** 32 KB hard cap on request bodies. Connection is destroyed if exceeded.

### B-3: Input validation
**Status:** Existing `validateBountyPayload` covers all fields. Address validation uses `^0x[0-9a-fA-F]{40}$`. USDC amounts are re-parsed server-side and never trusted from the client. Spending limits enforced before returning onchain instructions.

### B-4: Authentication
**Status:** Bearer API key, SHA-256 hashed at rest. Key returned once on registration with `_warning` in response. Demo key is intentionally exposed in frontend source — it is labeled `_not_for_production` and the demo agent is read-only (it never executes real transactions).

### B-5: Authorization
**Status:** API never submits transactions. All financial operations are performed by the caller's own wallet. The API's `POST /api/bounties` returns a pre-flight intent only. Onchain authorization (creator-only approval, owner-only dispute resolution) is enforced by the smart contract itself.

---

## 5. Frontend Security

### F-1: No private keys in frontend
**Status:** Clean. No private keys, mnemonics, or secrets in frontend source. All signing done by connected wallet.

### F-2: `DEMO_API_KEY` in frontend source
**Finding:** `src/lib/api.ts` exports `DEMO_API_KEY = 'hl_demo_research_agent_key_not_for_production'`. This key is intentionally public (demo agent is read-only and server-side clearly labeled `isDemo: true`). It grants no financial authority — `POST /api/bounties` only returns a pre-flight intent that the user's wallet must still sign.  
**Status:** ACCEPTED — intentional demo key, clearly labeled.

### F-3: Network guard
**Status:** `NetworkGuard` component wraps all transaction pages. Wrong-network state shows a "Switch to Arc Testnet" button with one-click chain switching.

### F-4: Error handling
**Status:** `parseContractError` maps all 24 custom contract errors to user-friendly strings. User rejections are handled silently (no error toast). Insufficient USDC, wrong network, RPC timeout, and revert-with-reason all have dedicated messages.

---

## 6. Arc Network Configuration

Verified against Arc documentation and `@/onchain-facts`:

| Parameter | Value | Source |
|-----------|-------|--------|
| Chain ID | `5042002` | `viem/chains` `arcTestnet` |
| RPC URL | `https://rpc.testnet.arc.io` | `onchain-facts.ts` |
| Explorer | `https://explorer.testnet.arc.io` | `onchain-facts.ts` |
| USDC address | `0x3600000000000000000000000000000000000000` | `onchain-facts.ts` |
| USDC decimals | `6` | `onchain-facts.ts` |
| Native currency | USDC (18 decimals for gas) | `onchain-facts.ts` |

All values match the Arc Testnet official documentation. The native/ERC-20 dual-view is correctly handled — the app uses ERC-20 balance reads exclusively for display (no double-counting).

---

## 7. What Is Ready for Public Demo

- Full bounty lifecycle: create → fund → submit → approve/reject → claim
- Dispute escalation and owner resolution
- Real USDC escrow on Arc Testnet (sub-second finality)
- Agent API with 11 endpoints, rate limiting, spending controls
- Interactive API Playground
- Demo Research Agent simulation (clearly labeled SIMULATED)
- Worker Discovery with reputation profiles
- Activity feed with live onchain event logs
- Admin panel (owner-gated dispute resolution)
- Network guard with auto-chain-switching
- 34 Foundry contract tests — all pass

---

## 8. What Must Be Fixed Before Handling Real Money (Mainnet Checklist)

### Smart Contract
- [x] Snapshot fee and fee recipient at bounty creation time in the Mainnet candidate; deploy as a new contract
- [ ] Consider upgradeability strategy (proxy pattern) or commit to immutable with version migration
- [ ] Get an independent third-party audit from a recognized firm (not completed by this code change)
- [ ] Verify contract source on the mainnet explorer
- [ ] Test with USDC amounts at edge cases (1 wei, max uint256, very small fees)

### Infrastructure
- [ ] Replace in-memory rate limiting with Redis-backed rate limiter (survives restarts, scales horizontally)
- [ ] Replace in-memory agent store with a durable database (Postgres) — current store resets on server restart
- [ ] Add structured logging and alerting for admin actions (fee changes, dispute resolutions)
- [ ] Set up monitoring for `InsufficientFunds` reverts (would indicate accounting bug)
- [ ] Configure `VITE_HUMANLAYER_ADDRESS` env var to avoid hardcoded address in server

### Mainnet Deployment Checklist

| Item | Testnet value | Mainnet value needed |
|------|--------------|---------------------|
| Contract address | `0x07b37d3101b41c0d2eeb983dd8fdc302cc7ce5e2` | TBD after mainnet deploy |
| USDC address | `0x3600000000000000000000000000000000000000` | Arc Mainnet USDC address |
| Chain ID | `5042002` (Arc Testnet) | Arc Mainnet Chain ID |
| Admin wallet | `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer) | Your production wallet |
| Fee recipient | Same as admin | Dedicated treasury address |
| `platformFeeBps` | `200` (2%) | Confirmed value |
| RPC endpoint | `https://rpc.testnet.arc.io` | Arc Mainnet RPC |
| Explorer | `https://explorer.testnet.arc.io` | Arc Mainnet explorer |
| Contract verified | Not verified | Must verify on mainnet explorer |
| Third-party audit | Not done | Required |
| Test results | 34/34 pass | Must re-run on mainnet fork |

---

## 9. Remaining Known Limitations

1. **Offchain agent store is in-memory** — agent registrations, spending limits, and daily spend tracking reset when the API server restarts. All financial enforcement that matters (escrow, payouts) is onchain. The offchain store is advisory only.
2. **No post-deadline approval policy** — creator can approve submissions after bounty deadline. Intentional design decision; documented above.
3. **No multi-sig or governance** for owner role — dispute resolution is centralized. Appropriate for a demo; requires decentralization plan for production.
4. **`DEMO_API_KEY` in frontend source** — intentional for demo UX. Must be removed or rotated before production use if the demo agent gains real onchain capabilities.
5. **Marketplace shows demo data when no onchain bounties exist** — demo banner now shown; underlying demo bounties are not real onchain state.
6. **No email/notification layer** — workers don't get notified when submissions are reviewed; agents don't get notified when submissions arrive. Pull-only UX.
