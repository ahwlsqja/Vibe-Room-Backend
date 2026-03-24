// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonadMultisig — Multi-Signature Wallet
/// @author Vibe Coding Template
/// @notice A multi-signature wallet requiring M-of-N confirmations to execute transactions.
/// @dev Per-proposal storage pattern: each proposal is stored in `proposals[proposalId]`,
///      and confirmations are tracked in `confirmations[proposalId][signer]`. Operations
///      on different proposals touch independent storage slots, enabling parallel confirmation
///      processing on Monad.
contract MonadMultisig {
    struct Proposal {
        address to;
        uint256 value;
        bytes data;
        uint256 confirmCount;
        bool executed;
    }

    /// @notice List of authorized signers
    address[] public signers;

    /// @notice Quick lookup for signer status
    mapping(address => bool) public isSigner;

    /// @notice Number of confirmations required to execute
    uint256 public immutable requiredConfirmations;

    /// @notice Per-proposal storage — independent slots per proposal ID.
    mapping(uint256 => Proposal) public proposals;

    /// @notice Per-proposal, per-signer confirmation — independent slots.
    /// @dev `confirmations[proposalA][signerX]` and `confirmations[proposalB][signerY]`
    ///      are disjoint storage slots, enabling parallel confirmations on different proposals.
    mapping(uint256 => mapping(address => bool)) public confirmations;

    /// @notice Next proposal ID
    uint256 private _nextProposalId;

    event ProposalCreated(uint256 indexed proposalId, address indexed to, uint256 value);
    event Confirmed(uint256 indexed proposalId, address indexed signer);
    event Executed(uint256 indexed proposalId);
    event Received(address indexed sender, uint256 amount);

    modifier onlySigner() {
        require(isSigner[msg.sender], "Multisig: not a signer");
        _;
    }

    /// @param _signers Array of authorized signer addresses
    /// @param _requiredConfirmations Number of confirmations needed to execute
    constructor(address[] memory _signers, uint256 _requiredConfirmations) {
        require(_signers.length >= 2, "Multisig: need at least 2 signers");
        require(_requiredConfirmations >= 1 && _requiredConfirmations <= _signers.length,
            "Multisig: invalid confirmation count");

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "Multisig: zero address");
            require(!isSigner[signer], "Multisig: duplicate signer");
            isSigner[signer] = true;
            signers.push(signer);
        }
        requiredConfirmations = _requiredConfirmations;
    }

    /// @notice Propose a new transaction for multi-sig approval.
    /// @param to Target address
    /// @param value ETH value to send
    /// @param data Calldata for the transaction
    /// @return proposalId The ID of the new proposal
    function propose(address to, uint256 value, bytes calldata data) external onlySigner returns (uint256 proposalId) {
        proposalId = _nextProposalId++;
        proposals[proposalId] = Proposal({
            to: to,
            value: value,
            data: data,
            confirmCount: 0,
            executed: false
        });

        emit ProposalCreated(proposalId, to, value);
    }

    /// @notice Confirm a pending proposal.
    /// @dev Only modifies `confirmations[proposalId][msg.sender]` and `proposals[proposalId]`.
    ///      Confirmations on different proposals can execute in parallel.
    /// @param proposalId ID of the proposal to confirm
    function confirm(uint256 proposalId) external onlySigner {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Multisig: already executed");
        require(!confirmations[proposalId][msg.sender], "Multisig: already confirmed");

        confirmations[proposalId][msg.sender] = true;
        proposal.confirmCount += 1;

        emit Confirmed(proposalId, msg.sender);
    }

    /// @notice Execute a fully confirmed proposal.
    /// @param proposalId ID of the proposal to execute
    function execute(uint256 proposalId) external onlySigner {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Multisig: already executed");
        require(proposal.confirmCount >= requiredConfirmations, "Multisig: not enough confirmations");

        proposal.executed = true;

        (bool success, ) = proposal.to.call{value: proposal.value}(proposal.data);
        require(success, "Multisig: execution failed");

        emit Executed(proposalId);
    }

    /// @notice Get the number of signers.
    /// @return The signer count
    function getSignerCount() external view returns (uint256) {
        return signers.length;
    }

    /// @notice Accept ETH deposits to the multisig wallet.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
