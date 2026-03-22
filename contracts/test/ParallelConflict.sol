// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ParallelConflict
/// @notice Contract with a global counter that creates state access conflicts.
///         Reads and writes a single storage slot from every call, creating
///         the "bottleneck" pattern for vibe-score comparison in parallel execution.
contract ParallelConflict {
    uint256 public counter;

    event CounterIncremented(uint256 newValue);

    /// @notice Increment the global counter — causes read-write conflicts
    ///         when called in parallel transactions.
    function increment() external {
        uint256 current = counter;
        counter = current + 1;
        emit CounterIncremented(counter);
    }

    /// @notice Increment by a specific amount — same conflict pattern
    function incrementBy(uint256 amount) external {
        uint256 current = counter;
        counter = current + amount;
        emit CounterIncremented(counter);
    }

    /// @notice Get the current counter value
    function getCounter() external view returns (uint256) {
        return counter;
    }
}
