// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

struct ReactorOrderInfo {
    address reactor;
    address swapper;
    uint256 nonce;
    uint256 deadline;
    address additionalValidationContract;
    bytes additionalValidationData;
}

struct ReactorInputToken {
    address token;
    uint256 amount;
    uint256 maxAmount;
}

struct ReactorOutputToken {
    address token;
    uint256 amount;
    address recipient;
}

struct ReactorResolvedOrder {
    ReactorOrderInfo info;
    ReactorInputToken input;
    ReactorOutputToken[] outputs;
    bytes sig;
    bytes32 hash;
}

struct ReactorSignedOrder {
    bytes order;
    bytes sig;
}

interface IUniswapXReactor {
    function executeWithCallback(ReactorSignedOrder calldata order, bytes calldata callbackData) external payable;
}

/**
 * @title CryptocrawlUniswapXCallbackExecutor
 * @notice Zero-prefund UniswapX filler executor. The reactor first transfers the
 *         user's signed-order input into this contract, then calls reactorCallback.
 *         The callback can route only through owner-reviewed targets/tokens and
 *         grants the reactor only the exact output allowance needed to settle.
 *         Profit is measured after reactor settlement and paid as a positive delta;
 *         pre-existing balances never become execution-profit evidence.
 */
contract CryptocrawlUniswapXCallbackExecutor {
    struct Step {
        address target;
        address approvalToken;
        uint256 approvalAmount;
        uint256 value;
        bytes data;
    }

    address public immutable owner;
    mapping(address => bool) public allowedControllers;
    mapping(address => bool) public allowedReactors;
    mapping(address => bool) public allowedTargets;
    mapping(address => bool) public allowedApprovalTokens;

    bool private _executing;
    address private _expectedReactor;

    event ControllerPermissionUpdated(address indexed controller, bool allowed);
    event ReactorPermissionUpdated(address indexed reactor, bool allowed);
    event TargetPermissionUpdated(address indexed target, bool allowed);
    event ApprovalTokenPermissionUpdated(address indexed token, bool allowed);
    event IntentExecuted(
        address indexed reactor,
        bytes32 indexed orderHash,
        address indexed profitToken,
        address profitRecipient,
        uint256 realizedProfit
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only_owner");
        _;
    }

    modifier onlyController() {
        require(msg.sender == owner || allowedControllers[msg.sender], "controller_not_allowed");
        _;
    }

    modifier onlyIdle() {
        require(!_executing, "execution_in_progress");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "owner_zero");
        owner = owner_;
        allowedControllers[owner_] = true;
        emit ControllerPermissionUpdated(owner_, true);
    }

    function setAllowedController(address controller, bool allowed) external onlyOwner onlyIdle {
        require(controller != address(0), "controller_zero");
        allowedControllers[controller] = allowed;
        emit ControllerPermissionUpdated(controller, allowed);
    }

    function setAllowedReactor(address reactor, bool allowed) external onlyOwner onlyIdle {
        require(reactor != address(0), "reactor_zero");
        allowedReactors[reactor] = allowed;
        emit ReactorPermissionUpdated(reactor, allowed);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner onlyIdle {
        require(target != address(0), "target_zero");
        allowedTargets[target] = allowed;
        emit TargetPermissionUpdated(target, allowed);
    }

    function setAllowedApprovalToken(address token, bool allowed) external onlyOwner onlyIdle {
        require(token != address(0), "token_zero");
        allowedApprovalTokens[token] = allowed;
        emit ApprovalTokenPermissionUpdated(token, allowed);
    }

    function execute(
        address reactor,
        ReactorSignedOrder calldata order,
        Step[] calldata steps,
        address profitToken,
        uint256 minProfit,
        address profitRecipient
    ) external payable onlyController onlyIdle returns (uint256 realizedProfit) {
        require(allowedReactors[reactor], "reactor_not_allowed");
        require(profitToken != address(0), "profit_token_zero");
        require(profitRecipient != address(0), "profit_recipient_zero");
        require(minProfit > 0, "min_profit_zero");
        require(steps.length > 0 && steps.length <= 8, "invalid_step_count");

        uint256 startingProfitBalance = _balanceOf(profitToken, address(this));
        _executing = true;
        _expectedReactor = reactor;

        IUniswapXReactor(reactor).executeWithCallback{value: msg.value}(order, abi.encode(steps));

        _expectedReactor = address(0);
        _executing = false;

        uint256 endingProfitBalance = _balanceOf(profitToken, address(this));
        require(endingProfitBalance >= startingProfitBalance, "profit_balance_decreased");
        realizedProfit = endingProfitBalance - startingProfitBalance;
        require(realizedProfit >= minProfit, "profit_below_threshold");

        _safeTransfer(profitToken, profitRecipient, realizedProfit);
        emit IntentExecuted(reactor, keccak256(order.order), profitToken, profitRecipient, realizedProfit);
    }

    function reactorCallback(ReactorResolvedOrder[] calldata orders, bytes calldata callbackData) external {
        require(_executing, "no_active_execution");
        require(msg.sender == _expectedReactor && allowedReactors[msg.sender], "unexpected_reactor");
        require(orders.length == 1, "single_order_only");
        require(orders[0].info.reactor == msg.sender, "resolved_reactor_mismatch");

        Step[] memory steps = abi.decode(callbackData, (Step[]));
        require(steps.length > 0 && steps.length <= 8, "invalid_step_count");

        for (uint256 i = 0; i < steps.length; i++) {
            Step memory step = steps[i];
            require(allowedTargets[step.target], "target_not_allowed");
            if (step.approvalAmount > 0) {
                require(step.approvalToken != address(0), "approval_token_zero");
                require(allowedApprovalTokens[step.approvalToken], "approval_token_not_allowed");
                _forceApprove(step.approvalToken, step.target, step.approvalAmount);
            }
            (bool ok, bytes memory result) = step.target.call{value: step.value}(step.data);
            if (!ok) _bubbleRevert(result);
            if (step.approvalAmount > 0) _forceApprove(step.approvalToken, step.target, 0);
        }

        // Approve only the exact resolved output amount the trusted reactor will
        // pull after the callback. Duplicate output tokens are summed once.
        for (uint256 i = 0; i < orders[0].outputs.length; i++) {
            address token = orders[0].outputs[i].token;
            bool seen;
            for (uint256 j = 0; j < i; j++) {
                if (orders[0].outputs[j].token == token) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;

            uint256 totalRequired;
            for (uint256 j = i; j < orders[0].outputs.length; j++) {
                if (orders[0].outputs[j].token == token) totalRequired += orders[0].outputs[j].amount;
            }
            require(_balanceOf(token, address(this)) >= totalRequired, "insufficient_output_balance");
            _forceApprove(token, msg.sender, totalRequired);
        }
    }

    function rescueToken(address token, address recipient, uint256 amount) external onlyOwner onlyIdle {
        require(recipient != address(0), "recipient_zero");
        _safeTransfer(token, recipient, amount);
    }

    function rescueNative(address payable recipient, uint256 amount) external onlyOwner onlyIdle {
        require(recipient != address(0), "recipient_zero");
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "native_transfer_failed");
    }

    function _balanceOf(address token, address account) private view returns (uint256 balance) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, account));
        require(ok && data.length >= 32, "balance_query_failed");
        balance = abi.decode(data, (uint256));
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        if (!_callOptionalReturn(token, abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount))) {
            require(_callOptionalReturn(token, abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, 0)), "approve_reset_failed");
            require(_callOptionalReturn(token, abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)), "approve_failed");
        }
    }

    function _safeTransfer(address token, address recipient, uint256 amount) private {
        require(_callOptionalReturn(token, abi.encodeWithSelector(IERC20Minimal.transfer.selector, recipient, amount)), "transfer_failed");
    }

    function _callOptionalReturn(address token, bytes memory data) private returns (bool) {
        (bool ok, bytes memory returndata) = token.call(data);
        if (!ok) return false;
        if (returndata.length == 0) return true;
        if (returndata.length < 32) return false;
        return abi.decode(returndata, (bool));
    }

    function _bubbleRevert(bytes memory result) private pure {
        if (result.length == 0) revert("step_call_failed");
        assembly {
            revert(add(result, 32), mload(result))
        }
    }

    receive() external payable {}
}
