// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonadERC721 — Parallel-Safe Basic NFT
/// @author Vibe Coding Template
/// @notice A minimal ERC721 implementation optimized for parallel execution on Monad.
/// @dev Key design principle: ownership is stored in a per-tokenId mapping (`_owners[tokenId]`)
///      rather than using shared enumeration arrays. This means mint/transfer operations on
///      different token IDs touch completely independent storage slots, enabling Monad's
///      parallel execution engine to process them concurrently.
///
///      Anti-pattern avoided: ERC721Enumerable's `_allTokens` array and `_ownedTokens` mapping
///      serialize all mint/transfer operations because they write to shared state.
contract MonadERC721 {
    string public name;
    string public symbol;

    /// @notice Per-tokenId ownership — each token occupies an independent storage slot.
    /// @dev This is the core parallel-safety feature: transfers of token #1 and token #2
    ///      can execute simultaneously because they modify disjoint storage locations.
    mapping(uint256 => address) private _owners;

    /// @notice Per-user balance count — independent slots per address.
    mapping(address => uint256) private _balances;

    /// @notice Per-token approval — independent slot per tokenId.
    mapping(uint256 => address) private _tokenApprovals;

    /// @notice Operator approvals — per-owner, per-operator independent slots.
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /// @notice Next token ID to mint
    uint256 private _nextTokenId;

    /// @notice Contract deployer (has minting rights)
    address public immutable owner;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "ERC721: not owner");
        _;
    }

    /// @param _name Token collection name
    /// @param _symbol Token collection symbol
    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        _nextTokenId = 1;
    }

    /// @notice Mint a new NFT to the specified address.
    /// @dev Each mint writes to `_owners[newTokenId]` — an independent slot per token.
    ///      Parallel mints are safe because each targets a unique tokenId slot.
    /// @param to Recipient address
    /// @return tokenId The newly minted token ID
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "ERC721: mint to zero address");
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    /// @notice Transfer an NFT from one address to another.
    /// @dev Touches `_owners[tokenId]`, `_balances[from]`, `_balances[to]`.
    ///      Transfers of different tokenIds can execute in parallel.
    /// @param from Current owner
    /// @param to New owner
    /// @param tokenId Token to transfer
    function transferFrom(address from, address to, uint256 tokenId) external {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: not authorized");
        require(_owners[tokenId] == from, "ERC721: transfer from incorrect owner");
        require(to != address(0), "ERC721: transfer to zero address");

        // Clear approval for this token
        delete _tokenApprovals[tokenId];

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    /// @notice Approve another address to transfer a specific token.
    /// @param to Address to approve
    /// @param tokenId Token to approve for
    function approve(address to, uint256 tokenId) external {
        address tokenOwner = _owners[tokenId];
        require(msg.sender == tokenOwner || _operatorApprovals[tokenOwner][msg.sender],
            "ERC721: not authorized to approve");
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    /// @notice Set or revoke approval for an operator to manage all your tokens.
    /// @param operator Address to set approval for
    /// @param approved Whether to approve or revoke
    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "ERC721: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @notice Get the owner of a specific token.
    /// @param tokenId Token to query
    /// @return The owner address
    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "ERC721: nonexistent token");
        return tokenOwner;
    }

    /// @notice Get the token balance of an address.
    /// @param account Address to query
    /// @return The number of tokens owned
    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "ERC721: zero address query");
        return _balances[account];
    }

    /// @notice Get the approved address for a specific token.
    /// @param tokenId Token to query
    /// @return The approved address (or zero if none)
    function getApproved(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "ERC721: nonexistent token");
        return _tokenApprovals[tokenId];
    }

    /// @dev Check if an address is the owner or approved for a token.
    function _isApprovedOrOwner(address spender, uint256 tokenId) private view returns (bool) {
        address tokenOwner = _owners[tokenId];
        return (spender == tokenOwner ||
                _tokenApprovals[tokenId] == spender ||
                _operatorApprovals[tokenOwner][spender]);
    }
}
