// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FailingContract
/// @notice Contract that always reverts — used to test error path handling.
contract FailingContract {
    error AlwaysFails();

    /// @notice This function always reverts
    function doSomething() external pure {
        revert AlwaysFails();
    }

    /// @notice Fallback that also reverts
    fallback() external {
        revert AlwaysFails();
    }
}
