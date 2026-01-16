// SPDX-License-Identifier: MIT
// AUTO-GENERATED - DO NOT EDIT
// Generated from ModMarket
pragma solidity ^0.8.28;

import "../library/ITotemTypes.sol";

interface IMarket {
    // ==================== FUNCTIONS ====================

    /**
     * @notice Set your referrer fee for mod publishing
     * @dev Referrers earn fees when users publish mods using their address.      Fee must be at least minBaseFee. The referrer receives (fee - burnedFee).
     * @param fee The fee amount in wei (must be >= minBaseFee)
     */
    function setReferrerFee(uint256 fee) external;

    /**
     * @notice Get the fee for creating a totem or publishing a mod
     * @param referrer The referrer address (or zero address for no referrer)
     * @return The total fee required (at least minBaseFee)
     */
    function getFee(address referrer) external view returns (uint256);

    /**
     * @notice Publish a mod to the marketplace
     * @dev Only the mod's seller (returned by mod.getSeller()) can publish.      Validates: contract exists, not already published, name 3-100 chars,      summary 10-150 chars, image URL present, valid hooks with no duplicates.      Excess payment is refunded to sender.
     * @param mod Deployed mod contract address
     * @param hooks Array of supported hook identifiers (Created, Mint, Burn, Transfer, TransferOwnership)
     * @param price Price in wei to use this mod (paid when totem creator adds the mod)
     * @param details Mod display details (name, summary, image, website, etc.)
     * @param requiredActions Setup actions users must call after totem creation
     * @param referrer Optional referrer address (receives fee minus burned amount)
     */
    function publish(address mod, ITotemTypes.Hook[] calldata hooks, uint256 price, ITotemTypes.ModDetails calldata details, ITotemTypes.ModRequiredAction[] calldata requiredActions, address payable referrer) external payable;

    /**
     * @notice Update mod price and details
     * @param mod Mod contract address
     * @param newPrice New price in wei
     * @param details New mod details
     */
    function update(address mod, uint256 newPrice, ITotemTypes.ModDetails calldata details) external;

    /**
     * @notice Update required actions for a mod
     * @param mod Mod contract address
     * @param requiredActions New required setup actions
     */
    function updateRequiredActions(address mod, ITotemTypes.ModRequiredAction[] calldata requiredActions) external;

    /**
     * @notice Get a single mod by address
     * @param mod Mod contract address
     * @return Mod struct
     */
    function getMod(address mod) external view returns (ITotemTypes.Mod memory);

    /**
     * @notice Get the usage price for a single mod
     * @param mod Mod contract address
     * @return The price in wei to use this mod
     */
    function getModFee(address mod) external view returns (uint256);

    /**
     * @notice Get required actions for a mod (setup actions called after totem creation)
     * @param mod Mod contract address
     * @return Array of required actions
     */
    function getModRequiredActions(address mod) external view returns (ITotemTypes.ModRequiredAction[] memory);

    /**
     * @notice Get multiple mods by their addresses
     * @param contracts Array of mod contract addresses
     * @return Array of Mod structs
     */
    function getMods(address[] calldata contracts) external view returns (ITotemTypes.Mod[] memory);

    /**
     * @notice Get the total usage price for multiple mods
     * @dev Useful for calculating total cost when creating a totem with multiple mods
     * @param contracts Array of mod contract addresses
     * @return Total price in wei for all mods combined
     */
    function getModsFee(address[] calldata contracts) external view returns (uint256);

    /**
     * @notice Get the hooks supported by a mod
     * @dev Hooks determine when the mod is called (Created, Mint, Burn, Transfer, TransferOwnership)
     * @param mod Mod contract address
     * @return Array of Hook enum values
     */
    function getSupportedHooks(address mod) external view returns (ITotemTypes.Hook[] memory);

    /**
     * @notice Check if a mod requires unlimited minting capability
     * @dev Mods with needsUnlimited=true can mint tokens without supply cap restrictions.      Returns false for unpublished mods.
     * @param mod Mod contract address
     * @return True if the mod needs unlimited minting capability
     */
    function isUnlimitedMinter(address mod) external view returns (bool);

    /**
     * @notice List mods with pagination
     * @param perPage Number of results per page
     * @param cursor Index to start from (for pagination)
     * @return mods_ Array of Mod structs
     * @return nextCursor Next cursor value
     * @return hasMore Whether more results exist
     */
    function listMods(uint32 perPage, uint256 cursor) external view returns (ITotemTypes.Mod[] memory mods_, uint256 nextCursor, bool hasMore);

    /**
     * @notice Ordered list of all published mod addresses (for pagination)
     */
    function modList(uint256) external view returns (address);

    /**
     * @notice Fee amount that is always burned (set once in constructor, never changed)
     */
    function burnedFee() external view returns (uint256);

    /**
     * @notice Minimum base fee for mod publishing (set once in constructor, never changed)
     */
    function minBaseFee() external view returns (uint256);

    // ==================== EVENTS ====================

    event ModPublished(address indexed mod);
    event ModUpdated(address indexed mod);

    // ==================== ERRORS ====================

    error DuplicateHook(ITotemTypes.Hook hook);
    error EmptyModImage();
    error EmptyModName();
    error EmptyModSummary();
    error InsufficientFee(uint256 required, uint256 provided);
    error InvalidContractAddress();
    error InvalidHook(ITotemTypes.Hook hook);
    error ModAlreadyPublished(address mod);
    error ModNameTooLong(uint256 length);
    error ModNameTooShort(uint256 length);
    error ModNotFound(address mod);
    error ModSummaryTooLong(uint256 length);
    error ModSummaryTooShort(uint256 length);
    error NoHooksSpecified();
    error ReferrerFeeTooLow(uint256 minFee);
    error TransferFailed();
    error Unauthorized();
}
