// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20GhostUniswapX {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

struct GhostUniswapXOrderInfo {
    address reactor;
    address swapper;
    uint256 nonce;
    uint256 deadline;
    address additionalValidationContract;
    bytes additionalValidationData;
}

struct GhostUniswapXInputToken {
    address token;
    uint256 amount;
    uint256 maxAmount;
}

struct GhostUniswapXOutputToken {
    address token;
    uint256 amount;
    address recipient;
}

struct GhostUniswapXResolvedOrder {
    GhostUniswapXOrderInfo info;
    GhostUniswapXInputToken input;
    GhostUniswapXOutputToken[] outputs;
    bytes sig;
    bytes32 hash;
}

struct GhostUniswapXSignedOrder {
    bytes order;
    bytes sig;
}

interface IGhostUniswapXReactor {
    function executeWithCallback(GhostUniswapXSignedOrder calldata order, bytes calldata callbackData) external payable;
}

/// @notice Zero-inventory UniswapX fill surface for Ghost Wallet.
/// @dev The reactor transfers the swapper's signed input to this contract before
///      reactorCallback. The callback may transform only that input through the
///      controller-selected route. Reactor output obligations are approved exactly;
///      any shortfall reverts the entire transaction. Profit is the residual output
///      after reactor settlement, so Ghost never needs operator trading principal.
contract CryptocrawlGhostWalletUniswapXFiller {
    struct Route {
        address target;
        bytes data;
        address inputToken;
        address profitToken;
        uint256 inputAmount;
        uint256 minProfit;
    }

    address public immutable owner;
    address public immutable profitRecipient;
    mapping(address => bool) public allowedReactors;

    bool private executing;
    address private activeReactor;
    address private activeProfitToken;
    uint256 private startingProfitBalance;
    uint256 private expectedInputAmount;
    uint256 private minimumProfit;

    event ReactorUpdated(address indexed reactor, bool allowed);
    event AtomicCreditSettled(
        address indexed source,
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

    modifier onlyIdle() {
        require(!executing, "execution_in_progress");
        _;
    }

    constructor(address ownerAddress, address profitRecipientAddress, address[] memory reactors) {
        require(ownerAddress != address(0), "owner_required");
        require(profitRecipientAddress != address(0), "profit_recipient_required");
        owner = ownerAddress;
        profitRecipient = profitRecipientAddress;
        for (uint256 i = 0; i < reactors.length; i++) {
            require(reactors[i] != address(0), "reactor_required");
            allowedReactors[reactors[i]] = true;
            emit ReactorUpdated(reactors[i], true);
        }
    }

    function setReactor(address reactor, bool allowed) external onlyOwner onlyIdle {
        require(reactor != address(0), "reactor_required");
        allowedReactors[reactor] = allowed;
        emit ReactorUpdated(reactor, allowed);
    }

    function executeSignedOrder(
        address reactor,
        bytes calldata encodedOrder,
        bytes calldata signature,
        Route calldata route
    ) external onlyOwner onlyIdle {
        require(allowedReactors[reactor], "reactor_not_allowed");
        require(encodedOrder.length > 0 && signature.length > 0, "signed_order_required");
        require(route.target != address(0) && route.target.code.length > 0, "route_target_required");
        require(route.inputToken != address(0) && route.inputToken.code.length > 0, "input_token_required");
        require(route.profitToken != address(0) && route.profitToken.code.length > 0, "profit_token_required");
        require(route.inputAmount > 0, "input_amount_required");
        require(route.minProfit > 0, "min_profit_required");

        executing = true;
        activeReactor = reactor;
        activeProfitToken = route.profitToken;
        startingProfitBalance = IERC20GhostUniswapX(route.profitToken).balanceOf(address(this));
        expectedInputAmount = route.inputAmount;
        minimumProfit = route.minProfit;

        IGhostUniswapXReactor(reactor).executeWithCallback(
            GhostUniswapXSignedOrder({ order: encodedOrder, sig: signature }),
            abi.encode(route)
        );

        uint256 endingProfitBalance = IERC20GhostUniswapX(route.profitToken).balanceOf(address(this));
        require(endingProfitBalance >= startingProfitBalance + route.minProfit, "profit_below_threshold");
        uint256 realizedProfit = endingProfitBalance - startingProfitBalance;
        _safeTransfer(route.profitToken, profitRecipient, realizedProfit);
        require(
            IERC20GhostUniswapX(route.profitToken).balanceOf(address(this)) == startingProfitBalance,
            "profit_residual_mismatch"
        );

        executing = false;
        activeReactor = address(0);
        activeProfitToken = address(0);
        startingProfitBalance = 0;
        expectedInputAmount = 0;
        minimumProfit = 0;

        emit AtomicCreditSettled(reactor, route.profitToken, route.inputAmount, 0, realizedProfit, profitRecipient);
    }

    function reactorCallback(
        GhostUniswapXResolvedOrder[] memory resolvedOrders,
        bytes memory callbackData
    ) external {
        require(executing && msg.sender == activeReactor && allowedReactors[msg.sender], "unexpected_reactor_callback");
        require(resolvedOrders.length == 1, "single_order_only");
        Route memory route = abi.decode(callbackData, (Route));
        GhostUniswapXResolvedOrder memory order = resolvedOrders[0];
        require(order.info.reactor == msg.sender, "resolved_reactor_mismatch");
        require(order.input.token == route.inputToken, "resolved_input_token_mismatch");
        require(order.input.amount == route.inputAmount && route.inputAmount == expectedInputAmount, "resolved_input_amount_mismatch");
        require(route.profitToken == activeProfitToken && route.minProfit == minimumProfit, "active_route_mismatch");
        require(order.outputs.length > 0, "resolved_outputs_required");

        uint256 inputBalance = IERC20GhostUniswapX(route.inputToken).balanceOf(address(this));
        require(inputBalance >= route.inputAmount, "reactor_input_not_received");

        _forceApprove(route.inputToken, route.target, route.inputAmount);
        (bool success, bytes memory result) = route.target.call(route.data);
        _forceApprove(route.inputToken, route.target, 0);
        if (!success) _bubble(result);

        for (uint256 i = 0; i < order.outputs.length; i++) {
            GhostUniswapXOutputToken memory output = order.outputs[i];
            require(output.token != address(0) && output.amount > 0, "resolved_output_invalid");
            require(
                IERC20GhostUniswapX(output.token).balanceOf(address(this)) >= output.amount,
                "resolved_output_shortfall"
            );
            _forceApprove(output.token, msg.sender, output.amount);
        }
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

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20GhostUniswapX.approve.selector, spender, amount)
        );
        if (success && (data.length == 0 || abi.decode(data, (bool)))) return;
        (bool resetSuccess, bytes memory resetData) = token.call(
            abi.encodeWithSelector(IERC20GhostUniswapX.approve.selector, spender, 0)
        );
        require(resetSuccess && (resetData.length == 0 || abi.decode(resetData, (bool))), "approval_reset_failed");
        (success, data) = token.call(
            abi.encodeWithSelector(IERC20GhostUniswapX.approve.selector, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "approval_failed");
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20GhostUniswapX.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer_failed");
    }

    function _bubble(bytes memory reason) internal pure {
        if (reason.length == 0) revert("route_call_failed");
        assembly {
            revert(add(reason, 32), mload(reason))
        }
    }

    receive() external payable {}
}
