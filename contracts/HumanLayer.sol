// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract HumanLayer is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum BountyStatus {
        Open,
        InProgress,
        Completed,
        Disputed,
        Cancelled
    }

    enum SubmissionStatus {
        Pending,
        Approved,
        Rejected,
        Disputed
    }

    error InvalidCategory();
    error InvalidWorkerCount();
    error InvalidReward();
    error InvalidDeadline();
    error BountyNotFound();
    error NotCreator();
    error InvalidBountyStatus();
    error AlreadyFunded();
    error DeadlinePassed();
    error BountyNotFunded();
    error CreatorCannotSubmit();
    error AlreadySubmitted();
    error BountyFull();
    error NotPending();
    error BountyCancelledError();
    error CannotDispute();
    error NotWorker();
    error NotDisputed();
    error AlreadyClaimed();
    error InsufficientFunds();
    error NotAuthorized();
    error InvalidRecipient();
    error FeeTooHigh();
    error InvalidUsdc();
    error InvalidOwner();

    struct Bounty {
        uint256 bountyId;
        address creator;
        uint256 rewardPerWorker;
        uint8 category;
        bytes32 taskRef;
        uint8 requiredWorkers;
        uint8 acceptedCount;
        uint256 deadline;
        BountyStatus status;
        uint256 totalFunded;
        uint256 totalPaid;
        uint256 pendingApprovedReward;
    }

    struct Submission {
        uint256 submissionId;
        uint256 bountyId;
        address worker;
        bytes32 answerRef;
        SubmissionStatus status;
        bool rewardClaimed;
        uint256 submittedAt;
    }

    IERC20 public immutable usdcToken;

    uint256 private _bountyCounter;
    uint256 private _submissionCounter;

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => Submission) public submissions;
    mapping(uint256 => uint256[]) public bountySubmissions;
    mapping(address => uint256[]) public workerSubmissions;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    uint256 public platformFeeBps;
    address public feeRecipient;
    mapping(address => uint256) public pendingFees;

    mapping(address => uint256) public workerReputation;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        uint256 rewardPerWorker,
        uint8 category,
        bytes32 taskRef,
        uint8 requiredWorkers,
        uint256 deadline
    );

    event BountyFunded(uint256 indexed bountyId, address indexed funder, uint256 amount);

    event WorkSubmitted(
        uint256 indexed submissionId,
        uint256 indexed bountyId,
        address indexed worker,
        bytes32 answerRef
    );

    event SubmissionApproved(uint256 indexed submissionId, uint256 indexed bountyId, address indexed worker);
    event SubmissionRejected(uint256 indexed submissionId, uint256 indexed bountyId, address indexed worker);
    event SubmissionDisputed(uint256 indexed submissionId, uint256 indexed bountyId, address indexed worker);
    event DisputeResolved(uint256 indexed submissionId, uint256 indexed bountyId, bool workerWins);
    event RewardClaimed(uint256 indexed submissionId, address indexed worker, uint256 netAmount, uint256 fee);
    event BountyCancelled(uint256 indexed bountyId, address indexed creator, uint256 refundAmount);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event PlatformFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeAccrued(address indexed recipient, uint256 amount);
    event FeeWithdrawn(address indexed recipient, uint256 amount);

    constructor(address usdcToken_, address initialOwner) Ownable(initialOwner) {
        if (usdcToken_ == address(0)) revert InvalidUsdc();
        if (initialOwner == address(0)) revert InvalidOwner();

        usdcToken = IERC20(usdcToken_);
        _bountyCounter = 1;
        _submissionCounter = 1;
        platformFeeBps = 200;
        feeRecipient = initialOwner;
    }

    function createBounty(
        uint8 category,
        bytes32 taskRef,
        uint8 requiredWorkers,
        uint256 rewardPerWorker,
        uint256 deadline
    ) external returns (uint256 bountyId) {
        if (category >= 6) revert InvalidCategory();
        if (requiredWorkers < 1 || requiredWorkers > 100) revert InvalidWorkerCount();
        if (rewardPerWorker == 0) revert InvalidReward();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        bountyId = _bountyCounter;
        _bountyCounter++;

        bounties[bountyId] = Bounty({
            bountyId: bountyId,
            creator: msg.sender,
            rewardPerWorker: rewardPerWorker,
            category: category,
            taskRef: taskRef,
            requiredWorkers: requiredWorkers,
            acceptedCount: 0,
            deadline: deadline,
            status: BountyStatus.Open,
            totalFunded: 0,
            totalPaid: 0,
            pendingApprovedReward: 0
        });

        emit BountyCreated(bountyId, msg.sender, rewardPerWorker, category, taskRef, requiredWorkers, deadline);
    }

    function fundBounty(uint256 bountyId) external {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.bountyId == 0) revert BountyNotFound();
        if (msg.sender != bounty.creator) revert NotCreator();
        if (bounty.status != BountyStatus.Open && bounty.status != BountyStatus.InProgress) revert InvalidBountyStatus();

        uint256 totalRequired = bounty.rewardPerWorker * bounty.requiredWorkers;
        if (totalRequired == 0) revert InvalidReward();
        if (bounty.totalFunded >= totalRequired) revert AlreadyFunded();

        uint256 amount = totalRequired - bounty.totalFunded;

        bounty.totalFunded += amount;
        if (bounty.status != BountyStatus.InProgress) {
            bounty.status = BountyStatus.Open;
        }

        usdcToken.safeTransferFrom(msg.sender, address(this), amount);

        emit BountyFunded(bountyId, msg.sender, amount);
    }

    function submitWork(uint256 bountyId, bytes32 answerRef) external {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.bountyId == 0) revert BountyNotFound();
        if (bounty.status != BountyStatus.Open && bounty.status != BountyStatus.InProgress) revert InvalidBountyStatus();
        if (block.timestamp > bounty.deadline) revert DeadlinePassed();
        if (bounty.totalFunded < bounty.rewardPerWorker * uint256(bounty.requiredWorkers)) revert BountyNotFunded();
        if (msg.sender == bounty.creator) revert CreatorCannotSubmit();
        if (hasSubmitted[bountyId][msg.sender]) revert AlreadySubmitted();
        if (bounty.acceptedCount >= bounty.requiredWorkers) revert BountyFull();

        uint256 submissionId = _submissionCounter;
        _submissionCounter++;

        submissions[submissionId] = Submission({
            submissionId: submissionId,
            bountyId: bountyId,
            worker: msg.sender,
            answerRef: answerRef,
            status: SubmissionStatus.Pending,
            rewardClaimed: false,
            submittedAt: block.timestamp
        });

        bountySubmissions[bountyId].push(submissionId);
        workerSubmissions[msg.sender].push(submissionId);
        hasSubmitted[bountyId][msg.sender] = true;

        if (bounty.status == BountyStatus.Open) {
            bounty.status = BountyStatus.InProgress;
        }

        emit WorkSubmitted(submissionId, bountyId, msg.sender, answerRef);
    }

    function approveSubmission(uint256 submissionId) external {
        Submission storage submission = submissions[submissionId];
        if (submission.submissionId == 0) revert BountyNotFound();
        if (submission.status != SubmissionStatus.Pending) revert NotPending();

        Bounty storage bounty = bounties[submission.bountyId];
        if (msg.sender != bounty.creator) revert NotCreator();
        if (bounty.acceptedCount >= bounty.requiredWorkers) revert BountyFull();
        if (bounty.status == BountyStatus.Cancelled) revert BountyCancelledError();
        if (bounty.status == BountyStatus.Disputed) revert InvalidBountyStatus();

        submission.status = SubmissionStatus.Approved;
        bounty.acceptedCount += 1;
        bounty.pendingApprovedReward += bounty.rewardPerWorker;

        if (bounty.acceptedCount >= bounty.requiredWorkers) {
            bounty.status = BountyStatus.Completed;
        } else {
            bounty.status = BountyStatus.InProgress;
        }

        emit SubmissionApproved(submissionId, submission.bountyId, submission.worker);
    }

    function rejectSubmission(uint256 submissionId) external {
        Submission storage submission = submissions[submissionId];
        if (submission.submissionId == 0) revert BountyNotFound();
        if (submission.status != SubmissionStatus.Pending) revert NotPending();

        Bounty storage bounty = bounties[submission.bountyId];
        if (msg.sender != bounty.creator) revert NotCreator();

        submission.status = SubmissionStatus.Rejected;

        emit SubmissionRejected(submissionId, submission.bountyId, submission.worker);
    }

    function disputeSubmission(uint256 submissionId) external {
        Submission storage submission = submissions[submissionId];
        if (submission.submissionId == 0) revert BountyNotFound();
        if (msg.sender != submission.worker) revert NotWorker();

        Bounty storage bounty = bounties[submission.bountyId];
        if (bounty.status == BountyStatus.Cancelled) revert BountyCancelledError();
        if (bounty.status == BountyStatus.Completed || bounty.acceptedCount >= bounty.requiredWorkers) {
            revert BountyFull();
        }
        if (
            submission.status != SubmissionStatus.Rejected
                && (submission.status != SubmissionStatus.Pending || block.timestamp <= bounty.deadline)
        ) revert CannotDispute();

        submission.status = SubmissionStatus.Disputed;
        bounty.status = BountyStatus.Disputed;

        emit SubmissionDisputed(submissionId, submission.bountyId, submission.worker);
    }

    function resolveDispute(uint256 submissionId, bool workerWins) external onlyOwner {
        Submission storage submission = submissions[submissionId];
        if (submission.submissionId == 0) revert BountyNotFound();
        if (submission.status != SubmissionStatus.Disputed) revert NotDisputed();

        Bounty storage bounty = bounties[submission.bountyId];

        if (workerWins) {
            if (bounty.status == BountyStatus.Cancelled) revert BountyCancelledError();
            if (bounty.acceptedCount >= bounty.requiredWorkers) revert BountyFull();
            submission.status = SubmissionStatus.Approved;
            bounty.acceptedCount += 1;
            bounty.pendingApprovedReward += bounty.rewardPerWorker;
        } else {
            submission.status = SubmissionStatus.Rejected;
        }

        // Determine correct bounty status after resolving this dispute
        bool hasOtherDisputes = false;
        uint256[] storage subIds = bountySubmissions[submission.bountyId];
        for (uint256 i = 0; i < subIds.length; i++) {
            if (submissions[subIds[i]].status == SubmissionStatus.Disputed) {
                hasOtherDisputes = true;
                break;
            }
        }

        if (hasOtherDisputes) {
            bounty.status = BountyStatus.Disputed;
        } else if (bounty.acceptedCount >= bounty.requiredWorkers) {
            bounty.status = BountyStatus.Completed;
        } else if (bounty.acceptedCount == 0) {
            bounty.status = BountyStatus.Open;
        } else {
            bounty.status = BountyStatus.InProgress;
        }

        emit DisputeResolved(submissionId, submission.bountyId, workerWins);
    }

    function claimReward(uint256 submissionId) external nonReentrant {
        Submission storage submission = submissions[submissionId];
        if (submission.submissionId == 0) revert BountyNotFound();
        if (msg.sender != submission.worker) revert NotWorker();
        if (submission.status != SubmissionStatus.Approved) revert InvalidBountyStatus();
        if (submission.rewardClaimed) revert AlreadyClaimed();

        Bounty storage bounty = bounties[submission.bountyId];
        uint256 reward = bounty.rewardPerWorker;
        if (reward == 0) revert InvalidReward();
        if (bounty.totalFunded < bounty.totalPaid + reward) revert InsufficientFunds();

        uint256 fee = (reward * platformFeeBps) / 10_000;
        uint256 net = reward - fee;

        submission.rewardClaimed = true;
        bounty.pendingApprovedReward -= reward;
        bounty.totalPaid += reward;
        workerReputation[submission.worker] += 1;

        usdcToken.safeTransfer(submission.worker, net);
        if (fee > 0) {
            pendingFees[feeRecipient] += fee;
            emit FeeAccrued(feeRecipient, fee);
        }

        emit RewardClaimed(submissionId, submission.worker, net, fee);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = pendingFees[msg.sender];
        if (amount == 0) revert InsufficientFunds();
        pendingFees[msg.sender] = 0;
        usdcToken.safeTransfer(msg.sender, amount);
        emit FeeWithdrawn(msg.sender, amount);
    }

    function cancelBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.bountyId == 0) revert BountyNotFound();
        if (msg.sender != bounty.creator && msg.sender != owner()) revert NotAuthorized();
        if (bounty.status != BountyStatus.Open && bounty.status != BountyStatus.InProgress) revert InvalidBountyStatus();

        bounty.status = BountyStatus.Cancelled;

        uint256 reservedForApproved = bounty.pendingApprovedReward;
        uint256 refundable = bounty.totalFunded - bounty.totalPaid - reservedForApproved;
        if (refundable > 0) {
            bounty.totalFunded = bounty.totalPaid + reservedForApproved;
            usdcToken.safeTransfer(bounty.creator, refundable);
        }

        emit BountyCancelled(bountyId, bounty.creator, refundable);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        emit FeeRecipientUpdated(feeRecipient, recipient);
        feeRecipient = recipient;
    }

    function setPlatformFee(uint256 feeBps) external onlyOwner {
        if (feeBps > 1000) revert FeeTooHigh();
        emit PlatformFeeUpdated(platformFeeBps, feeBps);
        platformFeeBps = feeBps;
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return submissions[submissionId];
    }

    function getBountySubmissions(uint256 bountyId) external view returns (uint256[] memory) {
        return bountySubmissions[bountyId];
    }

    function getWorkerSubmissions(address worker) external view returns (uint256[] memory) {
        return workerSubmissions[worker];
    }

    function getBountyCount() external view returns (uint256) {
        return _bountyCounter - 1;
    }
}
