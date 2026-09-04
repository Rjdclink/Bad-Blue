// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20BuilderSponsoredMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWETHBuilderSponsored is IERC20BuilderSponsoredMinimal {
    function withdraw(uint256 amount) external;
}

interface IBalancerBuilderSponsoredVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

/**
 * Opportunity-backed Balancer V2 flash-loan receiver for the zero-operator-capital
 * bootstrap lane.
 *
 * The caller supplies an atomic route whose terminal balances must simultaneously
 * cover: (1) Balancer principal + measured fee, (2) a strictly positive residual
 * profit floor in the loan token, and (3) an exact WETH budget used to repay the
 * block builder that sponsored the top-level EOA's native gas.
 *
 * Existing V1/V2 receivers are intentionally not modified. This contract is a new
 * execution surface so pinned deployment hashes and existing live behavior remain
 * unchanged.
 */
contract CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    IBalancerBuilderSponsoredVault public immutable vault;
    IWETHBuilderSponsored public immutable weth;

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
    event BuilderSponsoredFlashLoanExecuted(
        address indexed initiator,
        address indexed loanToken,
        uint256 loanAmount,
        uint256 loanTokenProfit,
        address indexed builderCoinbase,
        uint256 builderPaymentWei,
        uint256 residualWeth
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

    constructor(address vaultAddress, address ownerAddress, address wethAddress) {
        require(vaultAddress != address(0), "vault_required");
        require(ownerAddress != address(0), "owner_required");
        require(wethAddress != address(0), "weth_required");
        vault = IBalancerBuilderSponsoredVault(vaultAddress);
        owner = ownerAddress;
        weth = IWETHBuilderSponsored(wethAddress);
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

    function executeBuilderSponsoredBalancerFlashLoan(
        address loanToken,
        uint256 loanAmount,
        Step[] calldata steps,
        uint256 minResidualProfit,
        uint256 builderPaymentWei,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(loanToken != address(0), "loan_token_required");
        require(loanAmount > 0, "loan_amount_required");
        require(steps.length >= 2, "two_steps_required");
        require(minResidualProfit > 0, "positive_residual_required");
        require(builderPaymentWei > 0, "builder_payment_required");
        require(profitRecipient != address(0), "profit_recipient_required");

        address[] memory tokens = new address[](1);
        tokens[0] = loanToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        expectedLoanToken = loanToken;
        expectedLoanAmount = loanAmount;
        expectedController = msg.sender;
        phase = ExecutionPhase.AwaitingFlashLoan;

        bytes memory userData = abi.encode(
            profitRecipient,
            minResidualProfit,
            builderPaymentWei,
            steps
        );
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
        (
            address profitRecipient,
            uint256 minResidualProfit,
            uint256 builderPaymentWei,
            Step[] memory steps
        ) = abi.decode(userData, (address, uint256, uint256, Step[]));

        IERC20BuilderSponsoredMinimal loanAsset = IERC20BuilderSponsoredMinimal(tokens[0]);
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

        uint256 amountOwed = amounts[0] + feeAmounts[0];
        uint256 loanBalance = loanAsset.balanceOf(address(this));
        if (tokens[0] == address(weth)) {
            require(
                loanBalance >= amountOwed + minResidualProfit + builderPaymentWei,
                "profit_or_builder_budget_below_threshold"
            );
        } else {
            require(loanBalance >= amountOwed + minResidualProfit, "profit_below_threshold");
            require(weth.balanceOf(address(this)) >= builderPaymentWei, "builder_weth_budget_missing");
        }

        // Repayment is reserved first. If anything after this point fails, EVM
        // atomicity reverts the repayment transfer and every preceding route step.
        _safeTransfer(tokens[0], address(vault), amountOwed);

        // The opportunity—not the operator—creates this WETH balance. Unwrap only
        // the hard-bounded builder amount, then pay the actual builder beneficiary
        // selected for this block. `call` supports contract coinbase recipients.
        weth.withdraw(builderPaymentWei);
        (bool builderPaid,) = payable(block.coinbase).call{value: builderPaymentWei}("");
        require(builderPaid, "builder_payment_failed");

        uint256 profit = loanAsset.balanceOf(address(this));
        require(profit >= minResidualProfit, "terminal_residual_below_threshold");
        if (profit > 0) _safeTransfer(tokens[0], profitRecipient, profit);

        uint256 residualWeth = 0;
        if (tokens[0] != address(weth)) {
            residualWeth = weth.balanceOf(address(this));
            if (residualWeth > 0) _safeTransfer(address(weth), profitRecipient, residualWeth);
        }

        emit BuilderSponsoredFlashLoanExecuted(
            expectedController,
            tokens[0],
            amounts[0],
            profit,
            block.coinbase,
            builderPaymentWei,
            residualWeth
        );

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
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20BuilderSponsoredMinimal.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20BuilderSponsoredMinimal.approve.selector, spender, amount)
        );
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
