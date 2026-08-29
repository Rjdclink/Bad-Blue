// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20MinimalAave {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAaveV3PoolMinimal {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

contract CryptocrawlAaveV3FlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IAaveV3PoolMinimal public immutable pool;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;

    enum ExecutionPhase { Idle, AwaitingFlashLoan, ExecutingCallback }
    ExecutionPhase private phase;
    address private expectedLoanToken;
    uint256 private expectedLoanAmount;
    address private expectedController;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
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

    constructor(address poolAddress, address ownerAddress) {
        require(poolAddress != address(0), "pool_required");
        require(ownerAddress != address(0), "owner_required");
        pool = IAaveV3PoolMinimal(poolAddress);
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

    function executeAaveFlashLoan(
        address loanToken,
        uint256 loanAmount,
        Step[] calldata steps,
        uint256 minProfit,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(loanToken != address(0), "loan_token_required");
        require(loanAmount > 0, "loan_amount_required");
        require(steps.length >= 2, "two_steps_required");
        require(profitRecipient != address(0), "profit_recipient_required");

        expectedLoanToken = loanToken;
        expectedLoanAmount = loanAmount;
        expectedController = msg.sender;
        phase = ExecutionPhase.AwaitingFlashLoan;

        pool.flashLoanSimple(
            address(this),
            loanToken,
            loanAmount,
            abi.encode(profitRecipient, minProfit, steps),
            0
        );

        require(phase == ExecutionPhase.Idle, "flashloan_callback_incomplete");
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(pool), "pool_only");
        require(phase == ExecutionPhase.AwaitingFlashLoan, "unexpected_callback");
        require(initiator == address(this), "unexpected_initiator");
        require(asset == expectedLoanToken && amount == expectedLoanAmount, "unexpected_loan");

        phase = ExecutionPhase.ExecutingCallback;
        (address profitRecipient, uint256 minProfit, Step[] memory steps) = abi.decode(
            params,
            (address, uint256, Step[])
        );
        IERC20MinimalAave loanAsset = IERC20MinimalAave(asset);

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

        uint256 amountOwed = amount + premium;
        uint256 finalBalance = loanAsset.balanceOf(address(this));
        require(finalBalance >= amountOwed + minProfit, "profit_below_threshold");

        uint256 profit = finalBalance - amountOwed;
        if (profit > 0) _safeTransfer(asset, profitRecipient, profit);

        _safeApprove(asset, address(pool), 0);
        _safeApprove(asset, address(pool), amountOwed);
        emit FlashLoanExecuted(expectedController, asset, amount, profit);

        expectedLoanToken = address(0);
        expectedLoanAmount = 0;
        expectedController = address(0);
        phase = ExecutionPhase.Idle;
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
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20MinimalAave.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20MinimalAave.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        assembly { returndata := add(returndata, 0x04) }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
