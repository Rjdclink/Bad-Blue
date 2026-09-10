// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20GhostBridge {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC3156FlashBorrowerGhostBridge {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

interface IERC3156FlashLenderGhostBridge {
    function maxFlashLoan(address token) external view returns (uint256);
    function flashFee(address token, uint256 amount) external view returns (uint256);
    function flashLoan(
        IERC3156FlashBorrowerGhostBridge receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);
}

/// @notice Permissionless, zero-operator-capital ERC-3156 credit intermediary.
/// @dev The downstream borrower initiates the transaction and therefore supplies
///      transaction gas. Ghost never fronts principal or native gas. The upstream
///      lender supplies principal atomically; the downstream borrower must repay
///      principal + borrowerFee in the same transaction; the upstream lender is
///      approved for principal + upstreamFee; and only the positive fee spread is
///      delivered to profitRecipient. Any mismatch reverts the entire transaction.
contract CryptocrawlGhostWalletErc3156Bridge is IERC3156FlashBorrowerGhostBridge {
    uint256 private constant BPS = 10_000;
    bytes32 private constant ERC3156_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    address public immutable owner;
    address public immutable profitRecipient;
    uint16 public minimumBrokerSpreadBps;

    bool private active;
    bool private callbackCompleted;
    address private expectedLender;
    address private expectedBorrower;
    address private expectedInitiator;
    address private expectedToken;
    uint256 private expectedAmount;
    uint256 private expectedUpstreamFee;
    uint256 private expectedBorrowerFee;
    uint256 private expectedStartingBalance;

    event MinimumBrokerSpreadUpdated(uint16 spreadBps);
    event ExternalCreditBrokered(
        address indexed lender,
        address indexed borrower,
        address indexed token,
        uint256 principal,
        uint256 upstreamFee,
        uint256 borrowerFee,
        uint256 realizedSpread,
        address profitRecipient,
        address initiator
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "owner_only");
        _;
    }

    modifier onlyIdle() {
        require(!active, "intermediation_in_progress");
        _;
    }

    constructor(address ownerAddress, address profitRecipientAddress) {
        require(ownerAddress != address(0), "owner_required");
        require(profitRecipientAddress != address(0), "profit_recipient_required");
        owner = ownerAddress;
        profitRecipient = profitRecipientAddress;
        // Zero means no fixed BPS hurdle. A successful loan still requires at
        // least one smallest token unit of positive spread.
        minimumBrokerSpreadBps = 0;
    }

    function setMinimumBrokerSpreadBps(uint16 spreadBps) external onlyOwner onlyIdle {
        require(spreadBps <= 1_000, "invalid_spread_bps");
        minimumBrokerSpreadBps = spreadBps;
        emit MinimumBrokerSpreadUpdated(spreadBps);
    }

    /// @notice Quotes any live ERC-3156 lender without maintaining a lender allowlist.
    function quoteExternalBrokerFee(
        address lender,
        address token,
        uint256 amount
    ) external view returns (uint256 available, uint256 upstreamFee, uint256 borrowerFee) {
        require(lender.code.length > 0, "lender_contract_required");
        require(token.code.length > 0, "token_contract_required");
        require(amount > 0, "amount_required");
        available = IERC3156FlashLenderGhostBridge(lender).maxFlashLoan(token);
        upstreamFee = IERC3156FlashLenderGhostBridge(lender).flashFee(token, amount);
        borrowerFee = upstreamFee + _positiveSpread(amount);
    }

    /// @notice Borrow from any ERC-3156 lender and immediately lend to a borrower.
    /// @dev The caller is the transaction initiator and pays gas. No operator gas,
    ///      collateral, principal, or prefunding is required by Ghost.
    function brokerExternalFlashLoan(
        address lender,
        IERC3156FlashBorrowerGhostBridge borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata borrowerData
    ) external onlyIdle returns (bool) {
        require(lender.code.length > 0, "lender_contract_required");
        require(address(borrower).code.length > 0, "borrower_contract_required");
        require(token.code.length > 0, "token_contract_required");
        require(amount > 0, "amount_required");

        IERC3156FlashLenderGhostBridge upstream = IERC3156FlashLenderGhostBridge(lender);
        require(upstream.maxFlashLoan(token) >= amount, "insufficient_upstream_liquidity");
        uint256 upstreamFee = upstream.flashFee(token, amount);
        uint256 borrowerFee = upstreamFee + _positiveSpread(amount);
        require(borrowerFee > upstreamFee, "nonpositive_broker_spread");
        require(borrowerFee <= maxBorrowerFee, "borrower_fee_exceeds_max");

        active = true;
        callbackCompleted = false;
        expectedLender = lender;
        expectedBorrower = address(borrower);
        expectedInitiator = msg.sender;
        expectedToken = token;
        expectedAmount = amount;
        expectedUpstreamFee = upstreamFee;
        expectedBorrowerFee = borrowerFee;
        expectedStartingBalance = IERC20GhostBridge(token).balanceOf(address(this));

        bool accepted = upstream.flashLoan(
            this,
            token,
            amount,
            abi.encode(borrowerData)
        );
        require(accepted, "upstream_flash_loan_rejected");
        require(callbackCompleted, "upstream_callback_missing");
        require(
            IERC20GhostBridge(token).balanceOf(address(this)) == expectedStartingBalance,
            "upstream_repayment_not_exact"
        );

        _safeApprove(token, lender, 0);
        _clearExpectation();
        return true;
    }

    /// @inheritdoc IERC3156FlashBorrowerGhostBridge
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32) {
        require(active, "unexpected_upstream_callback");
        require(!callbackCompleted, "duplicate_upstream_callback");
        require(msg.sender == expectedLender, "unexpected_lender");
        require(initiator == address(this), "unexpected_upstream_initiator");
        require(token == expectedToken, "unexpected_token");
        require(amount == expectedAmount, "unexpected_amount");
        require(fee == expectedUpstreamFee, "unexpected_upstream_fee");
        require(
            IERC20GhostBridge(token).balanceOf(address(this)) == expectedStartingBalance + amount,
            "upstream_principal_not_received_exactly"
        );

        // Set before either token or borrower external calls so reentrant callbacks
        // cannot execute the credit cycle twice.
        callbackCompleted = true;

        uint256 borrowerStartingBalance = IERC20GhostBridge(token).balanceOf(expectedBorrower);
        _safeTransfer(token, expectedBorrower, amount);
        require(
            IERC20GhostBridge(token).balanceOf(expectedBorrower) == borrowerStartingBalance + amount,
            "borrower_principal_not_received_exactly"
        );

        bytes memory borrowerData = abi.decode(data, (bytes));
        bytes32 downstreamResult = IERC3156FlashBorrowerGhostBridge(expectedBorrower).onFlashLoan(
            expectedInitiator,
            token,
            amount,
            expectedBorrowerFee,
            borrowerData
        );
        require(downstreamResult == ERC3156_CALLBACK_SUCCESS, "borrower_callback_failed");

        uint256 beforeRepayment = IERC20GhostBridge(token).balanceOf(address(this));
        _safeTransferFrom(
            token,
            expectedBorrower,
            address(this),
            amount + expectedBorrowerFee
        );
        require(
            IERC20GhostBridge(token).balanceOf(address(this)) == beforeRepayment + amount + expectedBorrowerFee,
            "borrower_repayment_not_exact"
        );

        uint256 spread = expectedBorrowerFee - expectedUpstreamFee;
        require(spread > 0, "nonpositive_broker_spread");
        _safeTransfer(token, profitRecipient, spread);
        require(
            IERC20GhostBridge(token).balanceOf(address(this)) == expectedStartingBalance + amount + expectedUpstreamFee,
            "pre_upstream_repayment_reconciliation_failed"
        );

        _safeApprove(token, expectedLender, 0);
        _safeApprove(token, expectedLender, amount + expectedUpstreamFee);

        emit ExternalCreditBrokered(
            expectedLender,
            expectedBorrower,
            token,
            amount,
            expectedUpstreamFee,
            expectedBorrowerFee,
            spread,
            profitRecipient,
            expectedInitiator
        );
        return ERC3156_CALLBACK_SUCCESS;
    }

    function _positiveSpread(uint256 amount) internal view returns (uint256) {
        uint256 configured = _mulDivUp(amount, minimumBrokerSpreadBps, BPS);
        return configured > 0 ? configured : 1;
    }

    function _clearExpectation() internal {
        active = false;
        callbackCompleted = false;
        expectedLender = address(0);
        expectedBorrower = address(0);
        expectedInitiator = address(0);
        expectedToken = address(0);
        expectedAmount = 0;
        expectedUpstreamFee = 0;
        expectedBorrowerFee = 0;
        expectedStartingBalance = 0;
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        require(denominator != 0, "division_by_zero");
        if (x == 0 || y == 0) return 0;
        require(x <= type(uint256).max / y, "mul_overflow");
        uint256 product = x * y;
        uint256 quotient = product / denominator;
        return product % denominator == 0 ? quotient : quotient + 1;
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostBridge.transfer.selector, to, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostBridge.transferFrom.selector, from, to, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_from_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostBridge.approve.selector, spender, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_approve_failed");
    }
}