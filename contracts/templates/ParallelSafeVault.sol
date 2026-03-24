// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ParallelSafeVault — Per-User Vault with Independent Deposit/Withdrawal
/// @author Vibe Coding Template
/// @notice A vault contract designed for maximum parallel execution on Monad.
/// @dev **Shard-Key Pattern**: Each user's vault state (balance, lock, metadata) is stored
///      in per-user mapping slots. The key insight is that `vaults[userA]` and `vaults[userB]`
///      occupy completely independent storage slots, so deposit/withdrawal transactions
///      from different users can execute in parallel without any state conflicts.
///
///      Anti-pattern to avoid: a shared `totalDeposits` counter updated on every deposit.
///      This would serialize all deposits because every transaction writes to the same slot.
///      Instead, we compute totals via view functions that iterate (or track per-epoch snapshots).
///
///      This pattern is the foundation of Monad-native contract design.
contract ParallelSafeVault {
    struct VaultInfo {
        uint256 balance;
        uint256 depositTimestamp;
        bool locked;
    }

    /// @notice Per-user vault storage — the core shard-key pattern.
    /// @dev Each address maps to its own VaultInfo struct in an independent storage slot.
    ///      Monad can process deposits/withdrawals for different users simultaneously because
    ///      they touch disjoint storage locations.
    mapping(address => VaultInfo) public vaults;

    /// @notice Minimum lock duration before withdrawal is allowed
    uint256 public immutable minLockDuration;

    /// @notice Vault owner/admin for emergency operations
    address public immutable owner;

    event Deposited(address indexed user, uint256 amount, uint256 timestamp);
    event Withdrawn(address indexed user, uint256 amount);
    event VaultLocked(address indexed user);
    event VaultUnlocked(address indexed user);
    event EmergencyWithdrawal(address indexed user, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Vault: not owner");
        _;
    }

    /// @param _minLockDuration Minimum seconds a deposit must be locked before withdrawal
    constructor(uint256 _minLockDuration) {
        owner = msg.sender;
        minLockDuration = _minLockDuration;
    }

    /// @notice Deposit ETH into your personal vault.
    /// @dev Only modifies `vaults[msg.sender]` — fully parallel-safe across different depositors.
    ///      Each user's deposit touches exactly one storage slot, enabling Monad to process
    ///      deposits from users A, B, C simultaneously.
    function deposit() external payable {
        require(msg.value > 0, "Vault: zero deposit");
        require(!vaults[msg.sender].locked, "Vault: vault is locked");

        VaultInfo storage vault = vaults[msg.sender];
        vault.balance += msg.value;
        vault.depositTimestamp = block.timestamp;

        emit Deposited(msg.sender, msg.value, block.timestamp);
    }

    /// @notice Withdraw all funds from your vault after the lock period.
    /// @dev Only modifies `vaults[msg.sender]` — parallel-safe.
    ///      The lock duration check uses per-user timestamps, not a global clock.
    function withdraw() external {
        VaultInfo storage vault = vaults[msg.sender];
        require(vault.balance > 0, "Vault: nothing to withdraw");
        require(!vault.locked, "Vault: vault is locked");
        require(
            block.timestamp >= vault.depositTimestamp + minLockDuration,
            "Vault: lock period not elapsed"
        );

        uint256 amount = vault.balance;
        vault.balance = 0;
        vault.depositTimestamp = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Vault: transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Lock your vault to prevent withdrawals (e.g., for staking commitment).
    /// @dev Per-user lock — does not affect other users' vaults.
    function lockVault() external {
        require(vaults[msg.sender].balance > 0, "Vault: no balance to lock");
        vaults[msg.sender].locked = true;
        emit VaultLocked(msg.sender);
    }

    /// @notice Unlock your vault to allow withdrawals again.
    function unlockVault() external {
        require(vaults[msg.sender].locked, "Vault: not locked");
        vaults[msg.sender].locked = false;
        emit VaultUnlocked(msg.sender);
    }

    /// @notice Emergency withdrawal by owner — bypasses lock and time restrictions.
    /// @dev Only for emergency scenarios. Emits a distinct event for auditability.
    /// @param user Address of the vault to drain
    function emergencyWithdraw(address user) external onlyOwner {
        VaultInfo storage vault = vaults[user];
        require(vault.balance > 0, "Vault: nothing to withdraw");

        uint256 amount = vault.balance;
        vault.balance = 0;
        vault.locked = false;
        vault.depositTimestamp = 0;

        (bool success, ) = user.call{value: amount}("");
        require(success, "Vault: transfer failed");

        emit EmergencyWithdrawal(user, amount);
    }

    /// @notice Check a user's vault balance without modifying state.
    /// @dev View function — zero gas, no state access conflicts.
    /// @param user Address to query
    /// @return balance The user's current vault balance
    function getBalance(address user) external view returns (uint256) {
        return vaults[user].balance;
    }

    /// @notice Check if a user's vault is currently locked.
    /// @param user Address to query
    /// @return locked Whether the vault is locked
    function isLocked(address user) external view returns (bool) {
        return vaults[user].locked;
    }
}
