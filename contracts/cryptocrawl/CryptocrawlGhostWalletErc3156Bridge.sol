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

interface IAaveV3PoolGhostBridge {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);
}

interface IMorphoGhostBridge {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

interface IBalancerV2FlashLoanRecipientGhostBridge {
    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external;
}

interface IBalancerV2VaultGhostBridge {
    function flashLoan(
        IBalancerV2FlashLoanRecipientGhostBridge recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}

/// @notice Permissionless, zero-operator-capital atomic credit intermediary.
/// @dev The transaction initiator supplies transaction gas. Ghost never fronts
///      principal, native gas, collateral, or a paymaster balance. Upstream capital
///      is sourced atomically from any compatible ERC-3156 lender, Aave V3 pool,
///      Morpho singleton, or Balancer V2 vault. The downstream borrower must repay
///      principal + borrowerFee in the same transaction; upstream repayment then
///      occurs before completion. Only a strictly positive spread is sent to
///      profitRecipient. Any mismatch reverts the complete transaction.
contract CryptocrawlGhostWalletErc3156Bridge is
    IERC3156FlashBorrowerGhostBridge,
    IBalancerV2FlashLoanRecipientGhostBridge
{
    uint256 private constant BPS = 10_000;
    bytes32 private constant ERC3156_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    enum UpstreamKind {
        None,
        ERC3156,
        AaveV3,
        Morpho,
        BalancerV2
    }

    address public immutable owner;
    address public immutable profitRecipient;
    uint16 public minimumBrokerSpreadBps;

    bool private active;
    bool private callbackCompleted;
    UpstreamKind private expectedKind;
    address private expectedLender;
    address private expectedBorrower;
    address private expectedInitiator;
    address private expectedToken;
    uint256 private expectedAmount;
    uint256 private expectedUpstreamFee;
    uint256 private expectedBorrowerFee;
    uint256 private expectedMaxBorrowerFee;
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
        address initiator,
        uint8 upstreamKind
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
        // Zero means no fixed BPS hurdle. Every successful transaction still
        // requires at least one smallest token unit of positive spread.
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
        _requireContracts(lender, address(1), token);
        require(amount > 0, "amount_required");
        available = IERC3156FlashLenderGhostBridge(lender).maxFlashLoan(token);
        upstreamFee = IERC3156FlashLenderGhostBridge(lender).flashFee(token, amount);
        borrowerFee = upstreamFee + _positiveSpread(amount);
    }

    /// @notice Aave quote helper. Execution uses the premium supplied by Aave's
    ///         callback as final truth; maxBorrowerFee protects the borrower if it moves.
    function quoteAaveV3BrokerFee(
        address pool,
        uint256 amount
    ) external view returns (uint256 premiumBps, uint256 estimatedUpstreamFee, uint256 borrowerFee) {
        require(pool.code.length > 0, "lender_contract_required");
        require(amount > 0, "amount_required");
        premiumBps = uint256(IAaveV3PoolGhostBridge(pool).FLASHLOAN_PREMIUM_TOTAL());
        estimatedUpstreamFee = _aavePercentMul(amount, premiumBps);
        borrowerFee = estimatedUpstreamFee + _positiveSpread(amount);
    }

    /// @notice Morpho Blue flash loans currently charge no protocol flash-loan fee;
    ///         Ghost therefore quotes only its smallest positive spread.
    function quoteMorphoBrokerFee(uint256 amount) external view returns (uint256 borrowerFee) {
        require(amount > 0, "amount_required");
        return _positiveSpread(amount);
    }

    /// @notice Borrow from any ERC-3156 lender and immediately lend to a borrower.
    function brokerExternalFlashLoan(
        address lender,
        IERC3156FlashBorrowerGhostBridge borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata borrowerData
    ) external onlyIdle returns (bool) {
        _requireContracts(lender, address(borrower), token);
        require(amount > 0, "amount_required");
        IERC3156FlashLenderGhostBridge upstream = IERC3156FlashLenderGhostBridge(lender);
        require(upstream.maxFlashLoan(token) >= amount, "insufficient_upstream_liquidity");
        uint256 upstreamFee = upstream.flashFee(token, amount);
        uint256 borrowerFee = upstreamFee + _positiveSpread(amount);
        require(borrowerFee <= maxBorrowerFee, "borrower_fee_exceeds_max");
        _begin(UpstreamKind.ERC3156, lender, address(borrower), token, amount, upstreamFee, borrowerFee, maxBorrowerFee);
        bool accepted = upstream.flashLoan(this, token, amount, abi.encode(borrowerData));
        require(accepted, "upstream_flash_loan_rejected");
        _finishPullUpstream();
        return true;
    }

    /// @notice Borrow from any Aave V3 pool and immediately lend to a borrower.
    /// @dev Aave's actual callback premium is used as settlement truth.
    function brokerAaveV3FlashLoan(
        address pool,
        IERC3156FlashBorrowerGhostBridge borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata borrowerData
    ) external onlyIdle returns (bool) {
        _requireContracts(pool, address(borrower), token);
        require(amount > 0, "amount_required");
        _begin(UpstreamKind.AaveV3, pool, address(borrower), token, amount, 0, 0, maxBorrowerFee);
        IAaveV3PoolGhostBridge(pool).flashLoanSimple(address(this), token, amount, abi.encode(borrowerData), 0);
        _finishPullUpstream();
        return true;
    }

    /// @notice Borrow from any Morpho Blue-compatible singleton and immediately
    ///         lend to a borrower. Morpho's current flash-loan primitive is fee-free.
    function brokerMorphoFlashLoan(
        address morpho,
        IERC3156FlashBorrowerGhostBridge borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata borrowerData
    ) external onlyIdle returns (bool) {
        _requireContracts(morpho, address(borrower), token);
        require(amount > 0, "amount_required");
        uint256 borrowerFee = _positiveSpread(amount);
        require(borrowerFee <= maxBorrowerFee, "borrower_fee_exceeds_max");
        _begin(UpstreamKind.Morpho, morpho, address(borrower), token, amount, 0, borrowerFee, maxBorrowerFee);
        IMorphoGhostBridge(morpho).flashLoan(token, amount, abi.encode(token, borrowerData));
        _finishPullUpstream();
        return true;
    }

    /// @notice Borrow from any Balancer V2-compatible vault and immediately lend
    ///         the single borrowed asset to a downstream ERC-3156 borrower.
    function brokerBalancerV2FlashLoan(
        address vault,
        IERC3156FlashBorrowerGhostBridge borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata borrowerData
    ) external onlyIdle returns (bool) {
        _requireContracts(vault, address(borrower), token);
        require(amount > 0, "amount_required");
        _begin(UpstreamKind.BalancerV2, vault, address(borrower), token, amount, 0, 0, maxBorrowerFee);
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        IBalancerV2VaultGhostBridge(vault).flashLoan(this, tokens, amounts, abi.encode(borrowerData));
        require(callbackCompleted, "upstream_callback_missing");
        require(IERC20GhostBridge(expectedToken).balanceOf(address(this)) == expectedStartingBalance, "upstream_repayment_not_exact");
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
        _validateCallback(UpstreamKind.ERC3156, token, amount);
        require(initiator == address(this), "unexpected_upstream_initiator");
        require(fee == expectedUpstreamFee, "unexpected_upstream_fee");
        _serviceBorrowerAndPreparePullRepayment(fee, abi.decode(data, (bytes)));
        return ERC3156_CALLBACK_SUCCESS;
    }

    /// @notice Aave V3 IFlashLoanSimpleReceiver callback.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        _validateCallback(UpstreamKind.AaveV3, asset, amount);
        require(initiator == address(this), "unexpected_upstream_initiator");
        expectedUpstreamFee = premium;
        expectedBorrowerFee = premium + _positiveSpread(amount);
        require(expectedBorrowerFee <= expectedMaxBorrowerFee, "borrower_fee_exceeds_max");
        _serviceBorrowerAndPreparePullRepayment(premium, abi.decode(params, (bytes)));
        return true;
    }

    /// @notice Morpho Blue IMorphoFlashLoanCallback callback.
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        (address token, bytes memory borrowerData) = abi.decode(data, (address, bytes));
        _validateCallback(UpstreamKind.Morpho, token, assets);
        _serviceBorrowerAndPreparePullRepayment(0, borrowerData);
    }

    /// @inheritdoc IBalancerV2FlashLoanRecipientGhostBridge
    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external {
        require(tokens.length == 1 && amounts.length == 1 && feeAmounts.length == 1, "single_asset_required");
        _validateCallback(UpstreamKind.BalancerV2, tokens[0], amounts[0]);
        uint256 upstreamFee = feeAmounts[0];
        expectedUpstreamFee = upstreamFee;
        expectedBorrowerFee = upstreamFee + _positiveSpread(expectedAmount);
        require(expectedBorrowerFee <= expectedMaxBorrowerFee, "borrower_fee_exceeds_max");
        _serviceBorrower(upstreamFee, abi.decode(userData, (bytes)));
        _safeTransfer(expectedToken, expectedLender, expectedAmount + upstreamFee);
        uint256 spread = expectedBorrowerFee - upstreamFee;
        _safeTransfer(expectedToken, profitRecipient, spread);
        require(IERC20GhostBridge(expectedToken).balanceOf(address(this)) == expectedStartingBalance, "upstream_repayment_not_exact");
        _emitSettlement(upstreamFee, spread);
    }

    function _begin(
        UpstreamKind kind,
        address lender,
        address borrower,
        address token,
        uint256 amount,
        uint256 upstreamFee,
        uint256 borrowerFee,
        uint256 maxBorrowerFee
    ) internal {
        require(maxBorrowerFee > upstreamFee, "nonpositive_broker_spread");
        active = true;
        callbackCompleted = false;
        expectedKind = kind;
        expectedLender = lender;
        expectedBorrower = borrower;
        expectedInitiator = msg.sender;
        expectedToken = token;
        expectedAmount = amount;
        expectedUpstreamFee = upstreamFee;
        expectedBorrowerFee = borrowerFee;
        expectedMaxBorrowerFee = maxBorrowerFee;
        expectedStartingBalance = IERC20GhostBridge(token).balanceOf(address(this));
    }

    function _validateCallback(UpstreamKind kind, address token, uint256 amount) internal view {
        require(active, "unexpected_upstream_callback");
        require(!callbackCompleted, "duplicate_upstream_callback");
        require(expectedKind == kind, "unexpected_upstream_kind");
        require(msg.sender == expectedLender, "unexpected_lender");
        require(token == expectedToken, "unexpected_token");
        require(amount == expectedAmount, "unexpected_amount");
        require(IERC20GhostBridge(token).balanceOf(address(this)) == expectedStartingBalance + amount, "upstream_principal_not_received_exactly");
    }

    function _serviceBorrower(uint256 upstreamFee, bytes memory borrowerData) internal {
        require(expectedBorrowerFee > upstreamFee, "nonpositive_broker_spread");
        callbackCompleted = true;
        uint256 borrowerStartingBalance = IERC20GhostBridge(expectedToken).balanceOf(expectedBorrower);
        _safeTransfer(expectedToken, expectedBorrower, expectedAmount);
        require(IERC20GhostBridge(expectedToken).balanceOf(expectedBorrower) == borrowerStartingBalance + expectedAmount, "borrower_principal_not_received_exactly");
        bytes32 downstreamResult = IERC3156FlashBorrowerGhostBridge(expectedBorrower).onFlashLoan(
            expectedInitiator,
            expectedToken,
            expectedAmount,
            expectedBorrowerFee,
            borrowerData
        );
        require(downstreamResult == ERC3156_CALLBACK_SUCCESS, "borrower_callback_failed");
        uint256 beforeRepayment = IERC20GhostBridge(expectedToken).balanceOf(address(this));
        _safeTransferFrom(expectedToken, expectedBorrower, address(this), expectedAmount + expectedBorrowerFee);
        require(IERC20GhostBridge(expectedToken).balanceOf(address(this)) == beforeRepayment + expectedAmount + expectedBorrowerFee, "borrower_repayment_not_exact");
    }

    function _serviceBorrowerAndPreparePullRepayment(uint256 upstreamFee, bytes memory borrowerData) internal {
        _serviceBorrower(upstreamFee, borrowerData);
        uint256 spread = expectedBorrowerFee - upstreamFee;
        _safeTransfer(expectedToken, profitRecipient, spread);
        require(IERC20GhostBridge(expectedToken).balanceOf(address(this)) == expectedStartingBalance + expectedAmount + upstreamFee, "pre_upstream_repayment_reconciliation_failed");
        _safeApprove(expectedToken, expectedLender, 0);
        _safeApprove(expectedToken, expectedLender, expectedAmount + upstreamFee);
        _emitSettlement(upstreamFee, spread);
    }

    function _emitSettlement(uint256 upstreamFee, uint256 spread) internal {
        emit ExternalCreditBrokered(
            expectedLender,
            expectedBorrower,
            expectedToken,
            expectedAmount,
            upstreamFee,
            expectedBorrowerFee,
            spread,
            profitRecipient,
            expectedInitiator,
            uint8(expectedKind)
        );
    }

    function _finishPullUpstream() internal {
        require(callbackCompleted, "upstream_callback_missing");
        require(IERC20GhostBridge(expectedToken).balanceOf(address(this)) == expectedStartingBalance, "upstream_repayment_not_exact");
        _safeApprove(expectedToken, expectedLender, 0);
        _clearExpectation();
    }

    function _positiveSpread(uint256 amount) internal view returns (uint256) {
        uint256 configured = _mulDivUp(amount, minimumBrokerSpreadBps, BPS);
        return configured > 0 ? configured : 1;
    }

    function _requireContracts(address lender, address borrower, address token) internal view {
        require(lender.code.length > 0, "lender_contract_required");
        if (borrower != address(1)) require(borrower.code.length > 0, "borrower_contract_required");
        require(token.code.length > 0, "token_contract_required");
    }

    function _clearExpectation() internal {
        active = false;
        callbackCompleted = false;
        expectedKind = UpstreamKind.None;
        expectedLender = address(0);
        expectedBorrower = address(0);
        expectedInitiator = address(0);
        expectedToken = address(0);
        expectedAmount = 0;
        expectedUpstreamFee = 0;
        expectedBorrowerFee = 0;
        expectedMaxBorrowerFee = 0;
        expectedStartingBalance = 0;
    }

    function _aavePercentMul(uint256 value, uint256 percentage) internal pure returns (uint256) {
        if (value == 0 || percentage == 0) return 0;
        require(percentage <= BPS, "invalid_aave_premium_bps");
        require(value <= (type(uint256).max - (BPS / 2)) / percentage, "mul_overflow");
        return (value * percentage + (BPS / 2)) / BPS;
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
        (bool success, bytes memory returndata) = token.call(abi.encodeWithSelector(IERC20GhostBridge.transfer.selector, to, amount));
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(abi.encodeWithSelector(IERC20GhostBridge.transferFrom.selector, from, to, amount));
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_from_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(abi.encodeWithSelector(IERC20GhostBridge.approve.selector, spender, amount));
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_approve_failed");
    }
}