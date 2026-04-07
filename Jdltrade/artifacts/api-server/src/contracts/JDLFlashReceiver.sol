// SPDX-License-Identifier: MIT
// JDL Flash Receiver v2.1 — multi-hop arbitrage, profit guard, fee sweep
pragma solidity ^0.8.10;

// ─────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    struct ExactInputParams {
        bytes   path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16  referralCode
    ) external;
}

// ─────────────────────────────────────────────────────────
// CONTRACT
// ─────────────────────────────────────────────────────────

contract JDLFlashReceiver is IFlashLoanSimpleReceiver {

    // Version identifier — updated on each recompile
    string  public constant VERSION = "2.1.0";

    address public owner;
    address public feeWallet;
    address public pool;
    uint256 public feeRateBps; // basis points, e.g. 75 = 0.75%

    // Per-execution profit guarantee: require at least this many wei profit
    uint256 public minProfitWei;

    event FlashLoanExecuted(address indexed asset, uint256 borrowed, uint256 profit, uint256 fee);
    event EmergencyWithdraw(address indexed token, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    constructor(address _pool, address _feeWallet) {
        owner      = msg.sender;
        pool       = _pool;
        feeWallet  = _feeWallet;
        feeRateBps = 75;       // 0.75% JDL system fee
        minProfitWei = 0;      // no minimum by default
    }

    // ── Access ────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "JDL: not owner");
        _;
    }

    modifier onlyPool() {
        require(msg.sender == pool, "JDL: not pool");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "JDL: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setFeeWallet(address _feeWallet) external onlyOwner {
        feeWallet = _feeWallet;
    }

    function setFeeRateBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "JDL: fee too high"); // cap at 5%
        feeRateBps = _bps;
    }

    function setMinProfitWei(uint256 _min) external onlyOwner {
        minProfitWei = _min;
    }

    // ── Flash Loan Callback ───────────────────────────────

    /// @notice Called by Aave V3 after transferring flash loan funds to this contract.
    ///         Executes an arbitrary arbitrage call, verifies profit, pays fee, repays pool.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override onlyPool returns (bool) {
        require(initiator == owner, "JDL: bad initiator");

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Decode: router address + encoded swap call (supports both single and multi-hop)
        (address router, bytes memory swapCall) = abi.decode(params, (address, bytes));

        // Approve router to spend borrowed tokens
        IERC20(asset).approve(router, amount);

        // Execute the arbitrage swap (single-hop or multi-hop path)
        (bool ok, ) = router.call(swapCall);
        require(ok, "JDL: swap failed");

        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 totalOwed    = amount + premium;

        // Profit guard — ensure we have enough to repay Aave plus a minimum profit
        require(balanceAfter >= totalOwed + minProfitWei, "JDL: insufficient profit");

        // Repay Aave (loan + premium)
        IERC20(asset).approve(pool, totalOwed);

        // Calculate JDL system fee on gross profit
        uint256 grossProfit = balanceAfter - totalOwed;
        uint256 jdlFee      = (grossProfit * feeRateBps) / 10_000;
        uint256 netProfit   = grossProfit - jdlFee;

        // Transfer JDL fee to fee wallet
        if (jdlFee > 0 && feeWallet != address(0)) {
            IERC20(asset).transfer(feeWallet, jdlFee);
        }

        // Transfer net profit to owner
        if (netProfit > 0) {
            IERC20(asset).transfer(owner, netProfit);
        }

        emit FlashLoanExecuted(asset, amount, netProfit, jdlFee);

        return true;
    }

    // ── Initiation ────────────────────────────────────────

    /// @notice Initiate a flash loan from the Aave V3 pool.
    ///         Encode swapCall as `abi.encodeWithSelector(router.exactInputSingle.selector, params)`
    ///         for single-hop, or `exactInput` selector for multi-hop.
    function initiateFlashLoan(
        address asset,
        uint256 amount,
        address router,
        bytes calldata swapCall
    ) external onlyOwner {
        bytes memory p = abi.encode(router, swapCall);
        IPool(pool).flashLoanSimple(address(this), asset, amount, p, 0);
    }

    // ── Multi-Hop Helper ──────────────────────────────────

    /// @notice Convenience: build a multi-hop flash loan path and initiate.
    ///         path is the Uniswap V3 encoded bytes path (tokenA + fee + tokenB + fee + tokenC).
    function initiateMultiHopFlashLoan(
        address asset,
        uint256 amount,
        address router,
        bytes calldata path,
        uint256 amountOutMinimum
    ) external onlyOwner {
        bytes memory swapCall = abi.encodeWithSelector(
            IUniswapV3Router.exactInput.selector,
            IUniswapV3Router.ExactInputParams({
                path:             path,
                recipient:        address(this),
                amountIn:         amount,
                amountOutMinimum: amountOutMinimum
            })
        );
        bytes memory p = abi.encode(router, swapCall);
        IPool(pool).flashLoanSimple(address(this), asset, amount, p, 0);
    }

    // ── Emergency ─────────────────────────────────────────

    /// @notice Emergency withdraw any ERC20 token (including stuck funds)
    function withdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "JDL: nothing to withdraw");
        IERC20(token).transfer(owner, bal);
        emit EmergencyWithdraw(token, bal);
    }

    /// @notice Emergency withdraw native ETH
    function withdrawEth() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "JDL: no ETH");
        payable(owner).transfer(bal);
    }

    receive() external payable {}
    fallback() external payable {}
}
