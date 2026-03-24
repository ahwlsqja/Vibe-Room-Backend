// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonadERC20 — Parallel-Safe ERC20 Token
/// @author Vibe Coding Template
/// @notice A minimal ERC20 implementation optimized for parallel execution on Monad.
/// @dev Key design principle: each user's balance is stored in an independent mapping slot.
///      Because `balances[msg.sender]` and `balances[recipient]` occupy different storage slots,
///      transfers between distinct pairs can execute in parallel without state conflicts.
///      We intentionally avoid a shared `totalSupply` counter that would serialize all mints.
///      Instead, totalSupply is set once at construction and remains immutable.
contract MonadERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    /// @notice Total supply is set at construction and never changes.
    /// @dev Immutable total supply avoids a shared write-slot that would serialize parallel mints.
    uint256 public immutable totalSupply;

    /// @notice Per-user balance mapping — each address occupies an independent storage slot.
    /// @dev This is the core of parallel-safety: transfers between different (sender, receiver)
    ///      pairs touch disjoint storage slots, enabling Monad's parallel execution engine
    ///      to process them concurrently.
    mapping(address => uint256) public balanceOf;

    /// @notice Per-owner, per-spender allowance mapping — also shard-key independent.
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @notice Deploy token with a fixed supply allocated entirely to the deployer.
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _totalSupply Total supply in smallest unit (wei)
    constructor(string memory _name, string memory _symbol, uint256 _totalSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;
        balanceOf[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);
    }

    /// @notice Transfer tokens to a recipient.
    /// @dev Only touches balanceOf[msg.sender] and balanceOf[to] — two independent slots.
    ///      Parallel-safe when different senders transfer to different recipients.
    /// @param to Recipient address
    /// @param amount Amount to transfer
    /// @return success Always true on success (reverts on failure)
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: transfer to zero address");
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Approve a spender to transfer tokens on your behalf.
    /// @param spender Address authorized to spend
    /// @param amount Maximum amount spender can transfer
    /// @return success Always true
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfer tokens from one address to another using allowance.
    /// @dev Touches allowance[from][msg.sender], balanceOf[from], balanceOf[to].
    ///      Parallel-safe when (from, to) pairs are distinct across transactions.
    /// @param from Source address
    /// @param to Destination address
    /// @param amount Amount to transfer
    /// @return success Always true on success
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: transfer to zero address");
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }
}
