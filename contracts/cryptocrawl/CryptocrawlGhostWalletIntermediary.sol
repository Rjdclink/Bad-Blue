// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGhostWalletERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IGhostWalletFlashBorrower {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

interface IGhostWalletAavePool {
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;

    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256);
}

/// @notice Atomic credit-intermediation primitive for CryptoCrawler.
/// @dev The borrower must return principal plus the quoted fee in the same transaction.
///      Any failure reverts the whole transaction. Successful realized surplus is paid
///      immediately to profitRecipient; this contract is deliberately independent of
///      CryptoCrawler's arbitrage Profit Ladder and retained-profit accounting.
contract CryptocrawlGhostWalletIntermediary {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct AssetPolicy {
        bool enabled;
        uint16 feeBps;
    }

    struct DelegatedCreditSource {
        bool enabled;
        address pool;
        address variableDebtToken;
    }

    address public owner;
    address public profitRecipient;
    bool public paused;
    uint256 private entered;

    mapping(address => AssetPolicy) public assetPolicies;
    mapping(address => DelegatedCreditSource) public delegatedCreditSources;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProfitRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event PauseUpdated(bool paused);
    event AssetPolicyUpdated(address indexed token, bool enabled, uint16 feeBps);
    event DelegatedCreditSourceUpdated(
        address indexed asset,
        address indexed pool,
        address indexed variableDebtToken,
        bool enabled
    );
    event GhostWalletIntermediationSettled(
        address indexed initiator,
        address indexed receiver,
        address indexed token,
        uint256 principal,
        uint256 quotedFee,
        uint256 realizedSurplus,
        address profitRecipient,
        uint8 sourceKind
    );

    error Unauthorized();
    error Paused();
    error Reentrancy();
    error InvalidAddress();
    error InvalidFee();
    error AssetDisabled();
    error InsufficientLiquidity();
    error CallbackFailed();
    error RepaymentFailed();
    error ResidualDebtDetected();
    error TokenCallFailed();
    error DelegatedCreditUnavailable();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address initialOwner, address initialProfitRecipient) {
        if (initialOwner == address(0) || initialProfitRecipient == address(0)) revert InvalidAddress();
        owner = initialOwner;
        profitRecipient = initialProfitRecipient;
        emit OwnershipTransferred(address(0), initialOwner);
        emit ProfitRecipientUpdated(address(0), initialProfitRecipient);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previous, nextOwner);
    }

    function setProfitRecipient(address nextRecipient) external onlyOwner {
        if (nextRecipient == address(0)) revert InvalidAddress();
        address previous = profitRecipient;
        profitRecipient = nextRecipient;
        emit ProfitRecipientUpdated(previous, nextRecipient);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PauseUpdated(nextPaused);
    }

    function setAssetPolicy(address token, bool enabled, uint16 feeBps) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        if (feeBps > BPS_DENOMINATOR) revert InvalidFee();
        assetPolicies[token] = AssetPolicy({enabled: enabled, feeBps: feeBps});
        emit AssetPolicyUpdated(token, enabled, feeBps);
    }

    /// @notice Configure an Aave-compatible delegated-credit source for an asset.
    /// @dev The delegator must separately delegate variable debt allowance to this contract.
    ///      Debt is checked before and after each transaction; any residual increase reverts.
    function setDelegatedCreditSource(
        address asset,
        address pool,
        address variableDebtToken,
        bool enabled
    ) external onlyOwner {
        if (asset == address(0)) revert InvalidAddress();
        if (enabled && (pool == address(0) || variableDebtToken == address(0))) revert InvalidAddress();
        delegatedCreditSources[asset] = DelegatedCreditSource({
            enabled: enabled,
            pool: pool,
            variableDebtToken: variableDebtToken
        });
        emit DelegatedCreditSourceUpdated(asset, pool, variableDebtToken, enabled);
    }

    function maxFlashLoan(address token) external view returns (uint256) {
        if (paused || !assetPolicies[token].enabled) return 0;
        return IGhostWalletERC20(token).balanceOf(address(this));
    }

    function flashFee(address token, uint256 amount) public view returns (uint256) {
        AssetPolicy memory policy = assetPolicies[token];
        if (!policy.enabled) revert AssetDisabled();
        return _fee(amount, policy.feeBps);
    }

    /// @notice Lend liquidity already present in the Ghost Wallet contract.
    /// @dev ERC-3156-compatible callback semantics. Principal + fee must be returned
    ///      before this call ends; otherwise the entire transaction reverts.
    function flashLoan(
        IGhostWalletFlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant whenNotPaused returns (bool) {
        AssetPolicy memory policy = assetPolicies[token];
        if (!policy.enabled) revert AssetDisabled();

        uint256 startingBalance = IGhostWalletERC20(token).balanceOf(address(this));
        if (amount == 0 || startingBalance < amount) revert InsufficientLiquidity();
        uint256 fee = _fee(amount, policy.feeBps);

        _deliverAndCollect(receiver, token, amount, fee, data);

        uint256 afterRepayment = IGhostWalletERC20(token).balanceOf(address(this));
        if (afterRepayment < startingBalance + fee) revert RepaymentFailed();
        uint256 realizedSurplus = afterRepayment - startingBalance;
        _safeTransfer(token, profitRecipient, realizedSurplus);

        if (IGhostWalletERC20(token).balanceOf(address(this)) < startingBalance) revert RepaymentFailed();
        emit GhostWalletIntermediationSettled(
            msg.sender,
            address(receiver),
            token,
            amount,
            fee,
            realizedSurplus,
            profitRecipient,
            0
        );
        return true;
    }

    /// @notice Draw principal against somebody else's explicit Aave-style credit delegation,
    ///         intermediate it to an atomic borrower, repay the delegated debt in the same
    ///         transaction, and route every realized surplus unit to profitRecipient.
    /// @dev No operator collateral is supplied by this contract. If debt is not fully
    ///      neutralized before return, the transaction reverts atomically.
    function intermediateDelegatedCredit(
        IGhostWalletFlashBorrower receiver,
        address asset,
        uint256 amount,
        address delegator,
        bytes calldata data
    ) external nonReentrant whenNotPaused returns (bool) {
        if (delegator == address(0)) revert InvalidAddress();
        AssetPolicy memory policy = assetPolicies[asset];
        if (!policy.enabled) revert AssetDisabled();
        DelegatedCreditSource memory source = delegatedCreditSources[asset];
        if (!source.enabled || source.pool == address(0) || source.variableDebtToken == address(0)) {
            revert DelegatedCreditUnavailable();
        }
        if (amount == 0) revert InsufficientLiquidity();

        uint256 startingBalance = IGhostWalletERC20(asset).balanceOf(address(this));
        uint256 debtBefore = IGhostWalletERC20(source.variableDebtToken).balanceOf(delegator);
        uint256 fee = _fee(amount, policy.feeBps);

        IGhostWalletAavePool(source.pool).borrow(asset, amount, 2, 0, delegator);
        if (IGhostWalletERC20(asset).balanceOf(address(this)) < startingBalance + amount) {
            revert DelegatedCreditUnavailable();
        }

        _deliverAndCollect(receiver, asset, amount, fee, data);

        _safeApprove(asset, source.pool, 0);
        _safeApprove(asset, source.pool, amount);
        uint256 repaid = IGhostWalletAavePool(source.pool).repay(asset, amount, 2, delegator);
        _safeApprove(asset, source.pool, 0);
        if (repaid < amount) revert RepaymentFailed();

        uint256 debtAfter = IGhostWalletERC20(source.variableDebtToken).balanceOf(delegator);
        if (debtAfter > debtBefore) revert ResidualDebtDetected();

        uint256 afterSettlement = IGhostWalletERC20(asset).balanceOf(address(this));
        if (afterSettlement < startingBalance + fee) revert RepaymentFailed();
        uint256 realizedSurplus = afterSettlement - startingBalance;
        _safeTransfer(asset, profitRecipient, realizedSurplus);

        if (IGhostWalletERC20(asset).balanceOf(address(this)) < startingBalance) revert RepaymentFailed();
        emit GhostWalletIntermediationSettled(
            msg.sender,
            address(receiver),
            asset,
            amount,
            fee,
            realizedSurplus,
            profitRecipient,
            1
        );
        return true;
    }

    /// @notice Emergency recovery is intentionally possible only while paused.
    function recoverToken(address token, address to, uint256 amount) external onlyOwner {
        if (!paused) revert Paused();
        if (to == address(0)) revert InvalidAddress();
        _safeTransfer(token, to, amount);
    }

    function _deliverAndCollect(
        IGhostWalletFlashBorrower receiver,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) private {
        _safeTransfer(token, address(receiver), amount);
        bytes32 result = receiver.onFlashLoan(msg.sender, token, amount, fee, data);
        if (result != CALLBACK_SUCCESS) revert CallbackFailed();
        _safeTransferFrom(token, address(receiver), address(this), amount + fee);
    }

    function _fee(uint256 amount, uint16 feeBps) private pure returns (uint256) {
        if (feeBps == 0 || amount == 0) return 0;
        uint256 quotient = amount / BPS_DENOMINATOR;
        uint256 remainder = amount % BPS_DENOMINATOR;
        uint256 fee = quotient * feeBps + (remainder * feeBps) / BPS_DENOMINATOR;
        if ((remainder * feeBps) % BPS_DENOMINATOR != 0) fee += 1;
        return fee;
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IGhostWalletERC20.transfer.selector, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IGhostWalletERC20.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IGhostWalletERC20.approve.selector, spender, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }
}
