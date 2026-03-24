// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TimeLockedWallet — Per-Beneficiary Time-Locked Deposits
/// @author Vibe Coding Template
/// @notice A wallet where each beneficiary has an independent time-locked deposit.
/// @dev **Parallel execution pattern**: Each beneficiary's lock is stored in an independent
///      mapping slot (`locks[beneficiary]`). Deposits for user A and withdrawals for user B
///      touch completely disjoint storage, enabling Monad to process them in parallel.
///
///      This is useful for vesting schedules, escrow, and delayed-release payments
///      where each recipient operates independently.
contract TimeLockedWallet {
    struct Lock {
        uint256 amount;
        uint256 unlockTime;
        address depositor;
    }

    /// @notice Per-beneficiary lock storage — independent slots per address.
    /// @dev `locks[userA]` and `locks[userB]` are disjoint storage locations,
    ///      enabling parallel deposit/withdraw operations for different beneficiaries.
    mapping(address => Lock) public locks;

    /// @notice Contract owner who can create locks
    address public immutable owner;

    event Deposited(address indexed beneficiary, uint256 amount, uint256 unlockTime, address indexed depositor);
    event Withdrawn(address indexed beneficiary, uint256 amount);
    event Extended(address indexed beneficiary, uint256 newUnlockTime);

    modifier onlyOwner() {
        require(msg.sender == owner, "TimeLock: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Deposit ETH for a beneficiary with a time lock.
    /// @dev Creates or adds to a lock in `locks[beneficiary]` — an independent storage slot.
    ///      Deposits for different beneficiaries can execute in parallel.
    /// @param beneficiary Address that can withdraw after unlock time
    /// @param lockDuration Seconds from now until the funds unlock
    function deposit(address beneficiary, uint256 lockDuration) external payable {
        require(beneficiary != address(0), "TimeLock: zero address");
        require(msg.value > 0, "TimeLock: zero deposit");
        require(lockDuration > 0, "TimeLock: zero duration");

        Lock storage lock = locks[beneficiary];

        if (lock.amount > 0) {
            // Add to existing lock — keep the later unlock time
            lock.amount += msg.value;
            uint256 newUnlockTime = block.timestamp + lockDuration;
            if (newUnlockTime > lock.unlockTime) {
                lock.unlockTime = newUnlockTime;
            }
        } else {
            // Create new lock
            lock.amount = msg.value;
            lock.unlockTime = block.timestamp + lockDuration;
            lock.depositor = msg.sender;
        }

        emit Deposited(beneficiary, msg.value, lock.unlockTime, msg.sender);
    }

    /// @notice Withdraw unlocked funds.
    /// @dev Only modifies `locks[msg.sender]` — fully parallel-safe across different beneficiaries.
    ///      User A withdrawing their lock does not interfere with user B's lock operations.
    function withdraw() external {
        Lock storage lock = locks[msg.sender];
        require(lock.amount > 0, "TimeLock: nothing to withdraw");
        require(block.timestamp >= lock.unlockTime, "TimeLock: still locked");

        uint256 amount = lock.amount;
        lock.amount = 0;
        lock.unlockTime = 0;
        lock.depositor = address(0);

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "TimeLock: transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Extend the lock duration for a beneficiary (owner only).
    /// @param beneficiary Address whose lock to extend
    /// @param additionalDuration Extra seconds to add to the unlock time
    function extendLock(address beneficiary, uint256 additionalDuration) external onlyOwner {
        Lock storage lock = locks[beneficiary];
        require(lock.amount > 0, "TimeLock: no active lock");
        require(additionalDuration > 0, "TimeLock: zero extension");

        lock.unlockTime += additionalDuration;
        emit Extended(beneficiary, lock.unlockTime);
    }

    /// @notice Check remaining lock time for a beneficiary.
    /// @param beneficiary Address to query
    /// @return remainingSeconds Seconds until unlock (0 if already unlocked)
    function getRemainingTime(address beneficiary) external view returns (uint256 remainingSeconds) {
        Lock storage lock = locks[beneficiary];
        if (lock.amount == 0 || block.timestamp >= lock.unlockTime) {
            return 0;
        }
        return lock.unlockTime - block.timestamp;
    }

    /// @notice Check the locked balance for a beneficiary.
    /// @param beneficiary Address to query
    /// @return The locked amount
    function getLockedBalance(address beneficiary) external view returns (uint256) {
        return locks[beneficiary].amount;
    }
}
