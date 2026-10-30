// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {HumanLayer} from "../HumanLayer.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract HumanLayerTestHarness is HumanLayer {
    constructor(address usdcToken_, address initialOwner) HumanLayer(usdcToken_, initialOwner) {}

    function setAcceptedCountForTest(uint256 bountyId, uint8 acceptedCount) external {
        bounties[bountyId].acceptedCount = acceptedCount;
    }
}

contract HumanLayerTest is Test {
    // ─── constants ────────────────────────────────────────────────────────────
    uint256 internal constant REWARD    = 100e6;  // 100 USDC per worker (6 dec)
    uint8   internal constant CATEGORY  = 1;
    uint8   internal constant WORKERS   = 2;
    bytes32 internal constant TASK_REF  = keccak256("task-1");
    bytes32 internal constant ANS_REF   = keccak256("answer-1");

    uint256 internal DEADLINE; // set in setUp (block.timestamp + 7 days)

    // platform fee is 2 % = 200 bps
    uint256 internal constant FEE_BPS   = 200;
    uint256 internal constant BPS_DENOM = 10_000;

    // ─── actors ───────────────────────────────────────────────────────────────
    address internal owner   = makeAddr("owner");   // protocol owner + feeRecipient
    address internal creator = makeAddr("creator");
    address internal alice   = makeAddr("alice");   // worker 1
    address internal bob     = makeAddr("bob");     // worker 2
    address internal charlie = makeAddr("charlie"); // random third party

    // ─── contracts ────────────────────────────────────────────────────────────
    MockERC20  internal usdc;
    HumanLayer internal hl;

    // ─── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        // Deploy mock USDC (6 decimals)
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy HumanLayer; owner is both the protocol owner AND initial feeRecipient
        vm.prank(owner);
        hl = new HumanLayerTestHarness(address(usdc), owner);

        DEADLINE = block.timestamp + 7 days;

        // Mint generous balances
        usdc.mint(creator, 10_000e6);
        usdc.mint(alice,   10_000e6);
        usdc.mint(bob,     10_000e6);
        usdc.mint(charlie, 10_000e6);

        // Unlimited approvals for the contract
        vm.prank(creator); usdc.approve(address(hl), type(uint256).max);
        vm.prank(alice);   usdc.approve(address(hl), type(uint256).max);
        vm.prank(bob);     usdc.approve(address(hl), type(uint256).max);
        vm.prank(charlie); usdc.approve(address(hl), type(uint256).max);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /// Create a bounty as `creator` and return the bountyId.
    function _createBounty(uint8 workers) internal returns (uint256 bountyId) {
        vm.prank(creator);
        bountyId = hl.createBounty(CATEGORY, TASK_REF, workers, REWARD, DEADLINE);
    }

    /// Create and fully fund a bounty; return bountyId.
    function _createAndFund(uint8 workers) internal returns (uint256 bountyId) {
        bountyId = _createBounty(workers);
        vm.prank(creator);
        hl.fundBounty(bountyId);
    }

    /// Have `worker` submit work on `bountyId` and return the submissionId.
    function _submitWork(address worker, uint256 bountyId) internal returns (uint256 submissionId) {
        vm.recordLogs();
        vm.prank(worker);
        hl.submitWork(bountyId, ANS_REF);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // WorkSubmitted: submissionId is topics[1] (first indexed param)
        submissionId = uint256(logs[logs.length - 1].topics[1]);
    }

    // =========================================================================
    //  1. test_CreateBounty_Success
    // =========================================================================
    function test_CreateBounty_Success() public {
        vm.prank(creator);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.BountyCreated(1, creator, REWARD, CATEGORY, TASK_REF, WORKERS, DEADLINE);
        uint256 id = hl.createBounty(CATEGORY, TASK_REF, WORKERS, REWARD, DEADLINE);

        assertEq(id, 1, "bountyId should be 1");
        HumanLayer.Bounty memory b = hl.getBounty(id);
        assertEq(b.creator,         creator,                            "creator");
        assertEq(b.rewardPerWorker, REWARD,                             "rewardPerWorker");
        assertEq(b.category,        CATEGORY,                           "category");
        assertEq(b.requiredWorkers, WORKERS,                            "requiredWorkers");
        assertEq(b.deadline,        DEADLINE,                           "deadline");
        assertEq(uint8(b.status),   uint8(HumanLayer.BountyStatus.Open),"status Open");
    }

    // =========================================================================
    //  2. test_CreateBounty_InvalidCategory
    // =========================================================================
    function test_CreateBounty_InvalidCategory() public {
        vm.prank(creator);
        vm.expectRevert(HumanLayer.InvalidCategory.selector);
        hl.createBounty(6, TASK_REF, WORKERS, REWARD, DEADLINE);
    }

    // =========================================================================
    //  3. test_CreateBounty_InvalidDeadline
    // =========================================================================
    function test_CreateBounty_InvalidDeadline() public {
        vm.prank(creator);
        vm.expectRevert(HumanLayer.InvalidDeadline.selector);
        hl.createBounty(CATEGORY, TASK_REF, WORKERS, REWARD, block.timestamp);
    }

    // =========================================================================
    //  4. test_FundBounty_Success
    // =========================================================================
    function test_FundBounty_Success() public {
        uint256 bountyId     = _createBounty(WORKERS);
        uint256 totalRequired = REWARD * WORKERS;

        uint256 creatorBefore = usdc.balanceOf(creator);

        vm.prank(creator);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.BountyFunded(bountyId, creator, totalRequired);
        hl.fundBounty(bountyId);

        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(b.totalFunded, totalRequired,                            "totalFunded");
        assertEq(uint8(b.status), uint8(HumanLayer.BountyStatus.Open),   "status remains Open");
        assertEq(usdc.balanceOf(creator),      creatorBefore - totalRequired, "creator balance decreased");
        assertEq(usdc.balanceOf(address(hl)), totalRequired,              "contract holds funds");
    }

    // =========================================================================
    //  5. test_FundBounty_OnlyCreator
    // =========================================================================
    function test_FundBounty_OnlyCreator() public {
        uint256 bountyId = _createBounty(WORKERS);
        vm.prank(alice);
        vm.expectRevert(HumanLayer.NotCreator.selector);
        hl.fundBounty(bountyId);
    }

    // =========================================================================
    //  6. test_FundBounty_AlreadyFunded
    // =========================================================================
    function test_FundBounty_AlreadyFunded() public {
        uint256 bountyId = _createAndFund(WORKERS);
        vm.prank(creator);
        vm.expectRevert(HumanLayer.AlreadyFunded.selector);
        hl.fundBounty(bountyId);
    }

    // =========================================================================
    //  7. test_SubmitWork_Success
    // =========================================================================
    function test_SubmitWork_Success() public {
        uint256 bountyId = _createAndFund(WORKERS);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(hl));
        emit HumanLayer.WorkSubmitted(1, bountyId, alice, ANS_REF);
        hl.submitWork(bountyId, ANS_REF);

        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(HumanLayer.BountyStatus.InProgress), "status becomes InProgress");
    }

    // =========================================================================
    //  8. test_SubmitWork_CreatorCannotSubmit
    // =========================================================================
    function test_SubmitWork_CreatorCannotSubmit() public {
        uint256 bountyId = _createAndFund(WORKERS);
        vm.prank(creator);
        vm.expectRevert(HumanLayer.CreatorCannotSubmit.selector);
        hl.submitWork(bountyId, ANS_REF);
    }

    // =========================================================================
    //  9. test_SubmitWork_DeadlinePassed
    // =========================================================================
    function test_SubmitWork_DeadlinePassed() public {
        uint256 bountyId = _createAndFund(WORKERS);
        vm.warp(DEADLINE + 1);
        vm.prank(alice);
        vm.expectRevert(HumanLayer.DeadlinePassed.selector);
        hl.submitWork(bountyId, ANS_REF);
    }

    // =========================================================================
    // 10. test_SubmitWork_BountyNotFunded
    // =========================================================================
    function test_SubmitWork_BountyNotFunded() public {
        uint256 bountyId = _createBounty(WORKERS); // NOT funded
        vm.prank(alice);
        vm.expectRevert(HumanLayer.BountyNotFunded.selector);
        hl.submitWork(bountyId, ANS_REF);
    }

    // =========================================================================
    // 11. test_SubmitWork_AlreadySubmitted
    // =========================================================================
    function test_SubmitWork_AlreadySubmitted() public {
        uint256 bountyId = _createAndFund(WORKERS);
        vm.prank(alice);
        hl.submitWork(bountyId, ANS_REF);

        vm.prank(alice);
        vm.expectRevert(HumanLayer.AlreadySubmitted.selector);
        hl.submitWork(bountyId, ANS_REF);
    }

    // =========================================================================
    // 12. test_ApproveSubmission_Success
    // =========================================================================
    function test_ApproveSubmission_Success() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        vm.expectEmit(true, true, true, false, address(hl));
        emit HumanLayer.SubmissionApproved(subId, bountyId, alice);
        hl.approveSubmission(subId);

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertEq(uint8(s.status), uint8(HumanLayer.SubmissionStatus.Approved), "submission Approved");

        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(b.acceptedCount,       1,      "acceptedCount incremented");
        assertEq(b.pendingApprovedReward, REWARD, "pendingApprovedReward updated");
    }

    // =========================================================================
    // 13. test_ApproveSubmission_BountyFull
    //     approveSubmission itself reverts BountyFull when acceptedCount >= requiredWorkers.
    // =========================================================================
    function test_ApproveSubmission_BountyFull() public {
        // requiredWorkers=1; alice submits; creator approves (fills bounty).
        // Bob also submitted before approval; trying to approve bob must revert BountyFull.
        uint256 bountyId   = _createAndFund(1);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob   = _submitWork(bob,   bountyId);

        vm.prank(creator);
        hl.approveSubmission(subIdAlice); // acceptedCount == 1 == requiredWorkers

        // approveSubmission now sees acceptedCount >= requiredWorkers → BountyFull
        vm.prank(creator);
        vm.expectRevert(HumanLayer.BountyFull.selector);
        hl.approveSubmission(subIdBob);
    }

    // =========================================================================
    // 14. test_ApproveSubmission_CannotExceedRequiredWorkers
    //     Same guard: a second approval on a different pending submission when
    //     the bounty is already full reverts BountyFull.
    // =========================================================================
    function test_ApproveSubmission_CannotExceedRequiredWorkers() public {
        uint256 bountyId   = _createAndFund(1);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob   = _submitWork(bob,   bountyId);

        vm.prank(creator);
        hl.approveSubmission(subIdAlice); // acceptedCount becomes 1 == requiredWorkers

        vm.prank(creator);
        vm.expectRevert(HumanLayer.BountyFull.selector);
        hl.approveSubmission(subIdBob);
    }

    // =========================================================================
    // 15. test_RejectSubmission_Success
    // =========================================================================
    function test_RejectSubmission_Success() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        vm.expectEmit(true, true, true, false, address(hl));
        emit HumanLayer.SubmissionRejected(subId, bountyId, alice);
        hl.rejectSubmission(subId);

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertEq(uint8(s.status), uint8(HumanLayer.SubmissionStatus.Rejected), "submission Rejected");
    }

    // =========================================================================
    // 16. test_ClaimReward_Success
    //     Fee is accumulated in pendingFees[feeRecipient], NOT pushed directly.
    // =========================================================================
    function test_ClaimReward_Success() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);

        uint256 fee = (REWARD * FEE_BPS) / BPS_DENOM; // 2e6
        uint256 net = REWARD - fee;                    // 98e6

        uint256 aliceBefore    = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(hl));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.RewardClaimed(subId, alice, net, fee);
        hl.claimReward(subId);

        // Alice receives net amount
        assertEq(usdc.balanceOf(alice), aliceBefore + net, "alice net reward");
        // Fee stays inside the contract (pull model)
        assertEq(usdc.balanceOf(address(hl)), contractBefore - net, "contract balance down by net");
        // pendingFees[feeRecipient] accrued
        assertEq(hl.pendingFees(owner), fee, "fee accrued in pendingFees");

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertTrue(s.rewardClaimed, "rewardClaimed flag set");
    }

    // =========================================================================
    // 17. test_ClaimReward_AlreadyClaimed
    // =========================================================================
    function test_ClaimReward_AlreadyClaimed() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);

        vm.prank(alice);
        hl.claimReward(subId);

        vm.prank(alice);
        vm.expectRevert(HumanLayer.AlreadyClaimed.selector);
        hl.claimReward(subId);
    }

    // =========================================================================
    // 18. test_ClaimReward_NotWorker
    // =========================================================================
    function test_ClaimReward_NotWorker() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);

        vm.prank(bob);
        vm.expectRevert(HumanLayer.NotWorker.selector);
        hl.claimReward(subId);
    }

    // =========================================================================
    // 19. test_ClaimReward_FeeGoesToPendingFees
    //     The contract uses a PULL model: fees accumulate in pendingFees[feeRecipient]
    //     and are NOT transferred immediately to the feeRecipient's wallet.
    // =========================================================================
    function test_ClaimReward_FeeGoesToPendingFees() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);

        uint256 fee = (REWARD * FEE_BPS) / BPS_DENOM;

        vm.prank(alice);
        hl.claimReward(subId);

        // Fee stays in contract, credited to feeRecipient in pendingFees
        assertEq(hl.pendingFees(owner),       fee, "pendingFees[owner] == fee");
        assertEq(usdc.balanceOf(owner),         0,  "feeRecipient wallet unchanged (pull model)");
    }

    // =========================================================================
    // 20. test_WithdrawFees_Success
    //     Owner (feeRecipient) calls withdrawFees() to pull accrued fees.
    // =========================================================================
    function test_WithdrawFees_Success() public {
        // First accrue a fee via claimReward
        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);

        vm.prank(alice);
        hl.claimReward(subId);

        uint256 fee          = (REWARD * FEE_BPS) / BPS_DENOM;
        uint256 ownerBefore  = usdc.balanceOf(owner);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(hl));
        emit HumanLayer.FeeWithdrawn(owner, fee);
        hl.withdrawFees();

        assertEq(usdc.balanceOf(owner),  ownerBefore + fee, "owner received fees");
        assertEq(hl.pendingFees(owner),  0,                  "pendingFees cleared");
    }

    // =========================================================================
    // 21. test_WithdrawFees_NoFees
    //     withdrawFees() reverts InsufficientFunds when nothing accrued.
    // =========================================================================
    function test_WithdrawFees_NoFees() public {
        vm.prank(owner);
        vm.expectRevert(HumanLayer.InsufficientFunds.selector);
        hl.withdrawFees();
    }

    // =========================================================================
    // 22. test_CancelBounty_RefundsUnreserved
    //     Cancel with no approved submissions → full refund.
    // =========================================================================
    function test_CancelBounty_RefundsUnreserved() public {
        uint256 bountyId    = _createAndFund(WORKERS);
        uint256 totalFunded = REWARD * WORKERS;

        uint256 creatorBefore = usdc.balanceOf(creator);

        vm.prank(creator);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.BountyCancelled(bountyId, creator, totalFunded);
        hl.cancelBounty(bountyId);

        assertEq(usdc.balanceOf(creator), creatorBefore + totalFunded, "full refund");
        assertEq(uint8(hl.getBounty(bountyId).status),
                 uint8(HumanLayer.BountyStatus.Cancelled), "status Cancelled");
    }

    // =========================================================================
    // 23. test_CancelBounty_DoesNotRefundApprovedReward
    //     Approved-but-unclaimed reward is reserved; cancel refunds only the rest.
    // =========================================================================
    function test_CancelBounty_DoesNotRefundApprovedReward() public {
        uint256 bountyId = _createAndFund(WORKERS);  // totalFunded = 2 * REWARD
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.approveSubmission(subId); // pendingApprovedReward = REWARD

        uint256 creatorBefore = usdc.balanceOf(creator);

        vm.prank(creator);
        hl.cancelBounty(bountyId);

        // refundable = totalFunded(2*REWARD) - totalPaid(0) - pendingApprovedReward(REWARD)
        uint256 expectedRefund = REWARD * WORKERS - REWARD;
        assertEq(usdc.balanceOf(creator), creatorBefore + expectedRefund, "partial refund only");
    }

    // =========================================================================
    // 24. test_CancelBounty_OnlyCreatorOrOwner
    // =========================================================================
    function test_CancelBounty_OnlyCreatorOrOwner() public {
        uint256 bountyId = _createAndFund(WORKERS);
        vm.prank(charlie);
        vm.expectRevert(HumanLayer.NotAuthorized.selector);
        hl.cancelBounty(bountyId);
    }

    // =========================================================================
    // 25. test_DisputeSubmission_WorkerCanDispute
    //     Worker escalates a rejected submission.
    // =========================================================================
    function test_DisputeSubmission_WorkerCanDispute() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false, address(hl));
        emit HumanLayer.SubmissionDisputed(subId, bountyId, alice);
        hl.disputeSubmission(subId);

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertEq(uint8(s.status), uint8(HumanLayer.SubmissionStatus.Disputed), "submission Disputed");

        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(HumanLayer.BountyStatus.Disputed), "bounty Disputed");
    }

    // =========================================================================
    // 26. test_DisputeSubmission_CancelledBounty
    // =========================================================================
    function test_DisputeSubmission_CancelledBounty() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);

        vm.prank(creator);
        hl.cancelBounty(bountyId);

        vm.prank(alice);
        vm.expectRevert(HumanLayer.BountyCancelledError.selector);
        hl.disputeSubmission(subId);
    }

    // =========================================================================
    // 27. test_ResolveDispute_WorkerWins
    //     Disputed submission resolved in worker's favour → Approved; bounty InProgress.
    // =========================================================================
    function test_ResolveDispute_WorkerWins() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);

        vm.prank(alice);
        hl.disputeSubmission(subId);

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.DisputeResolved(subId, bountyId, true);
        hl.resolveDispute(subId, true);

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertEq(uint8(s.status), uint8(HumanLayer.SubmissionStatus.Approved), "submission Approved");

        // acceptedCount(1) < requiredWorkers(2) → InProgress
        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(HumanLayer.BountyStatus.InProgress), "bounty InProgress");
    }

    // =========================================================================
    // 28. test_ResolveDispute_AdminWins
    //     Disputed submission resolved in admin's favour → Rejected; bounty Open.
    // =========================================================================
    function test_ResolveDispute_AdminWins() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subId    = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);

        vm.prank(alice);
        hl.disputeSubmission(subId);

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(hl));
        emit HumanLayer.DisputeResolved(subId, bountyId, false);
        hl.resolveDispute(subId, false);

        HumanLayer.Submission memory s = hl.getSubmission(subId);
        assertEq(uint8(s.status), uint8(HumanLayer.SubmissionStatus.Rejected), "submission Rejected");

        // acceptedCount == 0 → Open
        HumanLayer.Bounty memory b = hl.getBounty(bountyId);
        assertEq(uint8(b.status), uint8(HumanLayer.BountyStatus.Open), "bounty Open");
    }

    // =========================================================================
    // 29. test_DisputeSubmission_CompletedBounty_RevertsBountyFull
    //     Completed bounties cannot be reopened by a rejected submission's dispute.
    // =========================================================================
    function test_DisputeSubmission_CompletedBounty_RevertsBountyFull() public {
        uint256 bountyId   = _createAndFund(1);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob   = _submitWork(bob,   bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subIdBob);

        vm.prank(creator);
        hl.approveSubmission(subIdAlice);

        vm.prank(bob);
        vm.expectRevert(HumanLayer.BountyFull.selector);
        hl.disputeSubmission(subIdBob);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Completed),
            "completed bounty stays completed"
        );
    }

    function test_DisputeSubmission_CompletedBountyWithPendingSubmission_RevertsBountyFull() public {
        uint256 bountyId   = _createAndFund(1);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob   = _submitWork(bob, bountyId);

        vm.prank(creator);
        hl.approveSubmission(subIdAlice);
        vm.warp(DEADLINE + 1);

        vm.prank(bob);
        vm.expectRevert(HumanLayer.BountyFull.selector);
        hl.disputeSubmission(subIdBob);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Completed),
            "completed bounty stays completed"
        );
    }

    function test_ApproveSubmission_WhileDisputed_Reverts() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob = _submitWork(bob, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subIdAlice);
        vm.prank(alice);
        hl.disputeSubmission(subIdAlice);

        vm.prank(creator);
        vm.expectRevert(HumanLayer.InvalidBountyStatus.selector);
        hl.approveSubmission(subIdBob);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Disputed),
            "bounty remains disputed"
        );
    }

    function test_DisputeSubmission_SerializesSimultaneousDisputes() public {
        uint256 bountyId = _createAndFund(WORKERS);
        uint256 subIdAlice = _submitWork(alice, bountyId);
        uint256 subIdBob = _submitWork(bob, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subIdAlice);
        vm.prank(creator);
        hl.rejectSubmission(subIdBob);

        vm.prank(alice);
        hl.disputeSubmission(subIdAlice);

        vm.prank(bob);
        vm.expectRevert(HumanLayer.InvalidBountyStatus.selector);
        hl.disputeSubmission(subIdBob);

        vm.prank(owner);
        hl.resolveDispute(subIdAlice, false);

        vm.prank(bob);
        hl.disputeSubmission(subIdBob);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Disputed),
            "the second dispute is handled after the first is resolved"
        );
    }

    function test_ResolveDispute_WorkerWinsAtCapacity_Reverts() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);
        vm.prank(alice);
        hl.disputeSubmission(subId);
        HumanLayerTestHarness(address(hl)).setAcceptedCountForTest(bountyId, 1);

        vm.prank(owner);
        vm.expectRevert(HumanLayer.BountyFull.selector);
        hl.resolveDispute(subId, true);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Disputed),
            "failed worker-win resolution leaves dispute unchanged"
        );
    }

    function test_ResolveDispute_WorkerLossAtCapacity_StaysCompleted() public {
        uint256 bountyId = _createAndFund(1);
        uint256 subId = _submitWork(alice, bountyId);

        vm.prank(creator);
        hl.rejectSubmission(subId);
        vm.prank(alice);
        hl.disputeSubmission(subId);
        HumanLayerTestHarness(address(hl)).setAcceptedCountForTest(bountyId, 1);

        vm.prank(owner);
        hl.resolveDispute(subId, false);

        assertEq(
            uint8(hl.getBounty(bountyId).status),
            uint8(HumanLayer.BountyStatus.Completed),
            "worker-loss resolution does not reopen a full bounty"
        );
    }

    // =========================================================================
    // 30. test_SetPlatformFee_EmitsEvent
    // =========================================================================
    function test_SetPlatformFee_EmitsEvent() public {
        uint256 oldFee = hl.platformFeeBps(); // 200

        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(hl));
        emit HumanLayer.PlatformFeeUpdated(oldFee, 500);
        hl.setPlatformFee(500);

        assertEq(hl.platformFeeBps(), 500, "fee updated");
    }

    // =========================================================================
    // 31. test_SetFeeRecipient_EmitsEvent
    // =========================================================================
    function test_SetFeeRecipient_EmitsEvent() public {
        address oldRecipient = hl.feeRecipient(); // == owner

        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(hl));
        emit HumanLayer.FeeRecipientUpdated(oldRecipient, alice);
        hl.setFeeRecipient(alice);

        assertEq(hl.feeRecipient(), alice, "feeRecipient updated");
    }

    // =========================================================================
    // 32. test_PlatformFee_Cap
    // =========================================================================
    function test_PlatformFee_Cap() public {
        vm.prank(owner);
        vm.expectRevert(HumanLayer.FeeTooHigh.selector);
        hl.setPlatformFee(1001);
    }

    // =========================================================================
    // 33. test_GetBountyCount
    // =========================================================================
    function test_GetBountyCount() public {
        assertEq(hl.getBountyCount(), 0, "initially 0 bounties");
        _createBounty(1);
        assertEq(hl.getBountyCount(), 1, "1 bounty");
        _createBounty(1);
        assertEq(hl.getBountyCount(), 2, "2 bounties");
    }

    // =========================================================================
    // 34. test_WorkerReputation_IncrementsOnClaim
    // =========================================================================
    function test_WorkerReputation_IncrementsOnClaim() public {
        assertEq(hl.workerReputation(alice), 0, "starts at 0");

        uint256 bountyId = _createAndFund(1);
        uint256 subId    = _submitWork(alice, bountyId);
        vm.prank(creator);
        hl.approveSubmission(subId);
        vm.prank(alice);
        hl.claimReward(subId);

        assertEq(hl.workerReputation(alice), 1, "reputation incremented after claim");
    }
}
