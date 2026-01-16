// SPDX-License-Identifier: MIT
// AUTO-GENERATED - DO NOT EDIT
// Generated from Totems
pragma solidity ^0.8.28;

import "../library/ITotemTypes.sol";

interface ITotems {
    // ==================== FUNCTIONS ====================

    /**
     * @notice Creates a new totem with the specified details, allocations, and mods
     */
    function create(ITotemTypes.TotemDetails calldata details, ITotemTypes.MintAllocation[] calldata allocations, ITotemTypes.TotemMods calldata mods, address payable referrer) external payable;

    /**
     * @notice Burns tokens from a totem, permanently reducing supply
     */
    function burn(string calldata ticker, address owner, uint256 amount, string calldata memo) external;

    /**
     * @notice Mints tokens for a totem using an authorized minter mod
     */
    function mint(address mod, address minter, string calldata ticker, uint256 amount, string calldata memo) external payable;

    /**
     * @notice Transfers tokens between addresses
     */
    function transfer(string calldata ticker, address from, address to, uint256 amount, string calldata memo) external;

    /**
     * @notice Transfers ownership of a totem to a new address
     */
    function transferOwnership(string calldata ticker, address payable newOwner) external;

    /**
     * @notice Authorizes an existing relay address for a totem
     */
    function addRelay(string calldata ticker, address relay, string calldata standard) external;

    /**
     * @notice Creates a new relay for a totem using a relay factory
     */
    function createRelay(string calldata ticker, address relayFactory, string calldata standard) external returns (address relay);

    /**
     * @notice Revokes authorization for a relay from a totem
     */
    function removeRelay(string calldata ticker, address relay) external;

    /**
     * @notice Gets the relay address for a specific standard on a totem
     */
    function getRelayOfStandard(string calldata ticker, string calldata standard) external view returns (address);

    /**
     * @notice Gets all authorized relays for a totem
     */
    function getRelays(string calldata ticker) external view returns (ITotemTypes.RelayInfo[] memory);

    /**
     * @notice Grants a mod license for a totem, callable only by the proxy mod
     */
    function setLicenseFromProxy(bytes32 tickerBytes, address mod) external;

    /**
     * @notice Checks if a mod is licensed for a specific totem
     */
    function isLicensed(string calldata ticker, address mod) external view returns (bool);

    /**
     * @notice Sets the referrer fee for the caller
     */
    function setReferrerFee(uint256 fee) external;

    /**
     * @notice Gets the fee for creating a totem
     */
    function getFee(address referrer) external view returns (uint256);

    /**
     * @notice Retrieves a totem by its ticker symbol
     */
    function getTotem(string calldata ticker) external view returns (ITotemTypes.Totem memory);

    /**
     * @notice Retrieves multiple totems by their ticker symbols
     */
    function getTotems(string[] calldata tickers) external view returns (ITotemTypes.Totem[] memory);

    /**
     * @notice Lists totems with pagination support
     */
    function listTotems(uint32 perPage, uint256 cursor) external view returns (ITotemTypes.Totem[] memory, uint256, bool);

    /**
     * @notice Gets the token balance for an account on a specific totem
     */
    function getBalance(string calldata ticker, address account) external view returns (uint256);

    /**
     * @notice Gets the statistics for a totem
     */
    function getStats(string calldata ticker) external view returns (ITotemTypes.TotemStats memory);

    /**
     * @notice Gets the proxy mod address
     */
    function getProxyMod() external view returns (address);

    /**
     * @notice Converts a ticker string to its normalized bytes32 representation
     */
    function tickerToBytes(string calldata ticker) external pure returns (bytes32);

    /**
     * @notice Fee amount that is always burned (set once in constructor, never changed)
     */
    function burnedFee() external view returns (uint256);

    /**
     * @notice Address of the mod market contract
     */
    function marketContract() external view returns (address);

    /**
     * @notice Minimum base fee for totem creation (set once in constructor, never changed)
     */
    function minBaseFee() external view returns (uint256);

    /**
     * @notice Address of the proxy mod for license delegation
     */
    function proxyMod() external view returns (address);

    /**
     * @notice Array of all totem ticker bytes for enumeration
     */
    function totemList(uint256) external view returns (bytes32);

    // ==================== EVENTS ====================

    event RelayAuthorized(string ticker, address indexed relay);
    event RelayRevoked(string ticker, address indexed relay);
    event TotemBurned(string ticker, address indexed owner, uint256 amount);
    event TotemCreated(string ticker, address indexed creator);
    event TotemMinted(string ticker, address indexed minter, address mod, uint256 minted, uint256 payment);
    event TotemOwnershipTransferred(string ticker, address indexed previousOwner, address indexed newOwner);
    event TotemTransferred(string ticker, address indexed from, address indexed to, uint256 amount);

    // ==================== ERRORS ====================

    error CannotTransferToUnlimitedMinter();
    error CantSetLicense();
    error DescriptionTooLong(uint256 length);
    error EmptyImage();
    error InsufficientBalance(uint256 required, uint256 available);
    error InsufficientFee(uint256 required, uint256 provided);
    error InvalidAllocation(string message);
    error InvalidCursor();
    error InvalidSeed();
    error InvalidTickerChar(uint8 char);
    error InvalidTickerLength(uint256 length);
    error ModDoesntSupportHook(address mod, ITotemTypes.Hook hook);
    error ModMustSupportUnlimitedMinting(address mod);
    error ModNotMinter(address mod);
    error NameTooLong(uint256 length);
    error NameTooShort(uint256 length);
    error ReferrerFeeTooLow(uint256 minFee);
    error TooManyAllocations();
    error TooManyMods();
    error TotemAlreadyExists(string ticker);
    error TotemNotActive();
    error TotemNotFound(string ticker);
    error TransferFailed();
    error Unauthorized();
    error ZeroSupply();
}
