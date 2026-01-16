// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ITotemTypes
 * @notice Interface and types for the Totems ecosystem
 * @dev This library provides core types and structures for Totems and Mods
 */
interface ITotemTypes {

    struct RelayInfo {
        address relay;
        string standard;
    }

    /// @notice Valid hook identifiers
    enum Hook {
        Created,
        Mint,
        Burn,
        Transfer,
        TransferOwnership
    }

    /**
     * @notice Display details for a mod
     * @param name Mod name
     * @param summary Short description
     * @param markdown Detailed markdown description
     * @param image Image URL or IPFS hash
     * @param website Website URL
     * @param websiteTickerPath Path template for token-specific pages
     * @param isMinter Whether this mod is a token minter
     */
    struct ModDetails {
        string name;
        string summary;
        string markdown;
        string image;
        string website;
        string websiteTickerPath;
        bool isMinter;
        bool needsUnlimited;
    }

    // Input mode for mod action fields
    enum ModActionFieldInputMode {
        // Request input from the user
        DYNAMIC,
        // Predefined static value
        STATIC,
        // Auto-fill with the current totem ticker
        TOTEM
    }

    struct ModActionField {
        // ex: "totem, mintPerMine"
        string name;
        ModActionFieldInputMode mode;
        // only used for STATIC mode
        string value;
        // Human-readable description of this field for UIs (optional)
        string description;
        // Minimum value constraint for numeric inputs (0 = no minimum)
        uint256 min;
        // Maximum value constraint for numeric inputs (0 = no maximum)
        uint256 max;
        // Is this field expecting to receive totem amounts?
        bool isTotems;
    }

    struct ModRequiredAction {
        // ex: "setup(string totem, uint256 mintPerMine)"
        // (only the ~canonical function signature, no "function" keyword, modifiers, or mutability)
        // Also no return types!
        string signature;
        ModActionField[] inputFields;
        // Is there a msg.value required to perform this action?
        // If > 0 this will make the function payable
        uint256 cost;
        // Explain to users why this action is required for UIs
        string reason;
    }

    /**
     * @notice On-chain Mod entry in the marketplace
     * @param mod The deployed mod contract address
     * @param seller Address that receives payments for this mod
     * @param price Price in wei to use this mod
     * @param details Display details
     * @param hooks Array of supported hook names
     * @param publishedAt Timestamp of publication
     * @param updatedAt Timestamp of last update
     */
    struct Mod {
        address mod;
        address payable seller;
        uint64 publishedAt;
        uint64 updatedAt;
        uint256 price;
        Hook[] hooks;
        ModDetails details;
    }

    /**
     * @notice Allocation of tokens at creation time
     * @param label Human-readable label
     * @param recipient Address to receive tokens
     * @param amount Amount of tokens
     * @param isMinter Whether this recipient is a minter mod
     */
    struct MintAllocation {
        address payable recipient;
        bool isMinter;
        uint256 amount;
        string label;
    }

    /**
     * @notice Display details for a totem
     * @param name Totem name
     * @param description Detailed description
     * @param image Image URL or IPFS hash
     * @param website Website URL
     * @param seed Generative seed for totem properties
     */
    struct TotemDetails {
        bytes32 seed;
        uint8 decimals;
        string ticker;
        string name;
        string description;
        string image;
        string website;
    }

    /**
     * @notice Mods assigned to each hook type
     * @param transfer Mods for transfer hook
     * @param mint Mods for mint hook
     * @param burn Mods for burn hook
     * @param created Mods for created hook
     * @param transferOwnership Mods for transfer ownership hook
     */
    struct TotemMods {
        address[] transfer;
        address[] mint;
        address[] burn;
        address[] created;
        address[] transferOwnership;
    }

    /**
     * @notice Complete totem information
     * @param creator Address that created the totem
     * @param supply Current circulating supply
     * @param maxSupply Maximum possible supply
     * @param allocations Initial token allocations
     * @param mods Mods for each hook type
     * @param details Display information
     * @param createdAt Creation timestamp
     * @param updatedAt Last update timestamp
     */
    struct Totem {
        address payable creator;
        uint64 createdAt;
        uint64 updatedAt;
        bool isActive;
        uint256 supply;
        uint256 maxSupply;
        MintAllocation[] allocations;
        TotemMods mods;
        TotemDetails details;
    }

    /**
     * @notice Statistics for a totem
     * @param ticker Token symbol
     * @param mints Total number of mint operations
     * @param burns Total number of burn operations
     * @param transfers Total number of transfers
     * @param holders Total number of unique holders
     */
    struct TotemStats {
        uint64 mints;
        uint64 burns;
        uint64 transfers;
        uint64 holders;
    }

    /**
     * @notice Fee disbursement information
     * @param recipient Address to receive funds
     * @param amount Amount in wei
     */
    struct FeeDisbursement {
        address payable recipient;
        uint256 amount;
    }
}