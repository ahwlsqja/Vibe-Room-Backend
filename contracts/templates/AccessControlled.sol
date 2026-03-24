// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AccessControlled — Role-Based Access Control
/// @author Vibe Coding Template
/// @notice A flexible role-based access control system with per-role-per-address storage.
/// @dev **Parallel execution pattern**: Role assignments are stored in a nested mapping
///      `_roles[role][account]`, where each (role, account) pair occupies an independent
///      storage slot. Granting role A to user X and role B to user Y can execute in parallel
///      because they modify disjoint storage locations.
///
///      This pattern is ideal for DAOs, admin panels, and permissioned DeFi protocols
///      where role management operations should not serialize.
contract AccessControlled {
    /// @notice Mapping from role hash to account to granted status.
    /// @dev `_roles[roleA][userX]` and `_roles[roleB][userY]` are independent storage slots.
    ///      Role checks and grants on different (role, account) pairs can execute in parallel.
    mapping(bytes32 => mapping(address => bool)) private _roles;

    /// @notice Mapping from role hash to its admin role hash.
    /// @dev Each role has an admin role that can grant/revoke it.
    mapping(bytes32 => bytes32) private _roleAdmin;

    /// @notice Default admin role — the root of the role hierarchy
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @notice Common role constants for convenience
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdmin, bytes32 indexed newAdmin);

    modifier onlyRole(bytes32 role) {
        require(_roles[role][msg.sender], "AccessControl: unauthorized");
        _;
    }

    /// @notice Deploy with the deployer as the default admin.
    constructor() {
        _roles[DEFAULT_ADMIN_ROLE][msg.sender] = true;
        emit RoleGranted(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
    }

    /// @notice Grant a role to an account.
    /// @dev Only the role's admin can grant it. Modifies `_roles[role][account]` —
    ///      an independent storage slot per (role, account) pair. Grants on different
    ///      pairs can execute in parallel on Monad.
    /// @param role The role to grant
    /// @param account The account to receive the role
    function grantRole(bytes32 role, address account) external onlyRole(_roleAdmin[role]) {
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    /// @notice Revoke a role from an account.
    /// @dev Only the role's admin can revoke. Parallel-safe across different (role, account) pairs.
    /// @param role The role to revoke
    /// @param account The account to remove the role from
    function revokeRole(bytes32 role, address account) external onlyRole(_roleAdmin[role]) {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    /// @notice Renounce a role for yourself.
    /// @dev Accounts can only renounce roles for themselves, not others.
    ///      This is a safety measure to prevent accidental admin lockout.
    /// @param role The role to renounce
    function renounceRole(bytes32 role) external {
        require(_roles[role][msg.sender], "AccessControl: no role to renounce");
        _roles[role][msg.sender] = false;
        emit RoleRevoked(role, msg.sender, msg.sender);
    }

    /// @notice Set a new admin role for a given role.
    /// @dev Only the current admin of the role (or DEFAULT_ADMIN_ROLE) can change this.
    /// @param role The role to set a new admin for
    /// @param adminRole The new admin role
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyRole(_roleAdmin[role]) {
        bytes32 previousAdmin = _roleAdmin[role];
        _roleAdmin[role] = adminRole;
        emit RoleAdminChanged(role, previousAdmin, adminRole);
    }

    /// @notice Check if an account has a specific role.
    /// @param role The role to check
    /// @param account The account to check
    /// @return Whether the account has the role
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    /// @notice Get the admin role for a given role.
    /// @param role The role to query
    /// @return The admin role hash
    function getRoleAdmin(bytes32 role) external view returns (bytes32) {
        return _roleAdmin[role];
    }
}
