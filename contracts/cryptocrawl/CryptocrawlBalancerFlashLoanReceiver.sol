// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IMorphoLiquidationCore {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function liquidate(
        MarketParams calldata marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes calldata data
    ) external returns (uint256 assetsSeized, uint256 assetsRepaid);
}

contract CryptocrawlBalancerFlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IBalancerVault public immutable vault;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;
    enum ExecutionPhase {
        Idle,
        AwaitingFlashLoan,
        ExecutingCallback,
        AwaitingMorphoLiquidation,
        ExecutingMorphoLiquidation
    }

    ExecutionPhase private phase;
    address private expectedLoanToken;
    uint256 private expectedLoanAmount;
    address private expectedController;

    address private expectedMorpho;
    address private expectedCollateralToken;
    address private expectedBorrower;
    uint256 private expectedSeizedAssets;
    uint256 private startingMorphoLoanBalance;
    uint256 private morphoCallbackRepaidAssets;
    uint256 private morphoCallbackProfit;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit);
    event MorphoLiquidationExecuted(
        address indexed initiator,
        address indexed morpho,
        address indexed borrower,
        address loanToken,
        address collateralToken,
        uint256 seizedAssets,
        uint256 repaidAssets,
        uint256 profit
    );

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
        vault = IBalancerVault(vaultAddress);
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

    function executeBalancerFlashLoan(
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

        address[] memory tokens = new address[](1);
        tokens[0] = loanToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        expectedLoanToken = loanToken;
        expectedLoanAmount = loanAmount;
        expectedController = msg.sender;
        phase = ExecutionPhase.AwaitingFlashLoan;

        bytes memory userData = abi.encode(profitRecipient, minProfit, steps);
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

        (address profitRecipient, uint256 minProfit, Step[] memory steps) = abi.decode(
            userData,
            (address, uint256, Step[])
        );

        IERC20Minimal loanAsset = IERC20Minimal(tokens[0]);
        _executeSteps(steps, false);

        uint256 amountOwed = amounts[0] + feeAmounts[0];
        uint256 finalBalance = loanAsset.balanceOf(address(this));
        require(finalBalance >= amountOwed + minProfit, "profit_below_threshold");

        _safeTransfer(tokens[0], address(vault), amountOwed);

        uint256 profit = loanAsset.balanceOf(address(this));
        if (profit > 0) {
            _safeTransfer(tokens[0], profitRecipient, profit);
        }

        emit FlashLoanExecuted(expectedController, tokens[0], amounts[0], profit);

        expectedLoanToken = address(0);
        expectedLoanAmount = 0;
        expectedController = address(0);
        phase = ExecutionPhase.Idle;
    }

    /// @notice Executes a Morpho Blue liquidation without prefunding the repayment asset.
    /// @dev Morpho transfers seized collateral to this receiver before invoking
    ///      onMorphoLiquidate. The callback atomically unwinds that collateral,
    ///      proves a strictly positive loan-token delta, and only then approves the
    ///      exact repayment that Morpho pulls after the callback returns. Returning
    ///      the exact repayment/profit lets eth_call use protocol execution itself
    ///      as the read-only pricing authority instead of duplicating Morpho math.
    function executeMorphoLiquidation(
        address morpho,
        IMorphoLiquidationCore.MarketParams calldata marketParams,
        address borrower,
        uint256 seizedAssets,
        Step[] calldata steps,
        uint256 minProfit,
        address profitRecipient
    ) external onlyController onlyIdle returns (uint256 repaidAssets, uint256 profit) {
        require(morpho != address(0) && allowedTargets[morpho], "morpho_not_allowed");
        require(marketParams.loanToken != address(0), "loan_token_required");
        require(marketParams.collateralToken != address(0), "collateral_token_required");
        require(marketParams.oracle != address(0), "oracle_required");
        require(borrower != address(0), "borrower_required");
        require(seizedAssets > 0, "seized_assets_required");
        require(steps.length > 0, "unwind_step_required");
        require(profitRecipient != address(0), "profit_recipient_required");
        require(allowedApprovalTokens[marketParams.loanToken], "loan_token_not_allowed");
        require(allowedApprovalTokens[marketParams.collateralToken], "collateral_token_not_allowed");

        expectedMorpho = morpho;
        expectedLoanToken = marketParams.loanToken;
        expectedCollateralToken = marketParams.collateralToken;
        expectedBorrower = borrower;
        expectedSeizedAssets = seizedAssets;
        expectedController = msg.sender;
        startingMorphoLoanBalance = IERC20Minimal(marketParams.loanToken).balanceOf(address(this));
        morphoCallbackRepaidAssets = 0;
        morphoCallbackProfit = 0;
        phase = ExecutionPhase.AwaitingMorphoLiquidation;

        bytes memory callbackData = abi.encode(profitRecipient, minProfit, steps);
        IMorphoLiquidationCore(morpho).liquidate(
            marketParams,
            borrower,
            seizedAssets,
            0,
            callbackData
        );

        require(phase == ExecutionPhase.AwaitingMorphoLiquidation, "morpho_callback_incomplete");
        require(morphoCallbackRepaidAssets > 0, "morpho_repayment_missing");

        repaidAssets = morphoCallbackRepaidAssets;
        profit = morphoCallbackProfit;
        emit MorphoLiquidationExecuted(
            expectedController,
            expectedMorpho,
            expectedBorrower,
            expectedLoanToken,
            expectedCollateralToken,
            expectedSeizedAssets,
            repaidAssets,
            profit
        );

        expectedMorpho = address(0);
        expectedLoanToken = address(0);
        expectedCollateralToken = address(0);
        expectedBorrower = address(0);
        expectedSeizedAssets = 0;
        expectedController = address(0);
        startingMorphoLoanBalance = 0;
        morphoCallbackRepaidAssets = 0;
        morphoCallbackProfit = 0;
        phase = ExecutionPhase.Idle;
    }

    function onMorphoLiquidate(uint256 repaidAssets, bytes calldata data) external {
        require(msg.sender == expectedMorpho && expectedMorpho != address(0), "morpho_only");
        require(phase == ExecutionPhase.AwaitingMorphoLiquidation, "unexpected_morpho_callback");
        require(repaidAssets > 0, "repaid_assets_required");
        require(IERC20Minimal(expectedCollateralToken).balanceOf(address(this)) >= expectedSeizedAssets, "seized_collateral_missing");

        phase = ExecutionPhase.ExecutingMorphoLiquidation;
        (address profitRecipient, uint256 minProfit, Step[] memory steps) = abi.decode(
            data,
            (address, uint256, Step[])
        );

        // A zero-prefund liquidation may not spend native balance during the
        // callback. Every economic input must come from the seized collateral.
        _executeSteps(steps, true);

        uint256 finalLoanBalance = IERC20Minimal(expectedLoanToken).balanceOf(address(this));
        require(
            finalLoanBalance >= startingMorphoLoanBalance + repaidAssets + minProfit,
            "profit_below_threshold"
        );

        uint256 profit = finalLoanBalance - startingMorphoLoanBalance - repaidAssets;
        if (profit > 0) {
            _safeTransfer(expectedLoanToken, profitRecipient, profit);
        }

        _safeApprove(expectedLoanToken, expectedMorpho, 0);
        _safeApprove(expectedLoanToken, expectedMorpho, repaidAssets);
        morphoCallbackRepaidAssets = repaidAssets;
        morphoCallbackProfit = profit;
        phase = ExecutionPhase.AwaitingMorphoLiquidation;
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner onlyIdle {
        _safeTransfer(token, to, amount);
    }

    function rescueNative(address payable to, uint256 amount) external onlyOwner onlyIdle {
        require(to != address(0), "native_recipient_required");
        (bool success,) = to.call{value: amount}("");
        require(success, "native_transfer_failed");
    }

    function _executeSteps(Step[] memory steps, bool requireZeroNativeValue) internal {
        for (uint256 i = 0; i < steps.length; i++) {
            Step memory step = steps[i];
            require(step.target != address(0), "step_target_required");
            require(allowedTargets[step.target], "target_not_allowed");
            if (requireZeroNativeValue) require(step.value == 0, "zero_prefund_native_value_forbidden");

            if (step.approvalToken != address(0) && step.approvalAmount > 0) {
                require(allowedApprovalTokens[step.approvalToken], "approval_token_not_allowed");
                _safeApprove(step.approvalToken, step.target, 0);
                _safeApprove(step.approvalToken, step.target, step.approvalAmount);
            }

            (bool success, bytes memory returndata) = step.target.call{value: step.value}(step.callData);
            require(success, _extractRevert(returndata));
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) {
            return "step_call_failed";
        }
        assembly {
            returndata := add(returndata, 0x04)
        }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
