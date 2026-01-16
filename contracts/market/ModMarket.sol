// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../shared/ReentrancyGuard.sol";
import "../library/ITotemTypes.sol";
import "../shared/Shared.sol";
import "../totems/Errors.sol";
import {IMod} from "../interfaces/TotemMod.sol";

/**
 * @title ModMarket
 * @author Totems
 * @notice On-chain marketplace for publishing and discovering Totems mods
 * @dev Mods are smart contracts that extend totem functionality through hooks.
 *      Developers deploy a mod contract, then publish it here with metadata.
 *      The marketplace handles:
 *      - Publishing with validation (name, summary, hooks, etc.)
 *      - Fee collection with referrer support and burn mechanism
 *      - Mod discovery via pagination and batch queries
 *      - Required actions that must be called after totem creation
 */
contract ModMarket is ReentrancyGuard {

    // ==================== STATE VARIABLES ====================

    /// @notice Referrer fee amounts by address (must be >= minBaseFee)
    mapping(address => uint256) internal fees;

    /// @notice Published mod data by contract address
    mapping(address => ITotemTypes.Mod) internal mods;

    /// @notice Required setup actions for each mod (called after totem creation)
    mapping(address => ITotemTypes.ModRequiredAction[]) internal modRequiredActions;

    /// @notice Ordered list of all published mod addresses (for pagination)
    address[] public modList;

    /// @notice Minimum base fee for mod publishing (set once in constructor, never changed)
    uint256 public immutable minBaseFee;

    /// @notice Fee amount that is always burned (set once in constructor, never changed)
    uint256 public immutable burnedFee;

    // ==================== CONSTRUCTOR ====================

    /// @notice Deploys the market with the minimum base fee and burned fee
    /// @param _minBaseFee Minimum base fee for mod publishing
    /// @param _burnedFee Fee amount that is always burned
    constructor(uint256 _minBaseFee, uint256 _burnedFee) {
        require(_minBaseFee > 0, "Invalid min base fee");
        require(_burnedFee <= _minBaseFee, "Burned fee cannot exceed min base fee");
        minBaseFee = _minBaseFee;
        burnedFee = _burnedFee;
    }

    // ==================== EVENTS ====================

    /// @notice Emitted when a new mod is published to the marketplace
    /// @param mod The address of the published mod contract
    event ModPublished(address indexed mod);

    /// @notice Emitted when a mod's details, price, or required actions are updated
    /// @param mod The address of the updated mod contract
    event ModUpdated(address indexed mod);

    // ==================== ERRORS ====================

    /// @notice Caller is not authorized (not the mod seller)
    error Unauthorized();

    /// @notice Mod contract has already been published
    error ModAlreadyPublished(address mod);

    /// @notice Mod contract not found in marketplace
    error ModNotFound(address mod);

    /// @notice Hook identifier is not valid
    error InvalidHook(ITotemTypes.Hook hook);

    /// @notice Mod name cannot be empty
    error EmptyModName();

    /// @notice Mod summary cannot be empty
    error EmptyModSummary();

    /// @notice Mod name exceeds 100 character limit
    error ModNameTooLong(uint256 length);

    /// @notice Mod name is shorter than 3 characters
    error ModNameTooShort(uint256 length);

    /// @notice Mod summary exceeds 150 character limit
    error ModSummaryTooLong(uint256 length);

    /// @notice Mod summary is shorter than 10 characters
    error ModSummaryTooShort(uint256 length);

    /// @notice Mod image URL cannot be empty
    error EmptyModImage();

    /// @notice At least one hook must be specified
    error NoHooksSpecified();

    /// @notice Mod address is zero or not a contract
    error InvalidContractAddress();

    /// @notice Same hook specified multiple times
    error DuplicateHook(ITotemTypes.Hook hook);

    /// @notice Payment is less than required fee
    error InsufficientFee(uint256 required, uint256 provided);

    // ==================== EXTERNAL FUNCTIONS ====================

    /**
     * @notice Set your referrer fee for mod publishing
     * @dev Referrers earn fees when users publish mods using their address.
     *      Fee must be at least minBaseFee. The referrer receives (fee - burnedFee).
     * @param fee The fee amount in wei (must be >= minBaseFee)
     */
    function setReferrerFee(uint256 fee) external {
        if(fee < minBaseFee){
            revert Errors.ReferrerFeeTooLow(minBaseFee);
        }
        fees[msg.sender] = fee;
    }

    /**
     * @notice Get the fee for creating a totem or publishing a mod
     * @param referrer The referrer address (or zero address for no referrer)
     * @return The total fee required (at least minBaseFee)
     */
    function getFee(address referrer) external view returns (uint256) {
        if (referrer == address(0)) {
            return minBaseFee;
        }
        uint256 referrerFee = fees[referrer];
        return referrerFee > minBaseFee ? referrerFee : minBaseFee;
    }

    /**
     * @notice Publish a mod to the marketplace
     * @dev Only the mod's seller (returned by mod.getSeller()) can publish.
     *      Validates: contract exists, not already published, name 3-100 chars,
     *      summary 10-150 chars, image URL present, valid hooks with no duplicates.
     *      Excess payment is refunded to sender.
     * @param mod Deployed mod contract address
     * @param hooks Array of supported hook identifiers (Created, Mint, Burn, Transfer, TransferOwnership)
     * @param price Price in wei to use this mod (paid when totem creator adds the mod)
     * @param details Mod display details (name, summary, image, website, etc.)
     * @param requiredActions Setup actions users must call after totem creation
     * @param referrer Optional referrer address (receives fee minus burned amount)
     */
    function publish(
        address mod,
        ITotemTypes.Hook[] calldata hooks,
        uint256 price,
        ITotemTypes.ModDetails calldata details,
        ITotemTypes.ModRequiredAction[] calldata requiredActions,
        address payable referrer
    ) external payable nonReentrant {
        if (mod == address(0)) revert InvalidContractAddress();
        if (mod.code.length == 0) revert InvalidContractAddress();
        if (mods[mod].mod != address(0)) {
            revert ModAlreadyPublished(mod);
        }

        IMod modContract = IMod(mod);
        address payable seller = modContract.getSeller();
        if (seller != msg.sender) {
            revert Unauthorized();
        }

        _validateModDetails(details);
        if (hooks.length == 0) revert NoHooksSpecified();

        for (uint256 i = 0; i < hooks.length; i++) {
            if (!_isValidHook(hooks[i])) {
                revert InvalidHook(hooks[i]);
            }
            for (uint256 j = i + 1; j < hooks.length; j++) {
                if (hooks[i] == hooks[j]) {
                    revert DuplicateHook(hooks[i]);
                }
            }
        }

        // Process fees and validate payment
        uint256 totalFee = _processPublishFees(referrer);

        // Store mod
        ITotemTypes.Mod storage modData = mods[mod];
        modData.mod = mod;
        modData.seller = seller;
        modData.price = price;
        modData.details = details;
        modData.hooks = hooks;
        modData.publishedAt = uint64(block.timestamp);
        modData.updatedAt = uint64(block.timestamp);

        // Store required actions separately
        for (uint256 i = 0; i < requiredActions.length; i++) {
            modRequiredActions[mod].push(requiredActions[i]);
        }

        modList.push(mod);

        // Refund excess payment
        if (msg.value > totalFee) {
            Shared.safeTransfer(msg.sender, msg.value - totalFee);
        }

        emit ModPublished(mod);
    }

    /**
     * @notice Process publish fees - validates payment and distributes funds
     * @dev Fee distribution:
     *      - No referrer: entire fee is burned (sent to address(0))
     *      - With referrer: burnedFee is burned, referrer gets (totalFee - burnedFee)
     *      The totalFee is max(referrer's fee, minBaseFee).
     * @param referrer Optional referrer address (zero address = no referrer)
     * @return totalFee The total fee charged
     */
    function _processPublishFees(address payable referrer) internal returns (uint256 totalFee) {
        uint256 referrerFee = referrer != address(0) ? fees[referrer] : 0;
        totalFee = referrerFee > minBaseFee ? referrerFee : minBaseFee;

        if (msg.value < totalFee) {
            revert InsufficientFee(totalFee, msg.value);
        }

        if (referrer == address(0)) {
            // No referrer - burn the entire fee
            Shared.safeTransfer(address(0), totalFee);
        } else {
            // burnedFee is always burned
            if (burnedFee > 0) {
                Shared.safeTransfer(address(0), burnedFee);
            }
            // Referrer gets the difference between totalFee and burnedFee
            uint256 referrerAmount = totalFee - burnedFee;
            if (referrerAmount > 0) {
                Shared.safeTransfer(referrer, referrerAmount);
            }
        }
    }

    /**
     * @notice Update mod price and details
     * @param mod Mod contract address
     * @param newPrice New price in wei
     * @param details New mod details
     */
    function update(
        address mod,
        uint256 newPrice,
        ITotemTypes.ModDetails calldata details
    ) external nonReentrant {
        ITotemTypes.Mod storage modData = mods[mod];

        if (modData.mod == address(0)) revert ModNotFound(mod);
        if (msg.sender != modData.seller) revert Unauthorized();

        _validateModDetails(details);

        modData.price = newPrice;
        modData.details = details;
        modData.updatedAt = uint64(block.timestamp);

        emit ModUpdated(mod);
    }

    /**
     * @notice Update required actions for a mod
     * @param mod Mod contract address
     * @param requiredActions New required setup actions
     */
    function updateRequiredActions(
        address mod,
        ITotemTypes.ModRequiredAction[] calldata requiredActions
    ) external {
        ITotemTypes.Mod storage modData = mods[mod];

        if (modData.mod == address(0)) revert ModNotFound(mod);
        if (msg.sender != modData.seller) revert Unauthorized();

        // Clear existing required actions
        delete modRequiredActions[mod];

        // Store new required actions
        for (uint256 i = 0; i < requiredActions.length; i++) {
            modRequiredActions[mod].push(requiredActions[i]);
        }

        modData.updatedAt = uint64(block.timestamp);

        emit ModUpdated(mod);
    }

    /**
     * @notice Get multiple mods by their addresses
     * @param contracts Array of mod contract addresses
     * @return Array of Mod structs
     */
    function getMods(address[] calldata contracts) external view returns (ITotemTypes.Mod[] memory) {
        // Count valid mods first
        uint256 validCount = 0;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (mods[contracts[i]].mod != address(0)) {
                validCount++;
            }
        }

        // Create result array with correct size
        ITotemTypes.Mod[] memory result = new ITotemTypes.Mod[](validCount);
        uint256 resultIndex = 0;

        for (uint256 i = 0; i < contracts.length; i++) {
            if (mods[contracts[i]].mod != address(0)) {
                result[resultIndex] = mods[contracts[i]];
                resultIndex++;
            }
        }

        return result;
    }

    /**
     * @notice List mods with pagination
     * @param perPage Number of results per page
     * @param cursor Index to start from (for pagination)
     * @return mods_ Array of Mod structs
     * @return nextCursor Next cursor value
     * @return hasMore Whether more results exist
     */
    function listMods(
        uint32 perPage,
        uint256 cursor
    ) external view returns (
        ITotemTypes.Mod[] memory mods_,
        uint256 nextCursor,
        bool hasMore
    ) {
        uint256 startIndex = cursor;
        uint256 endIndex = startIndex + perPage;

        if (endIndex > modList.length) {
            endIndex = modList.length;
        }

        uint256 resultCount = endIndex - startIndex;
        mods_ = new ITotemTypes.Mod[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            mods_[i] = mods[modList[startIndex + i]];
        }

        nextCursor = endIndex;
        hasMore = endIndex < modList.length;

        return (mods_, nextCursor, hasMore);
    }

    /**
     * @notice Get a single mod by address
     * @param mod Mod contract address
     * @return Mod struct
     */
    function getMod(address mod) external view returns (ITotemTypes.Mod memory) {
        if (mods[mod].mod == address(0)) {
            revert ModNotFound(mod);
        }
        return mods[mod];
    }

    /**
     * @notice Get required actions for a mod (setup actions called after totem creation)
     * @param mod Mod contract address
     * @return Array of required actions
     */
    function getModRequiredActions(address mod) external view returns (ITotemTypes.ModRequiredAction[] memory) {
        if (mods[mod].mod == address(0)) {
            revert ModNotFound(mod);
        }
        return modRequiredActions[mod];
    }

    /**
     * @notice Get the usage price for a single mod
     * @param mod Mod contract address
     * @return The price in wei to use this mod
     */
    function getModFee(address mod) external view returns (uint256) {
        if (mods[mod].mod == address(0)) {
            revert ModNotFound(mod);
        }
        return mods[mod].price;
    }

    /**
     * @notice Get the total usage price for multiple mods
     * @dev Useful for calculating total cost when creating a totem with multiple mods
     * @param contracts Array of mod contract addresses
     * @return Total price in wei for all mods combined
     */
    function getModsFee(address[] calldata contracts) external view returns (uint256) {
        uint256 fee = 0;
        for (uint256 i = 0; i < contracts.length; i++) {
            if (mods[contracts[i]].mod == address(0)) {
                revert ModNotFound(contracts[i]);
            }
            fee += mods[contracts[i]].price;
        }
        return fee;
    }

    /**
     * @notice Get the hooks supported by a mod
     * @dev Hooks determine when the mod is called (Created, Mint, Burn, Transfer, TransferOwnership)
     * @param mod Mod contract address
     * @return Array of Hook enum values
     */
    function getSupportedHooks(address mod) external view returns (ITotemTypes.Hook[] memory) {
        if (mods[mod].mod == address(0)) {
            revert ModNotFound(mod);
        }
        return mods[mod].hooks;
    }

    /**
     * @notice Check if a mod requires unlimited minting capability
     * @dev Mods with needsUnlimited=true can mint tokens without supply cap restrictions.
     *      Returns false for unpublished mods.
     * @param mod Mod contract address
     * @return True if the mod needs unlimited minting capability
     */
    function isUnlimitedMinter(address mod) external view returns (bool) {
        if(mods[mod].publishedAt == 0) return false;
        return mods[mod].details.needsUnlimited;
    }

    /**
     * @notice Validate mod details (name, summary, image)
     * @dev Reverts if any validation fails
     * @param details The mod details to validate
     */
    function _validateModDetails(ITotemTypes.ModDetails calldata details) internal pure {
        if (bytes(details.name).length == 0) revert EmptyModName();
        if (bytes(details.name).length < 3) revert ModNameTooShort(bytes(details.name).length);
        if (bytes(details.name).length > 100) revert ModNameTooLong(bytes(details.name).length);
        if (bytes(details.summary).length == 0) revert EmptyModSummary();
        if (bytes(details.summary).length < 10) revert ModSummaryTooShort(bytes(details.summary).length);
        if (bytes(details.summary).length > 150) revert ModSummaryTooLong(bytes(details.summary).length);
        if (bytes(details.image).length == 0) revert EmptyModImage();
    }

    /**
     * @notice Check if a hook is valid
     * @param hook The hook identifier to validate
     * @return bool True if hook is valid
     */
    function _isValidHook(ITotemTypes.Hook hook) internal pure returns (bool) {
        return uint8(hook) <= uint8(ITotemTypes.Hook.TransferOwnership);
    }

}