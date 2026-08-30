// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20DualMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IBalancerDualVault {
    function flashLoan(address recipient, address[] memory tokens, uint256[] memory amounts, bytes memory userData) external;
}

interface IAaveDualPool {
    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external;
}

/**
 * Same-asset dual-provider atomic receiver.
 * Balancer is the outer loan; Aave is nested inside the Balancer callback.
 * The swap route executes only after both principals are present. Aave repayment
 * is approved first, then Balancer repayment is transferred after Aave returns.
 * Any failed swap, repayment shortfall, or min-profit shortfall reverts the full
 * transaction, so neither provider can be left partially repaid.
 */
contract CryptocrawlAaveBalancerDualFlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IBalancerDualVault public immutable vault;
    IAaveDualPool public immutable pool;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;

    enum ExecutionPhase { Idle, AwaitingBalancer, AwaitingAave, ExecutingRoute }
    ExecutionPhase private phase;
    address private expectedLoanToken;
    uint256 private expectedBalancerAmount;
    uint256 private expectedAaveAmount;
    address private expectedController;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event DualFlashLoanExecuted(
        address indexed initiator,
        address indexed loanToken,
        uint256 balancerAmount,
        uint256 aaveAmount,
        uint256 profit
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

    constructor(address vaultAddress, address poolAddress, address ownerAddress) {
        require(vaultAddress != address(0), "vault_required");
        require(poolAddress != address(0), "pool_required");
        require(ownerAddress != address(0), "owner_required");
        vault = IBalancerDualVault(vaultAddress);
        pool = IAaveDualPool(poolAddress);
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

    function executeDualFlashLoan(
        address loanToken,
        uint256 balancerAmount,
        uint256 aaveAmount,
        Step[] calldata steps,
        uint256 minProfit,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(loanToken != address(0), "loan_token_required");
        require(balancerAmount > 0 && aaveAmount > 0, "both_provider_amounts_required");
        require(steps.length >= 2, "two_steps_required");
        require(profitRecipient != address(0), "profit_recipient_required");

        expectedLoanToken = loanToken;
        expectedBalancerAmount = balancerAmount;
        expectedAaveAmount = aaveAmount;
        expectedController = msg.sender;
        phase = ExecutionPhase.AwaitingBalancer;

        address[] memory tokens = new address[](1);
        tokens[0] = loanToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = balancerAmount;
        vault.flashLoan(
            address(this),
            tokens,
            amounts,
            abi.encode(profitRecipient, minProfit, steps)
        );
        require(phase == ExecutionPhase.Idle, "dual_callback_incomplete");
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == address(vault), "vault_only");
        require(phase == ExecutionPhase.AwaitingBalancer, "unexpected_balancer_callback");
        require(tokens.length == 1 && amounts.length == 1 && feeAmounts.length == 1, "single_asset_only");
        require(tokens[0] == expectedLoanToken && amounts[0] == expectedBalancerAmount, "unexpected_balancer_loan");

        (address profitRecipient, uint256 minProfit, Step[] memory steps) = abi.decode(
            userData,
            (address, uint256, Step[])
        );
        uint256 balancerOwed = amounts[0] + feeAmounts[0];
        phase = ExecutionPhase.AwaitingAave;
        pool.flashLoanSimple(
            address(this),
            tokens[0],
            expectedAaveAmount,
            abi.encode(profitRecipient, minProfit, steps, balancerOwed),
            0
        );

        // Aave pulls its approved repayment before flashLoanSimple returns.
        require(phase == ExecutionPhase.AwaitingBalancer, "aave_callback_incomplete");
        IERC20DualMinimal loanAsset = IERC20DualMinimal(tokens[0]);
        uint256 finalBalance = loanAsset.balanceOf(address(this));
        require(finalBalance >= balancerOwed + minProfit, "profit_below_threshold_after_aave_repayment");
        _safeTransfer(tokens[0], address(vault), balancerOwed);

        uint256 profit = loanAsset.balanceOf(address(this));
        if (profit > 0) _safeTransfer(tokens[0], profitRecipient, profit);
        uint256 totalPrincipal = expectedBalancerAmount + expectedAaveAmount;
        emit DualFlashLoanExecuted(expectedController, tokens[0], expectedBalancerAmount, expectedAaveAmount, profit);
        emit FlashLoanExecuted(expectedController, tokens[0], totalPrincipal, profit);

        expectedLoanToken = address(0);
        expectedBalancerAmount = 0;
        expectedAaveAmount = 0;
        expectedController = address(0);
        phase = ExecutionPhase.Idle;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(pool), "pool_only");
        require(phase == ExecutionPhase.AwaitingAave, "unexpected_aave_callback");
        require(initiator == address(this), "unexpected_initiator");
        require(asset == expectedLoanToken && amount == expectedAaveAmount, "unexpected_aave_loan");

        phase = ExecutionPhase.ExecutingRoute;
        (address profitRecipient, uint256 minProfit, Step[] memory steps, uint256 balancerOwed) = abi.decode(
            params,
            (address, uint256, Step[], uint256)
        );
        require(profitRecipient != address(0), "profit_recipient_required");

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
        }

        uint256 aaveOwed = amount + premium;
        uint256 finalBalance = IERC20DualMinimal(asset).balanceOf(address(this));
        require(finalBalance >= aaveOwed + balancerOwed + minProfit, "profit_below_dual_threshold");
        _safeApprove(asset, address(pool), 0);
        _safeApprove(asset, address(pool), aaveOwed);
        phase = ExecutionPhase.AwaitingBalancer;
        return true;
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
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20DualMinimal.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20DualMinimal.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        assembly { returndata := add(returndata, 0x04) }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
