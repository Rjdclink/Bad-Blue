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

interface IGhostWalletCapitalVault {
    function asset() external view returns (address);
    function lendAtomic(uint256 assets, uint256 fee, bytes calldata data) external;
}

/// @notice Atomic credit/intermediation settlement surface for CryptoCrawler.
/// @dev This contract is deliberately independent from the arbitrage Profit Ladder.
///      Every supported lane must finish with no incremental liability. Any failed
///      repayment, minimum-output or minimum-profit condition reverts the whole tx.
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
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "SignedIntent(address owner,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint16 maxFeeBps,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant NAME_HASH = keccak256("CryptoCrawler Ghost Wallet");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable owner;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;
    mapping(address => bool) public allowedVaults;
    mapping(address => mapping(uint256 => bool)) public usedIntentNonces;

    Phase private phase;
    address private expectedVault;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event VaultUpdated(address indexed vault, bool allowed);
    event AtomicCreditSettled(
        address indexed source,
        address indexed asset,
        uint256 principal,
        uint256 sourceFee,
        uint256 realizedProfit,
        address indexed profitRecipient
    );
    event AtomicLiabilityCycleSettled(
        address indexed liabilityToken,
        address indexed liabilityAccount,
        address indexed profitAsset,
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

    constructor(address ownerAddress) {
        require(ownerAddress != address(0), "owner_required");
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

    function setAllowedVault(address vault, bool allowed) external onlyOwner onlyIdle {
        require(vault != address(0), "vault_required");
        allowedVaults[vault] = allowed;
        emit VaultUpdated(vault, allowed);
    }

    /// @notice Direct atomic credit from a capital source that has approved this contract.
    /// @dev Source principal + fee is repaid before the transaction can complete.
    function executeDirectAtomicCredit(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address profitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        _executeDirectAtomicCredit(
            asset,
            capitalSource,
            principal,
            sourceFee,
            minProfit,
            profitRecipient,
            steps
        );
    }

    /// @notice Same direct-credit lane, with an EIP-2612 permit removing a prior approval tx.
    function executeDirectAtomicCreditWithPermit(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address profitRecipient,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        IERC20PermitGhostWallet(asset).permit(
            capitalSource,
            address(this),
            principal,
            permitDeadline,
            v,
            r,
            s
        );
        _executeDirectAtomicCredit(
            asset,
            capitalSource,
            principal,
            sourceFee,
            minProfit,
            profitRecipient,
            steps
        );
    }

    /// @notice Generic debt-assumption/delegated-credit lane.
    /// @dev The caller supplies protocol calls as whitelisted steps. The transaction
    ///      cannot finish with more liability than existed before execution.
    ///      This supports Aave credit delegation, Euler debt-transfer liquidation,
    ///      and future protocols with an ERC20-like debt-accounting token.
    function executeAtomicLiabilityCycle(
        address liabilityToken,
        address liabilityAccount,
        address profitAsset,
        uint256 minProfit,
        address profitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        require(liabilityToken != address(0), "liability_token_required");
        require(liabilityAccount != address(0), "liability_account_required");
        require(profitAsset != address(0), "profit_asset_required");
        require(profitRecipient != address(0), "profit_recipient_required");
        require(steps.length > 0, "steps_required");

        phase = Phase.Executing;
        uint256 startingLiability = IERC20GhostWallet(liabilityToken).balanceOf(liabilityAccount);
        uint256 startingProfitBalance = IERC20GhostWallet(profitAsset).balanceOf(address(this));

        _runSteps(steps);

        uint256 endingLiability = IERC20GhostWallet(liabilityToken).balanceOf(liabilityAccount);
        require(endingLiability <= startingLiability, "incremental_liability_not_repaid");

        uint256 endingProfitBalance = IERC20GhostWallet(profitAsset).balanceOf(address(this));
        require(endingProfitBalance >= startingProfitBalance + minProfit, "profit_below_threshold");
        uint256 realizedProfit = endingProfitBalance - startingProfitBalance;
        if (realizedProfit > 0) _safeTransfer(profitAsset, profitRecipient, realizedProfit);

        phase = Phase.Idle;
        emit AtomicLiabilityCycleSettled(
            liabilityToken,
            liabilityAccount,
            profitAsset,
            realizedProfit,
            profitRecipient
        );
    }

    /// @notice Pulls two complementary signed intents and clears them internally.
    /// @dev No exchange, API key, or off-chain account is required. Users receive at
    ///      least their signed minimum; intermediary fees are explicit and individually
    ///      capped by each signed intent. Replayed nonces fail.
    function settleMatchedIntentPair(
        SignedIntent calldata intentA,
        bytes calldata signatureA,
        uint16 feeBpsA,
        SignedIntent calldata intentB,
        bytes calldata signatureB,
        uint16 feeBpsB,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(profitRecipient != address(0), "profit_recipient_required");
        require(intentA.owner != address(0) && intentB.owner != address(0), "intent_owner_required");
        require(intentA.sellToken == intentB.buyToken, "intent_pair_token0_mismatch");
        require(intentA.buyToken == intentB.sellToken, "intent_pair_token1_mismatch");
        require(intentA.sellToken != intentA.buyToken, "distinct_assets_required");
        require(intentA.sellAmount > 0 && intentB.sellAmount > 0, "sell_amount_required");
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

        phase = Phase.Executing;
        usedIntentNonces[intentA.owner][intentA.nonce] = true;
        usedIntentNonces[intentB.owner][intentB.nonce] = true;

        _safeTransferFrom(intentA.sellToken, intentA.owner, address(this), intentA.sellAmount);
        _safeTransferFrom(intentB.sellToken, intentB.owner, address(this), intentB.sellAmount);

        _safeTransfer(intentA.buyToken, intentA.owner, userBuyA);
        _safeTransfer(intentB.buyToken, intentB.owner, userBuyB);
        if (feeA > 0) _safeTransfer(intentA.buyToken, profitRecipient, feeA);
        if (feeB > 0) _safeTransfer(intentB.buyToken, profitRecipient, feeB);

        phase = Phase.Idle;
        emit MatchedIntentPairSettled(
            intentA.owner,
            intentB.owner,
            intentA.sellToken,
            intentA.buyToken,
            feeA,
            feeB,
            profitRecipient
        );
    }

    /// @notice Draws capital from a permissionless Ghost Wallet capital vault.
    /// @dev The vault invokes onGhostWalletVaultCredit after transferring assets.
    function executeVaultAtomicCredit(
        address vault,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address profitRecipient,
        Step[] calldata steps
    ) external onlyController onlyIdle {
        require(allowedVaults[vault], "vault_not_allowed");
        require(principal > 0, "principal_required");
        require(profitRecipient != address(0), "profit_recipient_required");
        require(steps.length > 0, "steps_required");

        expectedVault = vault;
        phase = Phase.AwaitingVault;
        IGhostWalletCapitalVault(vault).lendAtomic(
            principal,
            sourceFee,
            abi.encode(minProfit, profitRecipient, steps)
        );
        require(phase == Phase.Idle, "vault_callback_incomplete");
        expectedVault = address(0);
    }

    /// @notice Callback used only by a vault admitted by owner configuration.
    function onGhostWalletVaultCredit(
        address asset,
        uint256 principal,
        uint256 sourceFee,
        bytes calldata data
    ) external {
        require(phase == Phase.AwaitingVault, "unexpected_vault_callback");
        require(msg.sender == expectedVault && allowedVaults[msg.sender], "vault_only");
        require(IGhostWalletCapitalVault(msg.sender).asset() == asset, "vault_asset_mismatch");

        phase = Phase.Executing;
        (uint256 minProfit, address profitRecipient, Step[] memory steps) = abi.decode(
            data,
            (uint256, address, Step[])
        );
        require(profitRecipient != address(0), "profit_recipient_required");
        require(steps.length > 0, "steps_required");

        uint256 balanceWithPrincipal = IERC20GhostWallet(asset).balanceOf(address(this));
        require(balanceWithPrincipal >= principal, "principal_not_received");
        uint256 startingOwnBalance = balanceWithPrincipal - principal;

        _runStepsMemory(steps);

        uint256 endingBalance = IERC20GhostWallet(asset).balanceOf(address(this));
        uint256 required = startingOwnBalance + principal + sourceFee + minProfit;
        require(endingBalance >= required, "vault_repayment_or_profit_shortfall");

        _safeTransfer(asset, msg.sender, principal + sourceFee);
        uint256 realizedProfit = IERC20GhostWallet(asset).balanceOf(address(this)) - startingOwnBalance;
        if (realizedProfit > 0) _safeTransfer(asset, profitRecipient, realizedProfit);

        phase = Phase.Idle;
        emit VaultCreditSettled(msg.sender, asset, principal, sourceFee, realizedProfit, profitRecipient);
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

    function _executeDirectAtomicCredit(
        address asset,
        address capitalSource,
        uint256 principal,
        uint256 sourceFee,
        uint256 minProfit,
        address profitRecipient,
        Step[] calldata steps
    ) internal {
        require(asset != address(0), "asset_required");
        require(capitalSource != address(0), "capital_source_required");
        require(principal > 0, "principal_required");
        require(profitRecipient != address(0), "profit_recipient_required");
        require(steps.length > 0, "steps_required");

        phase = Phase.Executing;
        uint256 startingBalance = IERC20GhostWallet(asset).balanceOf(address(this));
        _safeTransferFrom(asset, capitalSource, address(this), principal);
        uint256 afterFunding = IERC20GhostWallet(asset).balanceOf(address(this));
        require(afterFunding >= startingBalance + principal, "principal_not_received");

        _runSteps(steps);

        uint256 endingBalance = IERC20GhostWallet(asset).balanceOf(address(this));
        uint256 required = startingBalance + principal + sourceFee + minProfit;
        require(endingBalance >= required, "repayment_or_profit_shortfall");

        _safeTransfer(asset, capitalSource, principal + sourceFee);
        uint256 realizedProfit = IERC20GhostWallet(asset).balanceOf(address(this)) - startingBalance;
        if (realizedProfit > 0) _safeTransfer(asset, profitRecipient, realizedProfit);

        phase = Phase.Idle;
        emit AtomicCreditSettled(
            capitalSource,
            asset,
            principal,
            sourceFee,
            realizedProfit,
            profitRecipient
        );
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
        if (approvalToken != address(0) && approvalAmount > 0) {
            require(allowedApprovalTokens[approvalToken], "approval_token_not_allowed");
            _safeApprove(approvalToken, target, 0);
            _safeApprove(approvalToken, target, approvalAmount);
        }
        (bool success, bytes memory returndata) = target.call{value: value}(callData);
        require(success, _extractRevert(returndata));
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

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostWallet.transfer.selector, to, amount)
        );
        require(
            success && (returndata.length == 0 || abi.decode(returndata, (bool))),
            "erc20_transfer_failed"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostWallet.transferFrom.selector, from, to, amount)
        );
        require(
            success && (returndata.length == 0 || abi.decode(returndata, (bool))),
            "erc20_transfer_from_failed"
        );
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostWallet.approve.selector, spender, amount)
        );
        require(
            success && (returndata.length == 0 || abi.decode(returndata, (bool))),
            "erc20_approve_failed"
        );
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
