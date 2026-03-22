// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FixedContract
/// @notice Simple storage contract — baseline for vibe-score comparison.
///         Stores and retrieves a single uint256 value.
contract FixedContract {
    uint256 private storedValue;

    event ValueChanged(uint256 oldValue, uint256 newValue);

    /// @notice Store a new value
    /// @param _value The value to store
    function store(uint256 _value) external {
        uint256 oldValue = storedValue;
        storedValue = _value;
        emit ValueChanged(oldValue, _value);
    }

    /// @notice Retrieve the stored value
    /// @return The current stored value
    function retrieve() external view returns (uint256) {
        return storedValue;
    }
}
