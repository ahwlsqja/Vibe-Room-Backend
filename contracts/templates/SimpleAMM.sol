// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SimpleAMM — Constant-Product Automated Market Maker
/// @author Vibe Coding Template
/// @notice A minimal x*y=k AMM with per-pair independent liquidity pools.
/// @dev Each liquidity pair stores its own reserves in independent mappings.
///      Swaps on different pairs touch disjoint storage slots, enabling parallel execution.
///      This implementation supports a single token pair for simplicity.
contract SimpleAMM {
    /// @notice The two tokens in this AMM pair
    address public immutable tokenA;
    address public immutable tokenB;

    /// @notice Reserve balances for each token held by the AMM
    /// @dev Per-pair reserves are independent — swaps on different AMM instances
    ///      can execute in parallel on Monad without state conflicts.
    uint256 public reserveA;
    uint256 public reserveB;

    /// @notice LP token balances — per-provider independent slots
    mapping(address => uint256) public liquidity;
    uint256 public totalLiquidity;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Swap(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    /// @param _tokenA Address of the first token
    /// @param _tokenB Address of the second token
    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "AMM: zero address");
        require(_tokenA != _tokenB, "AMM: identical tokens");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /// @notice Add liquidity to the pool.
    /// @dev For simplicity, this uses a direct deposit model (msg.value or pre-approved transfers
    ///      would be needed in production). Here we accept raw amounts for educational purposes.
    /// @param amountA Amount of tokenA to deposit
    /// @param amountB Amount of tokenB to deposit
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(amountA > 0 && amountB > 0, "AMM: zero amount");

        uint256 lpTokens;
        if (totalLiquidity == 0) {
            // Initial liquidity — LP tokens = sqrt(amountA * amountB)
            lpTokens = _sqrt(amountA * amountB);
        } else {
            // Proportional liquidity based on existing reserves
            uint256 lpFromA = (amountA * totalLiquidity) / reserveA;
            uint256 lpFromB = (amountB * totalLiquidity) / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        require(lpTokens > 0, "AMM: insufficient liquidity minted");

        reserveA += amountA;
        reserveB += amountB;
        liquidity[msg.sender] += lpTokens;
        totalLiquidity += lpTokens;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    /// @notice Remove liquidity from the pool.
    /// @param lpTokens Amount of LP tokens to burn
    function removeLiquidity(uint256 lpTokens) external {
        require(lpTokens > 0 && liquidity[msg.sender] >= lpTokens, "AMM: insufficient LP tokens");

        uint256 amountA = (lpTokens * reserveA) / totalLiquidity;
        uint256 amountB = (lpTokens * reserveB) / totalLiquidity;

        liquidity[msg.sender] -= lpTokens;
        totalLiquidity -= lpTokens;
        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    /// @notice Swap tokenA for tokenB using the constant-product formula.
    /// @dev x * y = k invariant. Output = (amountIn * reserveOut) / (reserveIn + amountIn).
    ///      A 0.3% fee is applied to the input amount.
    /// @param amountIn Amount of tokenA to swap
    /// @return amountOut Amount of tokenB received
    function swapAForB(uint256 amountIn) external returns (uint256 amountOut) {
        require(amountIn > 0, "AMM: zero input");
        require(reserveA > 0 && reserveB > 0, "AMM: no liquidity");

        // 0.3% fee: effective input = amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveB) / (reserveA * 1000 + amountInWithFee);

        require(amountOut > 0, "AMM: insufficient output");

        reserveA += amountIn;
        reserveB -= amountOut;

        emit Swap(msg.sender, tokenA, amountIn, amountOut);
    }

    /// @notice Swap tokenB for tokenA using the constant-product formula.
    /// @param amountIn Amount of tokenB to swap
    /// @return amountOut Amount of tokenA received
    function swapBForA(uint256 amountIn) external returns (uint256 amountOut) {
        require(amountIn > 0, "AMM: zero input");
        require(reserveA > 0 && reserveB > 0, "AMM: no liquidity");

        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveA) / (reserveB * 1000 + amountInWithFee);

        require(amountOut > 0, "AMM: insufficient output");

        reserveB += amountIn;
        reserveA -= amountOut;

        emit Swap(msg.sender, tokenB, amountIn, amountOut);
    }

    /// @notice Get the current price of tokenA in terms of tokenB.
    /// @return price The exchange rate (reserveB / reserveA) scaled by 1e18
    function getPrice() external view returns (uint256 price) {
        require(reserveA > 0, "AMM: no liquidity");
        price = (reserveB * 1e18) / reserveA;
    }

    /// @dev Integer square root using the Babylonian method.
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
