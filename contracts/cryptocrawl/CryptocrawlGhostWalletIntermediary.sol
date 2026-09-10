// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20GhostWallet {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC20PermitGhostWallet {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IERC3156FlashBorrowerGhostWallet {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

interface IGhostWalletCapitalVault {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function previewAtomicFee(uint256 assets) external view returns (uint256);
    function lendAtomic(uint256 assets, uint256 fee, bytes calldata data) external;
}

/// @notice Atomic credit/intermediation settlement surface for CryptoCrawler.
/// @dev Independent from the arbitrage Profit Ladder. Every credit/liability lane
///      must settle in the same transaction. Any repayment, accounting, or minimum
///      profit failure reverts the complete transaction.
contract CryptocrawlGhostWalletIntermediary {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    struct SignedIntent {
        address owner;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint16 maxFeeBps;
        uint256 nonce;
        uint256 deadline;
    }

    enum Phase {
        Idle,
        Executing,
        AwaitingVault
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes4 private constant ERROR_STRING_SELECTOR = 0x08c379a0;
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "SignedIntent(address owner,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint16 maxFeeBps,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant NAME_HASH = keccak256("CryptoCrawler Ghost Wallet");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant ERC3156_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint8 private constant VAULT_MODE_ROUTE = 1;
    uint8 private constant VAULT_MODE_BROKER = 2;

    address public immutable owner;
    address public immutable profitRecipient;
    uint16 public minimumBrokerSpreadBps;

    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;
    mapping(address => bool) public allowedAssets;
    mapping(address => bool) public allowedLiabilityOracles;
    mapping(address => bool) public allowedVaults;
    mapping(address => mapping(uint256 => bool)) public usedIntentNonces;

    Phase private phase;
    address private expectedVault;
    address private expectedVaultAsset;
    uint256 private expectedVaultStartingBalance;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event AssetUpdated(address indexed asset, bool allowed);
    event LiabilityOracleUpdated(address indexed oracle, bool allowed);
    event VaultUpdated(address indexed vault, bool allowed);
    event MinimumBrokerSpreadUpdated(uint16 spreadBps);
    event AtomicCreditSettled(
        address indexed source,
        address indexed asset,
        uint256 principal,
        uint256 sourceFee,
        uint256 realizedProfit,
        address indexed profitRecipient
    );
    event AtomicLiabilityCycleSettled(
        address indexed liabilityOracle,
        bytes32 indexed liabilityQueryHash,
        address indexed profitAsset,
        uint256 startingLiability,
        uint256 endingLiability,
        uint256 realizedProfit,
        address profitRecipient
    );
    event MatchedIntentPairSettled(
        address indexed ownerA,
        address indexed ownerB,
        address tokenA,
        address tokenB,
        uint256 feeA,
        uint256 feeB,
        address profitRecipient
    );
    event VaultCreditSettled(
        address indexed vault,
        address indexed asset,
        uint256 principal,
        uint256 sourceFee,
        uint256 realizedProfit,
        address indexed profitRecipient
    );
    event BrokeredAtomicCreditSettled(
        address indexed vault,
        address indexed borrower,
        address indexed asset,
        uint256 principal,
        uint256 sourceFee,
        uint256 borrowerFee,
        uint256 realizedSpread,
        address profitRecipient
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
        require(phase == Phase.Idle, "execution_in_progress");
        _;
    }

    constructor(address ownerAddress, address profitRecipientAddress) {
        require(ownerAddress != address(0), "owner_required");
        require(profitRecipientAddress != address(0), "profit_recipient_required");
        owner = ownerAddress;
        profitRecipient = profitRecipientAddress;
        minimumBrokerSpreadBps = 1;
    }

    function setOperator(address operator, bool allowed) external onlyOwner onlyIdle {
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

    function setAllowedAsset(address token, bool allowed) external onlyOwner onlyIdle {
        require(token != address(0), "token_required");
        allowedAssets[token] = allowed;
        emit AssetUpdated(token, allowed);
    }

    function setAllowedLiabilityOracle(address oracle, bool allowed) external onlyOwner onlyIdle {
        require(oracle != address(0), "oracle_required");
        allowedLiabilityOracles[oracle] = allowed;
        emit LiabilityOracleUpdated(oracle, allowed);
    }

    function setAllowedVault(address vault, bool allowed) external onlyOwner onlyIdle {
        require(vault != address(0), "vault_required");
        allowedVaults[vault] = allowed;
        emit VaultUpdated(vault, allowed);
    }

    function setMinimumBrokerSpreadBps(uint16 spreadBps) external onlyOwner onlyIdle {
        require(spreadBps > 0 && spreadBps <= 1_000, "invalid_spread_bps");
        minimumBrokerSpreadBps = spreadBps;
        emit MinimumBrokerSpreadUpdated(spreadBps);
    }

    function executeDirectAtomicCredit(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address requestedProfitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        _requireProfitRecipient(requestedProfitRecipient);
        phase = Phase.Executing;
        _executeDirectAtomicCreditActive(asset, capitalSource, principal, sourceFee, minProfit, steps);
    }

    /// @notice Direct same-transaction credit with an EIP-2612 permit from the source.
    /// @dev The execution lock is entered before the untrusted permit call.
    function executeDirectAtomicCreditWithPermit(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address requestedProfitRecipient,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        _requireProfitRecipient(requestedProfitRecipient);
        phase = Phase.Executing;
        IERC20PermitGhostWallet(asset).permit(
            capitalSource,
            address(this),
            principal,
            permitDeadline,
            v,
            r,
            s
        );
        _executeDirectAtomicCreditActive(asset, capitalSource, principal, sourceFee, minProfit, steps);
    }

    /// @notice Source-specific same-transaction liability lane.
    /// @dev liabilityQueryData must return one uint256 current-liability value. This
    ///      supports Aave variable-debt balanceOf and Euler EVault debtOf without
    ///      pretending every protocol exposes the same debt representation.
    function executeAtomicLiabilityCycle(
        address liabilityOracle,
        bytes calldata liabilityQueryData,
        address profitAsset,
        uint256 minProfit,
        address requestedProfitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        require(liabilityOracle != address(0), "liability_oracle_required");
        require(liabilityQueryData.length >= 4, "liability_query_required");
        require(allowedLiabilityOracles[liabilityOracle], "liability_oracle_not_allowed");
        require(allowedAssets[profitAsset], "profit_asset_not_allowed");
        require(minProfit > 0, "min_profit_required");
        require(steps.length > 0, "steps_required");
        _requireProfitRecipient(requestedProfitRecipient);

        phase = Phase.Executing;
        uint256 startingLiability = _readLiability(liabilityOracle, liabilityQueryData);
        uint256 startingProfitBalance = IERC20GhostWallet(profitAsset).balanceOf(address(this));

        _runSteps(steps);

        uint256 endingLiability = _readLiability(liabilityOracle, liabilityQueryData);
        require(endingLiability <= startingLiability, "incremental_liability_not_repaid");
        uint256 endingProfitBalance = IERC20GhostWallet(profitAsset).balanceOf(address(this));
        require(endingProfitBalance >= startingProfitBalance + minProfit, "profit_below_threshold");

        uint256 realizedProfit = endingProfitBalance - startingProfitBalance;
        _safeTransfer(profitAsset, profitRecipient, realizedProfit);
        require(
            IERC20GhostWallet(profitAsset).balanceOf(address(this)) == startingProfitBalance,
            "profit_residual_mismatch"
        );

        phase = Phase.Idle;
        emit AtomicLiabilityCycleSettled(
            liabilityOracle,
            keccak256(liabilityQueryData),
            profitAsset,
            startingLiability,
            endingLiability,
            realizedProfit,
            profitRecipient
        );
    }

    /// @notice Clears two complementary EIP-712 signed intents without an exchange.
    /// @dev Both signed minimums, nonce uniqueness, exact token funding, and complete
    ///      terminal balance neutrality are enforced in the same transaction.
    function settleMatchedIntentPair(
        SignedIntent calldata intentA,
        bytes calldata signatureA,
        uint16 feeBpsA,
        SignedIntent calldata intentB,
        bytes calldata signatureB,
        uint16 feeBpsB,
        address requestedProfitRecipient
    ) external onlyController onlyIdle {
        _requireProfitRecipient(requestedProfitRecipient);
        require(intentA.owner != address(0) && intentB.owner != address(0), "intent_owner_required");
        require(intentA.owner != intentB.owner, "self_match_forbidden");
        require(intentA.owner != profitRecipient && intentB.owner != profitRecipient, "profit_recipient_cannot_self_match");
        require(intentA.sellToken == intentB.buyToken, "intent_pair_token0_mismatch");
        require(intentA.buyToken == intentB.sellToken, "intent_pair_token1_mismatch");
        require(intentA.sellToken != intentA.buyToken, "distinct_assets_required");
        require(allowedAssets[intentA.sellToken] && allowedAssets[intentA.buyToken], "intent_asset_not_allowed");
        require(intentA.sellAmount > 0 && intentB.sellAmount > 0, "sell_amount_required");
        require(intentA.minBuyAmount > 0 && intentB.minBuyAmount > 0, "min_buy_required");
        require(block.timestamp <= intentA.deadline && block.timestamp <= intentB.deadline, "intent_expired");
        require(feeBpsA <= intentA.maxFeeBps && feeBpsB <= intentB.maxFeeBps, "fee_exceeds_signed_cap");
        require(feeBpsA <= BPS && feeBpsB <= BPS, "invalid_fee_bps");
        require(!usedIntentNonces[intentA.owner][intentA.nonce], "intent_a_nonce_used");
        require(!usedIntentNonces[intentB.owner][intentB.nonce], "intent_b_nonce_used");
        require(_recoverIntentSigner(intentA, signatureA) == intentA.owner, "intent_a_signature_invalid");
        require(_recoverIntentSigner(intentB, signatureB) == intentB.owner, "intent_b_signature_invalid");

        uint256 grossBuyA = intentB.sellAmount;
        uint256 grossBuyB = intentA.sellAmount;
        uint256 feeA = (grossBuyA * feeBpsA) / BPS;
        uint256 feeB = (grossBuyB * feeBpsB) / BPS;
        uint256 userBuyA = grossBuyA - feeA;
        uint256 userBuyB = grossBuyB - feeB;
        require(userBuyA >= intentA.minBuyAmount, "intent_a_min_buy_not_met");
        require(userBuyB >= intentB.minBuyAmount, "intent_b_min_buy_not_met");
        require(feeA > 0 || feeB > 0, "zero_intermediation_fee");

        address tokenA = intentA.sellToken;
        address tokenB = intentA.buyToken;
        uint256 startingA = IERC20GhostWallet(tokenA).balanceOf(address(this));
        uint256 startingB = IERC20GhostWallet(tokenB).balanceOf(address(this));

        phase = Phase.Executing;
        usedIntentNonces[intentA.owner][intentA.nonce] = true;
        usedIntentNonces[intentB.owner][intentB.nonce] = true;

        _safeTransferFrom(tokenA, intentA.owner, address(this), intentA.sellAmount);
        require(
            IERC20GhostWallet(tokenA).balanceOf(address(this)) == startingA + intentA.sellAmount,
            "intent_a_funding_not_exact"
        );
        _safeTransferFrom(tokenB, intentB.owner, address(this), intentB.sellAmount);
        require(
            IERC20GhostWallet(tokenB).balanceOf(address(this)) == startingB + intentB.sellAmount,
            "intent_b_funding_not_exact"
        );

        _safeTransfer(tokenB, intentA.owner, userBuyA);
        _safeTransfer(tokenA, intentB.owner, userBuyB);
        if (feeA > 0) _safeTransfer(tokenB, profitRecipient, feeA);
        if (feeB > 0) _safeTransfer(tokenA, profitRecipient, feeB);

        require(IERC20GhostWallet(tokenA).balanceOf(address(this)) == startingA, "intent_token_a_residual");
        require(IERC20GhostWallet(tokenB).balanceOf(address(this)) == startingB, "intent_token_b_residual");

        phase = Phase.Idle;
        emit MatchedIntentPairSettled(
            intentA.owner,
            intentB.owner,
            tokenA,
            tokenB,
            feeA,
            feeB,
            profitRecipient
        );
    }

    /// @notice Uses an admitted vault as capital for an internal atomic route.
    function executeVaultAtomicCredit(
        address vault,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address requestedProfitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        _requireProfitRecipient(requestedProfitRecipient);
        require(principal > 0, "principal_required");
        require(minProfit > 0, "min_profit_required");
        require(steps.length > 0, "steps_required");

        address token = _prepareVault(vault);
        IGhostWalletCapitalVault(vault).lendAtomic(
            principal,
            sourceFee,
            abi.encode(VAULT_MODE_ROUTE, minProfit, steps)
        );
        require(phase == Phase.Idle, "vault_callback_incomplete");
        require(IERC20GhostWallet(token).balanceOf(address(this)) == expectedVaultStartingBalance, "vault_terminal_balance_mismatch");
        _clearVaultExpectation();
    }

    /// @notice Public atomic credit-broker lane using Ghost Wallet vault liquidity.
    /// @dev The borrower must initiate its own request, receives the principal, and
    ///      must approve principal + borrowerFee back during its ERC-3156 callback.
    ///      Nonpayment reverts; the vault receives its fee and the entire spread goes
    ///      directly to the immutable Ghost Wallet profit recipient.
    function brokerVaultFlashLoan(
        address vault,
        IERC3156FlashBorrowerGhostWallet borrower,
        address token,
        uint256 amount,
        uint256 maxBorrowerFee,
        bytes calldata data
    ) external onlyIdle returns (bool) {
        require(address(borrower) != address(0), "borrower_required");
        require(msg.sender == address(borrower), "borrower_must_initiate");
        require(amount > 0, "amount_required");

        address vaultAsset = _prepareVault(vault);
        require(vaultAsset == token, "vault_asset_mismatch");
        require(amount <= IGhostWalletCapitalVault(vault).totalAssets(), "insufficient_vault_liquidity");

        uint256 sourceFee = IGhostWalletCapitalVault(vault).previewAtomicFee(amount);
        uint256 spread = _mulDivUp(amount, minimumBrokerSpreadBps, BPS);
        uint256 borrowerFee = sourceFee + spread;
        require(borrowerFee <= maxBorrowerFee, "borrower_fee_exceeds_max");

        IGhostWalletCapitalVault(vault).lendAtomic(
            amount,
            sourceFee,
            abi.encode(VAULT_MODE_BROKER, msg.sender, address(borrower), borrowerFee, data)
        );
        require(phase == Phase.Idle, "vault_callback_incomplete");
        require(IERC20GhostWallet(token).balanceOf(address(this)) == expectedVaultStartingBalance, "broker_terminal_balance_mismatch");
        _clearVaultExpectation();
        return true;
    }

    function quoteVaultBrokerFee(address vault, address token, uint256 amount) external view returns (uint256) {
        require(allowedVaults[vault], "vault_not_allowed");
        require(allowedAssets[token], "asset_not_allowed");
        require(amount > 0, "amount_required");
        require(IGhostWalletCapitalVault(vault).asset() == token, "vault_asset_mismatch");
        require(amount <= IGhostWalletCapitalVault(vault).totalAssets(), "insufficient_vault_liquidity");
        uint256 sourceFee = IGhostWalletCapitalVault(vault).previewAtomicFee(amount);
        return sourceFee + _mulDivUp(amount, minimumBrokerSpreadBps, BPS);
    }

    /// @notice Callback used only by the vault currently selected by this contract.
    function onGhostWalletVaultCredit(
        address token,
        uint256 principal,
        uint256 sourceFee,
        bytes calldata data
    ) external {
        require(phase == Phase.AwaitingVault, "unexpected_vault_callback");
        require(msg.sender == expectedVault && allowedVaults[msg.sender], "vault_only");
        require(token == expectedVaultAsset, "unexpected_vault_asset");
        require(IGhostWalletCapitalVault(msg.sender).asset() == token, "vault_asset_mismatch");
        require(allowedAssets[token], "asset_not_allowed");
        require(
            IERC20GhostWallet(token).balanceOf(address(this)) == expectedVaultStartingBalance + principal,
            "vault_principal_not_received_exactly"
        );

        uint256 startingOwnBalance = expectedVaultStartingBalance;
        phase = Phase.Executing;
        uint8 mode = abi.decode(data, (uint8));

        if (mode == VAULT_MODE_ROUTE) {
            (, uint256 minProfit, Step[] memory steps) = abi.decode(data, (uint8, uint256, Step[]));
            require(minProfit > 0 && steps.length > 0, "invalid_route_payload");
            _runStepsMemory(steps);

            uint256 endingBalance = IERC20GhostWallet(token).balanceOf(address(this));
            require(
                endingBalance >= startingOwnBalance + principal + sourceFee + minProfit,
                "vault_repayment_or_profit_shortfall"
            );
            _safeTransfer(token, msg.sender, principal + sourceFee);
            uint256 realizedProfit = IERC20GhostWallet(token).balanceOf(address(this)) - startingOwnBalance;
            require(realizedProfit >= minProfit, "profit_below_threshold");
            _safeTransfer(token, profitRecipient, realizedProfit);
            require(IERC20GhostWallet(token).balanceOf(address(this)) == startingOwnBalance, "vault_route_residual");

            phase = Phase.Idle;
            emit VaultCreditSettled(msg.sender, token, principal, sourceFee, realizedProfit, profitRecipient);
            return;
        }

        if (mode == VAULT_MODE_BROKER) {
            (, address initiator, address borrowerAddress, uint256 borrowerFee, bytes memory borrowerData) =
                abi.decode(data, (uint8, address, address, uint256, bytes));
            require(borrowerAddress != address(0), "borrower_required");
            require(initiator == borrowerAddress, "borrower_initiator_mismatch");
            require(borrowerFee > sourceFee, "nonpositive_broker_spread");

            uint256 borrowerStartingBalance = IERC20GhostWallet(token).balanceOf(borrowerAddress);
            _safeTransfer(token, borrowerAddress, principal);
            require(
                IERC20GhostWallet(token).balanceOf(borrowerAddress) == borrowerStartingBalance + principal,
                "borrower_principal_not_received_exactly"
            );

            bytes32 callbackResult = IERC3156FlashBorrowerGhostWallet(borrowerAddress).onFlashLoan(
                initiator,
                token,
                principal,
                borrowerFee,
                borrowerData
            );
            require(callbackResult == ERC3156_CALLBACK_SUCCESS, "borrower_callback_failed");

            uint256 beforeRepayment = IERC20GhostWallet(token).balanceOf(address(this));
            _safeTransferFrom(token, borrowerAddress, address(this), principal + borrowerFee);
            require(
                IERC20GhostWallet(token).balanceOf(address(this)) == beforeRepayment + principal + borrowerFee,
                "borrower_repayment_not_exact"
            );

            _safeTransfer(token, msg.sender, principal + sourceFee);
            uint256 realizedSpread = IERC20GhostWallet(token).balanceOf(address(this)) - startingOwnBalance;
            require(realizedSpread == borrowerFee - sourceFee, "spread_reconciliation_failed");
            _safeTransfer(token, profitRecipient, realizedSpread);
            require(IERC20GhostWallet(token).balanceOf(address(this)) == startingOwnBalance, "broker_residual");

            phase = Phase.Idle;
            emit BrokeredAtomicCreditSettled(
                msg.sender,
                borrowerAddress,
                token,
                principal,
                sourceFee,
                borrowerFee,
                realizedSpread,
                profitRecipient
            );
            return;
        }

        revert("unsupported_vault_mode");
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function intentDigest(SignedIntent calldata intent) external view returns (bytes32) {
        return _intentDigest(intent);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner onlyIdle {
        require(to != address(0), "recipient_required");
        _safeTransfer(token, to, amount);
    }

    function rescueNative(address payable to, uint256 amount) external onlyOwner onlyIdle {
        require(to != address(0), "recipient_required");
        (bool success,) = to.call{value: amount}("");
        require(success, "native_transfer_failed");
    }

    function _executeDirectAtomicCreditActive(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        Step[] calldata steps
    ) internal {
        require(phase == Phase.Executing, "execution_phase_required");
        require(allowedAssets[asset], "asset_not_allowed");
        require(capitalSource != address(0) && capitalSource != address(this), "capital_source_invalid");
        require(principal > 0, "principal_required");
        require(minProfit > 0, "min_profit_required");
        require(steps.length > 0, "steps_required");

        uint256 startingBalance = IERC20GhostWallet(asset).balanceOf(address(this));
        _safeTransferFrom(asset, capitalSource, address(this), principal);
        require(
            IERC20GhostWallet(asset).balanceOf(address(this)) == startingBalance + principal,
            "principal_not_received_exactly"
        );

        _runSteps(steps);

        uint256 endingBalance = IERC20GhostWallet(asset).balanceOf(address(this));
        require(
            endingBalance >= startingBalance + principal + sourceFee + minProfit,
            "repayment_or_profit_shortfall"
        );
        _safeTransfer(asset, capitalSource, principal + sourceFee);
        uint256 realizedProfit = IERC20GhostWallet(asset).balanceOf(address(this)) - startingBalance;
        require(realizedProfit >= minProfit, "profit_below_threshold");
        _safeTransfer(asset, profitRecipient, realizedProfit);
        require(IERC20GhostWallet(asset).balanceOf(address(this)) == startingBalance, "direct_credit_residual");

        phase = Phase.Idle;
        emit AtomicCreditSettled(capitalSource, asset, principal, sourceFee, realizedProfit, profitRecipient);
    }

    function _prepareVault(address vault) internal returns (address token) {
        require(allowedVaults[vault], "vault_not_allowed");
        token = IGhostWalletCapitalVault(vault).asset();
        require(token != address(0) && allowedAssets[token], "vault_asset_not_allowed");
        expectedVault = vault;
        expectedVaultAsset = token;
        expectedVaultStartingBalance = IERC20GhostWallet(token).balanceOf(address(this));
        phase = Phase.AwaitingVault;
    }

    function _clearVaultExpectation() internal {
        require(phase == Phase.Idle, "vault_execution_not_terminal");
        expectedVault = address(0);
        expectedVaultAsset = address(0);
        expectedVaultStartingBalance = 0;
    }

    function _runSteps(Step[] calldata steps) internal {
        for (uint256 i = 0; i < steps.length; i++) {
            Step calldata step = steps[i];
            _executeStep(step.target, step.value, step.callData, step.approvalToken, step.approvalAmount);
        }
    }

    function _runStepsMemory(Step[] memory steps) internal {
        for (uint256 i = 0; i < steps.length; i++) {
            Step memory step = steps[i];
            _executeStep(step.target, step.value, step.callData, step.approvalToken, step.approvalAmount);
        }
    }

    function _executeStep(
        address target,
        uint256 value,
        bytes memory callData,
        address approvalToken,
        uint256 approvalAmount
    ) internal {
        require(target != address(0), "step_target_required");
        require(allowedTargets[target], "target_not_allowed");
        bool temporaryApproval = approvalToken != address(0) && approvalAmount > 0;
        if (temporaryApproval) {
            require(allowedApprovalTokens[approvalToken], "approval_token_not_allowed");
            _safeApprove(approvalToken, target, 0);
            _safeApprove(approvalToken, target, approvalAmount);
        }

        (bool success, bytes memory returndata) = target.call{value: value}(callData);
        require(success, _extractRevert(returndata));

        // Never leave standing target allowances after a successful step. If a token
        // refuses revocation, fail the entire atomic transaction rather than carry
        // an approval that could drain later Ghost Wallet balances.
        if (temporaryApproval) _safeApprove(approvalToken, target, 0);
    }

    function _readLiability(address target, bytes calldata callData) internal view returns (uint256) {
        (bool success, bytes memory returndata) = target.staticcall(callData);
        require(success && returndata.length >= 32, "liability_probe_failed");
        return abi.decode(returndata, (uint256));
    }

    function _intentDigest(SignedIntent calldata intent) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.owner,
                intent.sellToken,
                intent.buyToken,
                intent.sellAmount,
                intent.minBuyAmount,
                intent.maxFeeBps,
                intent.nonce,
                intent.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recoverIntentSigner(
        SignedIntent calldata intent,
        bytes calldata signature
    ) internal view returns (address signer) {
        require(signature.length == 65, "signature_length_invalid");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(uint256(s) <= SECP256K1_HALF_ORDER, "signature_s_invalid");
        require(v == 27 || v == 28, "signature_v_invalid");
        signer = ecrecover(_intentDigest(intent), v, r, s);
        require(signer != address(0), "signature_recovery_failed");
    }

    function _requireProfitRecipient(address requested) internal view {
        require(requested == profitRecipient, "profit_recipient_mismatch");
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
            abi.encodeWithSelector(IERC20GhostWallet.transfer.selector, to, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostWallet.transferFrom.selector, from, to, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_transfer_from_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostWallet.approve.selector, spender, amount)
        );
        require(success && (returndata.length == 0 || abi.decode(returndata, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        bytes4 selector;
        assembly {
            selector := mload(add(returndata, 32))
        }
        if (selector != ERROR_STRING_SELECTOR) return "step_call_failed";
        assembly {
            returndata := add(returndata, 0x04)
        }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}
