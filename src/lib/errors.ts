/**
 * Parse onchain errors into user-friendly messages.
 * Never expose raw viem/contract error strings to users.
 */

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return JSON.stringify(err)
}

const CONTRACT_ERRORS: Record<string, string> = {
  FeeAccrued: 'Platform fee accrued.',
  FeeWithdrawn: 'Platform fee withdrawn.',
  InvalidCategory: 'Invalid task category.',
  InvalidWorkerCount: 'Worker count must be between 1 and 100.',
  InvalidReward: 'Reward must be greater than zero.',
  InvalidDeadline: 'Deadline must be in the future.',
  BountyNotFound: 'Bounty not found.',
  NotCreator: 'Only the bounty creator can perform this action.',
  InvalidBountyStatus: 'This action is not allowed in the current bounty state.',
  AlreadyFunded: 'This bounty is already fully funded.',
  DeadlinePassed: 'The submission deadline has passed.',
  BountyNotFunded: 'The bounty must be funded before work can be submitted.',
  CreatorCannotSubmit: 'The bounty creator cannot submit work.',
  AlreadySubmitted: 'You have already submitted work for this bounty.',
  BountyFull: 'This bounty has reached its required worker count.',
  NotPending: 'This submission is not in a pending state.',
  BountyCancelledError: 'This bounty has been cancelled.',
  CannotDispute: 'You can only dispute rejected submissions or pending ones after the deadline.',
  NotWorker: 'Only the submitting worker can perform this action.',
  NotDisputed: 'This submission is not in a disputed state.',
  AlreadyClaimed: 'The reward for this submission has already been claimed.',
  InsufficientFunds: 'Insufficient escrowed funds. Please contact support.',
  NotAuthorized: 'You are not authorized to perform this action.',
  InvalidRecipient: 'Invalid fee recipient address.',
  FeeTooHigh: 'Platform fee cannot exceed 10%.',
  InvalidUsdc: 'Invalid USDC token address.',
  InvalidOwner: 'Invalid owner address.',
}

export function parseContractError(err: unknown): string {
  if (!err) return 'Something went wrong. Please try again.'

  const msg = errToString(err).toLowerCase()

  // User rejected
  if (msg.includes('user rejected') || msg.includes('user denied') || msg.includes('4001')) {
    return '' // silently handle: caller should reset state
  }

  // Insufficient USDC
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance') || msg.includes('erc20: transfer amount exceeds balance')) {
    return 'Insufficient USDC balance. Use "Get test USDC" in the sidebar to fund your wallet.'
  }

  // Wrong chain
  if (msg.includes('chain mismatch') || msg.includes('wrong network')) {
    return 'Please switch your wallet to Arc Testnet and try again.'
  }

  // RPC / network
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('rpc')) {
    return 'Network error. Please check your connection and try again.'
  }

  // Custom contract errors
  for (const [errorName, friendlyMsg] of Object.entries(CONTRACT_ERRORS)) {
    if (msg.includes(errorName.toLowerCase()) || msg.includes(`"${errorName}"`)) {
      return friendlyMsg
    }
  }

  // Revert with reason
  if (msg.includes('reverted')) {
    const match = msg.match(/reason[:\s]+"?([^".\n]+)"?/i)
    if (match?.[1]) return `Transaction failed: ${match[1]}`
    return 'Transaction reverted. Please check the parameters and try again.'
  }

  return 'Something went wrong. Please try again.'
}

export function isUserRejection(err: unknown): boolean {
  const msg = errToString(err).toLowerCase()
  return msg.includes('user rejected') || msg.includes('user denied') || msg.includes('4001')
}
