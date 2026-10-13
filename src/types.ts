// HumanLayer shared types

export type TaskCategory =
  | 'Science'
  | 'Software'
  | 'Research'
  | 'ImageData'
  | 'Language'
  | 'BiologyMedicine'

export type TaskType =
  | 'Verify'
  | 'Classify'
  | 'Label'
  | 'Compare'
  | 'Research'
  | 'Rate'
  | 'Transcribe'

export type BountyStatus =
  | 'Open'
  | 'InProgress'
  | 'Completed'
  | 'Disputed'
  | 'Cancelled'

export type SubmissionStatus =
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Disputed'

export type DifficultyLevel = 'Easy' | 'Medium' | 'Hard'

export interface Bounty {
  id: string
  bountyId: number
  title: string
  description: string
  instructions: string
  category: TaskCategory
  taskType: TaskType
  difficulty: DifficultyLevel
  rewardPerWorker: number // USDC
  requiredWorkers: number
  acceptedCount: number
  deadline: number // unix timestamp
  status: BountyStatus
  creator: string // wallet address
  taskRef: string // offchain hash/ref
  totalFunded: number
  totalPaid: number
  createdAt: number
  tags: string[]
  estimatedMinutes: number
}

export interface Submission {
  id: string
  submissionId: number
  bountyId: string
  bountyTitle: string
  worker: string
  answer: string
  answerRef: string
  status: SubmissionStatus
  rewardClaimed: boolean
  submittedAt: number
  reviewedAt?: number
}

export interface WorkerProfile {
  address: string
  reputation: number
  totalEarned: number
  submissionsCount: number
  approvedCount: number
  joinedAt: number
}

export interface PlatformStats {
  totalBounties: number
  activeBounties: number
  totalWorkers: number
  totalPaidOut: number
  avgReward: number
}
