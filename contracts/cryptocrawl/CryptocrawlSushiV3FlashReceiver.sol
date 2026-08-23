// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20FlashMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISushiV3Pool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

contract CryptocrawlSushiV3FlashReceiver {
    struct Step {
        address target;
        uint256 value;
        bytes callData;
        address approvalToken;
        uint256 approvalAmount;
    }

    address public immutable owner;
    address public immutable factory;
    mapping(address => bool) public operators;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;

    address private expectedPool;
    address private expectedToken0;
    address private expectedToken1;
    bool private flashActive;

    event OperatorUpdated(address indexed operator, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event ApprovalTokenUpdated(address indexed token, bool allowed);
    event SushiV3FlashExecuted(address indexed initiator, address indexed pool, address indexed profitToken, uint256 profit);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner_only");
        _;
    }

    modifier onlyController() {
        require(msg.sender == owner || operators[msg.sender], "controller_only");
        _;
    }

    modifier onlyIdle() {
        require(!flashActive, "flash_in_progress");
        _;
    }

    constructor(address factoryAddress, address ownerAddress) {
        require(factoryAddress != address(0), "factory_required");
        require(ownerAddress != address(0), "owner_required");
        factory = factoryAddress;
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

    function executeSushiV3Flash(
        address pool,
        uint256 amount0,
        uint256 amount1,
        Step[] calldata steps,
        address profitToken,
        uint256 minProfit,
        address profitRecipient
    ) external onlyController onlyIdle {
        require(pool != address(0), "pool_required");
        require(amount0 > 0 || amount1 > 0, "loan_required");
        require(steps.length > 0, "steps_required");
        require(profitToken != address(0) && profitRecipient != address(0), "profit_config_required");

        ISushiV3Pool flashPool = ISushiV3Pool(pool);
        require(flashPool.factory() == factory, "untrusted_pool_factory");
        expectedPool = pool;
        expectedToken0 = flashPool.token0();
        expectedToken1 = flashPool.token1();
        flashActive = true;

        uint256 startingProfitBalance = IERC20FlashMinimal(profitToken).balanceOf(address(this));
        flashPool.flash(
            address(this),
            amount0,
            amount1,
            abi.encode(msg.sender, amount0, amount1, steps, profitToken, minProfit, profitRecipient, startingProfitBalance)
        );

        require(!flashActive, "flash_callback_incomplete");
    }

    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {
        require(flashActive && msg.sender == expectedPool, "untrusted_flash_callback");
        (address initiator, uint256 amount0, uint256 amount1, Step[] memory steps, address profitToken, uint256 minProfit, address profitRecipient, uint256 startingProfitBalance) = abi.decode(
            data,
            (address, uint256, uint256, Step[], address, uint256, address, uint256)
        );

        for (uint256 i = 0; i < steps.length; i++) {
            Step memory step = steps[i];
            require(allowedTargets[step.target], "target_not_allowed");
            if (step.approvalToken != address(0) && step.approvalAmount > 0) {
                require(allowedApprovalTokens[step.approvalToken], "approval_token_not_allowed");
                _safeApprove(step.approvalToken, step.target, 0);
                _safeApprove(step.approvalToken, step.target, step.approvalAmount);
            }
            (bool success, bytes memory returndata) = step.target.call{value: step.value}(step.callData);
            require(success, _extractRevert(returndata));
        }

        uint256 amount0Owed = amount0 + fee0;
        uint256 amount1Owed = amount1 + fee1;
        uint256 token0Balance = IERC20FlashMinimal(expectedToken0).balanceOf(address(this));
        uint256 token1Balance = IERC20FlashMinimal(expectedToken1).balanceOf(address(this));
        amount0Owed = token0Balance >= amount0Owed ? amount0Owed : type(uint256).max;
        amount1Owed = token1Balance >= amount1Owed ? amount1Owed : type(uint256).max;
        require(amount0Owed != type(uint256).max && amount1Owed != type(uint256).max, "insufficient_repayment_balance");
        _safeTransfer(expectedToken0, expectedPool, amount0Owed);
        _safeTransfer(expectedToken1, expectedPool, amount1Owed);

        uint256 endingProfitBalance = IERC20FlashMinimal(profitToken).balanceOf(address(this));
        require(endingProfitBalance >= startingProfitBalance + minProfit, "profit_below_threshold");
        uint256 profit = endingProfitBalance - startingProfitBalance;
        if (profit > 0) _safeTransfer(profitToken, profitRecipient, profit);

        flashActive = false;
        expectedPool = address(0);
        expectedToken0 = address(0);
        expectedToken1 = address(0);
        emit SushiV3FlashExecuted(initiator, msg.sender, profitToken, profit);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner onlyIdle {
        _safeTransfer(token, to, amount);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20FlashMinimal.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_transfer_failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20FlashMinimal.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "erc20_approve_failed");
    }

    function _extractRevert(bytes memory returndata) internal pure returns (string memory) {
        if (returndata.length < 68) return "step_call_failed";
        assembly { returndata := add(returndata, 0x04) }
        return abi.decode(returndata, (string));
    }

    receive() external payable {}
}