// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PectraTest
/// @notice Contract using EIP-1153 transient storage (TSTORE/TLOAD).
///         Requires cancun EVM version or later. Used to verify EVM
///         version compatibility in the compilation pipeline.
contract PectraTest {
    event TransientValueSet(uint256 value);

    /// @notice Store a value in transient storage using TSTORE, then read it
    ///         back with TLOAD. The value is only available within this transaction.
    /// @param value The value to store transiently
    /// @return The value read back from transient storage
    function testTransientStorage(uint256 value) external returns (uint256) {
        assembly {
            // TSTORE: store value at slot 0 in transient storage
            tstore(0, value)
            // TLOAD: load value from slot 0 in transient storage
            let loaded := tload(0)
            // Store result in memory for return
            mstore(0x00, loaded)
        }
        uint256 result;
        assembly {
            result := mload(0x00)
        }
        emit TransientValueSet(result);
        return result;
    }
}
