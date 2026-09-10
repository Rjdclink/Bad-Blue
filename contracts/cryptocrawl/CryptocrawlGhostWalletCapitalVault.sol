// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20GhostVaultAsset {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IGhostWalletVaultBorrower {
    function onGhostWalletVaultCredit(
        address asset,
        uint256 principal,
        uint256 sourceFee,
        bytes calldata data
    ) external;
}

/// @notice Permissionless single-asset capital reservoir for the Ghost Wallet lane.
/// @dev ERC-4626-compatible accounting surface. Only the configured intermediary
///      may draw capital, and every draw must return principal + fee before the
///      same transaction completes or the entire transaction reverts.
contract CryptocrawlGhostWalletCapitalVault {
    string public constant name = "CryptoCrawler Ghost Capital Share";
    string public constant symbol = "cgCAP";

    uint256 private constant BPS = 10_000;

    address public immutable asset;
    address public immutable intermediary;
    address public immutable owner;
    uint8 public immutable decimals;
    uint16 public minimumAtomicFeeBps;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool private lending;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event MinimumAtomicFeeUpdated(uint16 feeBps);
    event AtomicCreditSettled(uint256 principal, uint256 fee, uint256 endingAssets);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner_only");
        _;
    }

    modifier notLending() {
        require(!lending, "atomic_credit_in_progress");
        _;
    }

    constructor(address assetAddress, address intermediaryAddress, address ownerAddress) {
        require(assetAddress != address(0), "asset_required");
        require(intermediaryAddress != address(0), "intermediary_required");
        require(ownerAddress != address(0), "owner_required");
        asset = assetAddress;
        intermediary = intermediaryAddress;
        owner = ownerAddress;
        minimumAtomicFeeBps = 1;

        uint8 resolvedDecimals = 18;
        (bool ok, bytes memory data) = assetAddress.staticcall(abi.encodeWithSignature("decimals()"));
        if (ok && data.length >= 32) {
            uint256 value = abi.decode(data, (uint256));
            if (value <= type(uint8).max) resolvedDecimals = uint8(value);
        }
        decimals = resolvedDecimals;
    }

    function setMinimumAtomicFeeBps(uint16 feeBps) external onlyOwner notLending {
        require(feeBps <= 1_000, "fee_too_high");
        minimumAtomicFeeBps = feeBps;
        emit MinimumAtomicFeeUpdated(feeBps);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20GhostVaultAsset(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToSharesDown(assets, totalAssets(), totalSupply);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssetsDown(shares, totalAssets(), totalSupply);
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function deposit(uint256 assets, address receiver) external notLending returns (uint256 shares) {
        require(receiver != address(0), "receiver_required");
        require(assets > 0, "assets_required");
        uint256 assetsBefore = totalAssets();
        uint256 supplyBefore = totalSupply;
        shares = _convertToSharesDown(assets, assetsBefore, supplyBefore);
        require(shares > 0, "zero_shares");
        _safeTransferFrom(asset, msg.sender, address(this), assets);
        uint256 received = totalAssets() - assetsBefore;
        require(received == assets, "fee_on_transfer_not_supported");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssetsUp(shares, totalAssets(), totalSupply);
    }

    function mint(uint256 shares, address receiver) external notLending returns (uint256 assets) {
        require(receiver != address(0), "receiver_required");
        require(shares > 0, "shares_required");
        uint256 assetsBefore = totalAssets();
        uint256 supplyBefore = totalSupply;
        assets = _convertToAssetsUp(shares, assetsBefore, supplyBefore);
        require(assets > 0, "zero_assets");
        _safeTransferFrom(asset, msg.sender, address(this), assets);
        uint256 received = totalAssets() - assetsBefore;
        require(received == assets, "fee_on_transfer_not_supported");
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxWithdraw(address ownerAddress) public view returns (uint256) {
        return convertToAssets(balanceOf[ownerAddress]);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _convertToSharesUp(assets, totalAssets(), totalSupply);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address ownerAddress
    ) external notLending returns (uint256 shares) {
        require(receiver != address(0) && ownerAddress != address(0), "account_required");
        require(assets > 0, "assets_required");
        shares = previewWithdraw(assets);
        _spendShareAllowance(ownerAddress, msg.sender, shares);
        _burn(ownerAddress, shares);
        _safeTransfer(asset, receiver, assets);
        emit Withdraw(msg.sender, receiver, ownerAddress, assets, shares);
    }

    function maxRedeem(address ownerAddress) external view returns (uint256) {
        return balanceOf[ownerAddress];
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address ownerAddress
    ) external notLending returns (uint256 assets) {
        require(receiver != address(0) && ownerAddress != address(0), "account_required");
        require(shares > 0, "shares_required");
        assets = previewRedeem(shares);
        require(assets > 0, "zero_assets");
        _spendShareAllowance(ownerAddress, msg.sender, shares);
        _burn(ownerAddress, shares);
        _safeTransfer(asset, receiver, assets);
        emit Withdraw(msg.sender, receiver, ownerAddress, assets, shares);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferShares(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendShareAllowance(from, msg.sender, amount);
        _transferShares(from, to, amount);
        return true;
    }

    /// @notice Atomically makes vault assets available to the configured intermediary.
    /// @dev There is no unsecured duration: the balance check executes after the
    ///      callback in the same transaction. Insufficient return reverts everything.
    function lendAtomic(uint256 assets, uint256 fee, bytes calldata data) external notLending {
        require(msg.sender == intermediary, "intermediary_only");
        require(assets > 0, "assets_required");
        uint256 startingAssets = totalAssets();
        require(assets <= startingAssets, "insufficient_vault_liquidity");
        uint256 minimumFee = (assets * minimumAtomicFeeBps + BPS - 1) / BPS;
        require(fee >= minimumFee, "fee_below_vault_minimum");

        lending = true;
        _safeTransfer(asset, intermediary, assets);
        IGhostWalletVaultBorrower(intermediary).onGhostWalletVaultCredit(asset, assets, fee, data);
        uint256 endingAssets = totalAssets();
        require(endingAssets >= startingAssets + fee, "atomic_credit_not_repaid");
        lending = false;
        emit AtomicCreditSettled(assets, endingAssets - startingAssets, endingAssets);
    }

    function _convertToSharesDown(
        uint256 assets,
        uint256 assetsTotal,
        uint256 supply
    ) internal pure returns (uint256) {
        return (assets * (supply + 1)) / (assetsTotal + 1);
    }

    function _convertToSharesUp(
        uint256 assets,
        uint256 assetsTotal,
        uint256 supply
    ) internal pure returns (uint256) {
        uint256 numerator = assets * (supply + 1);
        uint256 denominator = assetsTotal + 1;
        return numerator == 0 ? 0 : (numerator + denominator - 1) / denominator;
    }

    function _convertToAssetsDown(
        uint256 shares,
        uint256 assetsTotal,
        uint256 supply
    ) internal pure returns (uint256) {
        return (shares * (assetsTotal + 1)) / (supply + 1);
    }

    function _convertToAssetsUp(
        uint256 shares,
        uint256 assetsTotal,
        uint256 supply
    ) internal pure returns (uint256) {
        uint256 numerator = shares * (assetsTotal + 1);
        uint256 denominator = supply + 1;
        return numerator == 0 ? 0 : (numerator + denominator - 1) / denominator;
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "mint_to_zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient_shares");
        unchecked {
            balanceOf[from] -= amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _transferShares(address from, address to, uint256 amount) internal {
        require(to != address(0), "transfer_to_zero");
        require(balanceOf[from] >= amount, "insufficient_shares");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _spendShareAllowance(address ownerAddress, address spender, uint256 amount) internal {
        if (spender == ownerAddress) return;
        uint256 current = allowance[ownerAddress][spender];
        if (current == type(uint256).max) return;
        require(current >= amount, "insufficient_allowance");
        unchecked {
            allowance[ownerAddress][spender] = current - amount;
        }
        emit Approval(ownerAddress, spender, allowance[ownerAddress][spender]);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostVaultAsset.transfer.selector, to, amount)
        );
        require(
            success && (returndata.length == 0 || abi.decode(returndata, (bool))),
            "erc20_transfer_failed"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20GhostVaultAsset.transferFrom.selector, from, to, amount)
        );
        require(
            success && (returndata.length == 0 || abi.decode(returndata, (bool))),
            "erc20_transfer_from_failed"
        );
    }
}
