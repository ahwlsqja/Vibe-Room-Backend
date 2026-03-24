// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonadNFTMarketplace — Parallel-Safe NFT Marketplace
/// @author Vibe Coding Template
/// @notice A simple NFT marketplace where each listing is an independent storage slot.
/// @dev **Parallel execution pattern**: Each listing is stored in `listings[listingId]`,
///      a per-ID mapping slot. Operations on different listings (buy listing #5 while
///      someone cancels listing #8) touch completely disjoint storage, enabling Monad
///      to process them in parallel.
///
///      Anti-pattern avoided: a shared `activeListings` array that would serialize
///      all list/buy/cancel operations through a single storage location.
contract MonadNFTMarketplace {
    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    /// @notice Per-listing storage — each listing ID occupies an independent slot.
    /// @dev This is the core parallel-safety feature: buying listing #1 and listing #2
    ///      can execute simultaneously because they modify disjoint storage.
    mapping(uint256 => Listing) public listings;

    /// @notice Next listing ID counter
    uint256 private _nextListingId;

    /// @notice Accumulated fees for the marketplace owner
    uint256 public accumulatedFees;

    /// @notice Marketplace fee in basis points (e.g., 250 = 2.5%)
    uint256 public immutable feeBps;

    /// @notice Marketplace owner who receives fees
    address public immutable owner;

    event Listed(uint256 indexed listingId, address indexed seller, address nftContract, uint256 tokenId, uint256 price);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 price);
    event Cancelled(uint256 indexed listingId);
    event FeesWithdrawn(address indexed to, uint256 amount);

    /// @param _feeBps Marketplace fee in basis points (max 1000 = 10%)
    constructor(uint256 _feeBps) {
        require(_feeBps <= 1000, "Marketplace: fee too high");
        feeBps = _feeBps;
        owner = msg.sender;
        _nextListingId = 1;
    }

    /// @notice List an NFT for sale on the marketplace.
    /// @dev Creates a new listing in an independent storage slot.
    ///      Multiple users listing simultaneously touch different listingId slots.
    /// @param nftContract Address of the NFT contract
    /// @param tokenId Token ID to list
    /// @param price Sale price in wei
    /// @return listingId The ID of the new listing
    function list(address nftContract, uint256 tokenId, uint256 price) external returns (uint256 listingId) {
        require(nftContract != address(0), "Marketplace: zero address");
        require(price > 0, "Marketplace: zero price");

        listingId = _nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: price,
            active: true
        });

        emit Listed(listingId, msg.sender, nftContract, tokenId, price);
    }

    /// @notice Buy a listed NFT by sending the exact price in ETH.
    /// @dev Only modifies `listings[listingId]` — parallel-safe across different listings.
    ///      Buyer sends ETH, seller receives payment minus fee, marketplace accumulates fee.
    /// @param listingId ID of the listing to purchase
    function buy(uint256 listingId) external payable {
        Listing storage item = listings[listingId];
        require(item.active, "Marketplace: not active");
        require(msg.value == item.price, "Marketplace: incorrect price");
        require(msg.sender != item.seller, "Marketplace: seller cannot buy");

        item.active = false;

        uint256 fee = (item.price * feeBps) / 10000;
        uint256 sellerProceeds = item.price - fee;
        accumulatedFees += fee;

        (bool success, ) = item.seller.call{value: sellerProceeds}("");
        require(success, "Marketplace: payment failed");

        emit Sold(listingId, msg.sender, item.price);
    }

    /// @notice Cancel your own listing.
    /// @dev Only modifies `listings[listingId]` — parallel-safe.
    /// @param listingId ID of the listing to cancel
    function cancel(uint256 listingId) external {
        Listing storage item = listings[listingId];
        require(item.active, "Marketplace: not active");
        require(msg.sender == item.seller, "Marketplace: not seller");

        item.active = false;
        emit Cancelled(listingId);
    }

    /// @notice Withdraw accumulated marketplace fees (owner only).
    function withdrawFees() external {
        require(msg.sender == owner, "Marketplace: not owner");
        uint256 amount = accumulatedFees;
        require(amount > 0, "Marketplace: no fees");

        accumulatedFees = 0;
        (bool success, ) = owner.call{value: amount}("");
        require(success, "Marketplace: withdrawal failed");

        emit FeesWithdrawn(owner, amount);
    }

    /// @notice Get listing details.
    /// @param listingId ID of the listing
    /// @return seller The seller address
    /// @return nftContract The NFT contract address
    /// @return tokenId The token ID
    /// @return price The listing price
    /// @return active Whether the listing is still active
    function getListing(uint256 listingId) external view returns (
        address seller, address nftContract, uint256 tokenId, uint256 price, bool active
    ) {
        Listing storage item = listings[listingId];
        return (item.seller, item.nftContract, item.tokenId, item.price, item.active);
    }
}
