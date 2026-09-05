// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20MinimalMorpho {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IMorphoBlueMinimal {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

/// @notice CryptoCrawler atomic receiver for Morpho Blue's zero-fee flash loans.
/// @dev Morpho transfers the borrowed token to this contract, invokes
///      onMorphoFlashLoan, then pulls back exactly the principal. Every route
///      remains circular and must leave minProfit after principal repayment.
contract CryptocrawlMorphoFlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IMorphoBlueMinimal public immutable morpho;
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

    constructor(address morphoAddress, address ownerAddress) {
        require(morphoAddress != address(0), "morpho_required");
        require(ownerAddress != address(0), "owner_required");
        morpho = IMorphoBlueMinimal(morphoAddress);
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

    function executeMorphoFlashLoan(
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

        morpho.flashLoan(
            loanToken,
            loanAmount,
            abi.encode(loanToken, profitRecipient, minProfit, steps)
        );

        require(phase == ExecutionPhase.Idle, "flashloan_callback_incomplete");
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        require(msg.sender == address(morpho), "morpho_only");
        require(phase == ExecutionPhase.AwaitingFlashLoan, "unexpected_callback");
        require(assets == expectedLoanAmount, "unexpected_loan_amount");

        phase = ExecutionPhase.ExecutingCallback;
        (address loanToken, address profitRecipient, uint256 minProfit, Step[] memory steps) = abi.decode(
            data,
            (address, address, uint256, Step[])
        );
        require(loanToken == expectedLoanToken, "unexpected_loan_token");
        IERC20MinimalMorpho loanAsset = IERC20MinimalMorpho(loanToken);

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

        // Morpho Blue charges zero flash-loan fee and pulls exactly `assets`
        // after this callback. Profit therefore means balance above principal.
        uint256 finalBalance = loanAsset.balanceOf(address(this));
        require(finalBalance >= assets + minProfit, "profit_below_threshold");

        uint256 profit = finalBalance - assets;
        if (profit > 0) _safeTransfer(loanToken, profitRecipient, profit);

        _safeApprove(loanToken, address(morpho), 0);
        _safeApprove(loanToken, address(morpho), assets);
        emit FlashLoanExecuted(expectedController, loanToken, assets, profit);

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
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20MinimalMorpho.transfer.selector, to, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20MinimalMorpho.approve.selector, spender, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        assembly { returndata := add(returndata, 0x04) }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
