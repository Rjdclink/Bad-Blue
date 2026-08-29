// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20CompositeMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IBalancerCompositeVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

/**
 * Composite-capable Balancer receiver.
 *
 * V1 remains the standalone receiver and is intentionally not modified because
 * its CREATE2 deployment address is tied to its pinned init-code hash. This V2
 * adds cycle balance checkpoints used only for truthful marginal attribution.
 * Aggregate repayment/profit remains the terminal settlement authority.
 */
contract CryptocrawlBalancerCompositeFlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IBalancerCompositeVault public immutable vault;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;

    enum ExecutionPhase {
        Idle,
        AwaitingFlashLoan,
        ExecutingCallback
    }

    ExecutionPhase private phase;
    address private expectedLoanToken;
    uint256 private expectedLoanAmount;
    address private expectedController;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event CompositeCycleCheckpoint(
        address indexed initiator,
        address indexed loanToken,
        uint256 indexed cycleIndex,
        uint256 endStepIndex,
        uint256 loanTokenBalance
    );
    event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner_only");
        _;
    }

    modifier onlyController() {
        require(msg.sender == owner || operators[msg.sender], "controller_only");
        _;
    }

    modifier onlyIdle() {
        require(phase == ExecutionPhase.Idle, "execution_in_progress");
        _;
    }

    constructor(address vaultAddress, address ownerAddress) {
        require(vaultAddress != address(0), "vault_required");
        require(ownerAddress != address(0), "owner_required");
        vault = IBalancerCompositeVault(vaultAddress);
        owner = ownerAddress;
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "operator_required");
        operators[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner onlyIdle {
        require(target != address(0), "target_required");
        allowedTargets[target] = allowed;
        emit TargetUpdated(target, allowed);
    }

    function setAllowedApprovalToken(address token, bool allowed) external onlyOwner onlyIdle {
        require(token != address(0), "token_required");
        allowedApprovalTokens[token] = allowed;
        emit ApprovalTokenUpdated(token, allowed);
    }

    function executeBalancerCompositeFlashLoan(
        address loanToken,
        uint256 loanAmount,
        Step[] calldata steps,
        uint16[] calldata cycleEndStepIndexes,
        uint256 minProfit,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(loanToken != address(0), "loan_token_required");
        require(loanAmount > 0, "loan_amount_required");
        require(steps.length >= 2, "two_steps_required");
        require(cycleEndStepIndexes.length >= 2, "two_cycles_required");
        require(profitRecipient != address(0), "profit_recipient_required");
        require(cycleEndStepIndexes[cycleEndStepIndexes.length - 1] == steps.length - 1, "last_cycle_must_end_at_last_step");

        uint256 prior = 0;
        for (uint256 i = 0; i < cycleEndStepIndexes.length; i++) {
            uint256 endStep = cycleEndStepIndexes[i];
            require(endStep < steps.length, "cycle_end_out_of_range");
            if (i > 0) require(endStep > prior, "cycle_ends_not_strictly_increasing");
            prior = endStep;
        }

        address[] memory tokens = new address[](1);
        tokens[0] = loanToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        expectedLoanToken = loanToken;
        expectedLoanAmount = loanAmount;
        expectedController = msg.sender;
        phase = ExecutionPhase.AwaitingFlashLoan;

        bytes memory userData = abi.encode(profitRecipient, minProfit, steps, cycleEndStepIndexes);
        vault.flashLoan(address(this), tokens, amounts, userData);
        require(phase == ExecutionPhase.Idle, "flashloan_callback_incomplete");
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == address(vault), "vault_only");
        require(phase == ExecutionPhase.AwaitingFlashLoan, "unexpected_callback");
        require(tokens.length == 1 && amounts.length == 1 && feeAmounts.length == 1, "single_asset_only");
        require(tokens[0] == expectedLoanToken && amounts[0] == expectedLoanAmount, "unexpected_loan");

        phase = ExecutionPhase.ExecutingCallback;
        (address profitRecipient, uint256 minProfit, Step[] memory steps, uint16[] memory cycleEnds) = abi.decode(
            userData,
            (address, uint256, Step[], uint16[])
        );
        IERC20CompositeMinimal loanAsset = IERC20CompositeMinimal(tokens[0]);

        uint256 cycleCursor = 0;
        for (uint256 i = 0; i < steps.length; i++) {
            Step memory step = steps[i];
            require(step.target != address(0), "step_target_required");
            require(allowedTargets[step.target], "target_not_allowed");

            if (step.approvalToken != address(0) && step.approvalAmount > 0) {
                require(allowedApprovalTokens[step.approvalToken], "approval_token_not_allowed");
                _safeApprove(step.approvalToken, step.target, 0);
                _safeApprove(step.approvalToken, step.target, step.approvalAmount);
            }

            (bool success, bytes memory returndata) = step.target.call{value: step.value}(step.callData);
            require(success, _extractRevert(returndata));

            if (cycleCursor < cycleEnds.length && i == cycleEnds[cycleCursor]) {
                emit CompositeCycleCheckpoint(
                    expectedController,
                    tokens[0],
                    cycleCursor,
                    i,
                    loanAsset.balanceOf(address(this))
                );
                cycleCursor++;
            }
        }
        require(cycleCursor == cycleEnds.length, "cycle_checkpoint_incomplete");

        uint256 amountOwed = amounts[0] + feeAmounts[0];
        uint256 finalBalance = loanAsset.balanceOf(address(this));
        require(finalBalance >= amountOwed + minProfit, "profit_below_threshold");
        _safeTransfer(tokens[0], address(vault), amountOwed);

        uint256 profit = loanAsset.balanceOf(address(this));
        if (profit > 0) _safeTransfer(tokens[0], profitRecipient, profit);
        emit FlashLoanExecuted(expectedController, tokens[0], amounts[0], profit);

        expectedLoanToken = address(0);
        expectedLoanAmount = 0;
        expectedController = address(0);
        phase = ExecutionPhase.Idle;
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner onlyIdle {
        _safeTransfer(token, to, amount);
    }

    function rescueNative(address payable to, uint256 amount) external onlyOwner onlyIdle {
        require(to != address(0), "native_recipient_required");
        (bool success,) = to.call{value: amount}("");
        require(success, "native_transfer_failed");
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20CompositeMinimal.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20CompositeMinimal.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        assembly {
            returndata := add(returndata, 0x04)
        }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
