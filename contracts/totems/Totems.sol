// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/IMarket.sol";
import "../interfaces/TotemMod.sol";
import "../interfaces/IRelayFactory.sol";
import "../library/ITotemTypes.sol";
import "../library/TotemsLibrary.sol";
import "../shared/Shared.sol";
import "../shared/ReentrancyGuard.sol";
import "./Errors.sol";

/**
 * @title Totems
 * @notice Consolidated contract for totem creation, operations, and views
 * @dev Combines TotemsCore, TotemsOperations, and TotemsView into a single contract
 */
contract Totems is ReentrancyGuard {
    // ==================== STATE VARIABLES ====================

    /// @notice Mapping of referrer addresses to their fee amounts
    mapping(address => uint256) internal fees;

    /// @notice Mapping of totem ticker to mod address to license status
    mapping(bytes32 => mapping(address => bool)) internal licenses;

    /// @notice Mapping of normalized ticker bytes to totem data
    mapping(bytes32 => ITotemTypes.Totem) internal totems;

    /// @notice Mapping of normalized ticker bytes to totem statistics
    mapping(bytes32 => ITotemTypes.TotemStats) internal stats;

    /// @notice Mapping of totem ticker to account address to token balance
    mapping(bytes32 => mapping(address => uint256)) internal balances;

    /// @notice Array of all totem ticker bytes for enumeration
    bytes32[] public totemList;

    /// @notice Address of the mod market contract
    address public marketContract;

    /// @notice Mapping of totem ticker to relay address to authorization status
    mapping(bytes32 => mapping(address => bool)) internal authorizedRelays;

    /// @notice Mapping of totem ticker to array of authorized relay info
    mapping(bytes32 => ITotemTypes.RelayInfo[]) internal authorizedRelaysList;

    /// @dev Nonce used for tracking unique mods during creation
    uint256 internal modNonce;

    /// @dev Mapping to track which mods have been seen at a given nonce
    mapping(address => uint256) internal seenModAt;

    /// @notice Address of the proxy mod for license delegation
    address public proxyMod;

    /// @notice Minimum base fee for totem creation (set once in constructor, never changed)
    uint256 public minBaseFee;

    /// @notice Fee amount that is always burned (set once in constructor, never changed)
    uint256 public burnedFee;

    // ==================== EVENTS ====================

    /// @notice Emitted when a new totem is created
    event TotemCreated(string ticker, address indexed creator);

    /// @notice Emitted when a relay is authorized for a totem
    event RelayAuthorized(string ticker, address indexed relay);

    /// @notice Emitted when a relay authorization is revoked
    event RelayRevoked(string ticker, address indexed relay);

    /// @notice Emitted when tokens are minted for a totem
    event TotemMinted(
        string ticker,
        address indexed minter,
        address mod,
        uint256 minted,
        uint256 payment
    );

    /// @notice Emitted when tokens are burned from a totem
    event TotemBurned(
        string ticker,
        address indexed owner,
        uint256 amount
    );

    /// @notice Emitted when tokens are transferred between addresses
    event TotemTransferred(
        string ticker,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    /// @notice Emitted when ownership of a totem is transferred
    event TotemOwnershipTransferred(
        string ticker,
        address indexed previousOwner,
        address indexed newOwner
    );

    // ==================== CONSTRUCTOR ====================

    constructor(
        address _marketContract,
        address _proxyMod,
        uint256 _minBaseFee,
        uint256 _burnedFee
    ) {
        require(_marketContract != address(0), "Invalid marketContract");
        require(_proxyMod != address(0), "Invalid proxyMod");

        marketContract = _marketContract;
        proxyMod = _proxyMod;
        minBaseFee = _minBaseFee;
        burnedFee = _burnedFee;
    }

    // ==================== CORE FUNCTIONS ====================

    /// @notice Creates a new totem with the specified details, allocations, and mods
    function create(
        ITotemTypes.TotemDetails calldata details,
        ITotemTypes.MintAllocation[] calldata allocations,
        ITotemTypes.TotemMods calldata mods,
        address payable referrer
    ) external payable nonReentrant {
        IMarket market = IMarket(marketContract);
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(details.ticker);

        // Validate inputs
        _validateCreationInputs(details, allocations, mods, tickerBytes);

        // Initialize totem
        ITotemTypes.Totem storage totem = totems[tickerBytes];
        totem.creator = payable(msg.sender);
        totem.mods = mods;
        totem.details = details;
        totem.createdAt = uint64(block.timestamp);
        totem.updatedAt = uint64(block.timestamp);
        totem.isActive = false;

        // Initialize stats
        stats[tickerBytes] = ITotemTypes.TotemStats({
            mints: 0,
            burns: 0,
            transfers: 0,
            holders: 0
        });

        // Validate mods
        _validateModsForHook(market, mods.transfer, ITotemTypes.Hook.Transfer);
        _validateModsForHook(market, mods.mint, ITotemTypes.Hook.Mint);
        _validateModsForHook(market, mods.burn, ITotemTypes.Hook.Burn);
        _validateModsForHook(market, mods.created, ITotemTypes.Hook.Created);
        _validateModsForHook(market, mods.transferOwnership, ITotemTypes.Hook.TransferOwnership);

        (ITotemTypes.FeeDisbursement[] memory disbursements, uint256 totalFee) =
            _processFeesAndMods(market, tickerBytes, mods, referrer);

        if (msg.value < totalFee) {
            revert Errors.InsufficientFee(totalFee, msg.value);
        }

        // Process allocations
        (uint256 maxSupply, bool hasUnlimitedMinters) = _processAllocations(
            market,
            tickerBytes,
            allocations,
            totem
        );

        if (maxSupply == 0 && !hasUnlimitedMinters) {
            revert Errors.ZeroSupply();
        }

        // Finalize totem
        totem.supply = maxSupply;
        totem.maxSupply = maxSupply;
        totemList.push(tickerBytes);

        // Distribute fees
        Shared.dispenseTokens(disbursements);

        emit TotemCreated(details.ticker, msg.sender);

        _notifyCreatedHooks(details.ticker, msg.sender, mods.created);

        if (msg.value > totalFee) {
            Shared.safeTransfer(msg.sender, msg.value - totalFee);
        }

        totems[tickerBytes].isActive = true;
    }

    /// @notice Sets the referrer fee for the caller
    function setReferrerFee(uint256 fee) external {
        if (fee < minBaseFee) {
            revert Errors.ReferrerFeeTooLow(minBaseFee);
        }
        fees[msg.sender] = fee;
    }

    /// @notice Creates a new relay for a totem using a relay factory
    function createRelay(string calldata ticker, address relayFactory, string calldata standard) external returns (address relay) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (totems[tickerBytes].creator != msg.sender) revert Errors.Unauthorized();

        IRelayFactory factory = IRelayFactory(relayFactory);
        relay = factory.createRelay(ticker);

        authorizedRelays[tickerBytes][relay] = true;
        authorizedRelaysList[tickerBytes].push(
            ITotemTypes.RelayInfo({
                standard: standard,
                relay: relay
            })
        );
        emit RelayAuthorized(ticker, relay);
    }

    /// @notice Authorizes an existing relay address for a totem
    function addRelay(string calldata ticker, address relay, string calldata standard) external {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (totems[tickerBytes].creator != msg.sender) revert Errors.Unauthorized();
        authorizedRelays[tickerBytes][relay] = true;
        authorizedRelaysList[tickerBytes].push(
            ITotemTypes.RelayInfo({
                standard: standard,
                relay: relay
            })
        );
        emit RelayAuthorized(ticker, relay);
    }

    /// @notice Revokes authorization for a relay from a totem
    function removeRelay(string calldata ticker, address relay) external {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (totems[tickerBytes].creator != msg.sender) revert Errors.Unauthorized();
        authorizedRelays[tickerBytes][relay] = false;

        ITotemTypes.RelayInfo[] storage relays = authorizedRelaysList[tickerBytes];
        uint256 length = relays.length;
        for (uint256 i = 0; i < length; i++) {
            if (relays[i].relay == relay) {
                relays[i] = relays[length - 1];
                relays.pop();
                break;
            }
        }

        emit RelayRevoked(ticker, relay);
    }

    /// @notice Grants a mod license for a totem, callable only by the proxy mod
    function setLicenseFromProxy(bytes32 tickerBytes, address mod) external {
        if (msg.sender != proxyMod) {
            revert Errors.Unauthorized();
        }
        if (totems[tickerBytes].creator == address(0)) {
            revert Errors.CantSetLicense();
        }

        _storeLicense(tickerBytes, mod);
    }

    // ==================== OPERATIONS FUNCTIONS ====================

    /// @notice Mints tokens for a totem using an authorized minter mod
    function mint(
        address mod,
        address minter,
        string calldata ticker,
        uint256 amount,
        string calldata memo
    ) external payable {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (minter != msg.sender && !authorizedRelays[tickerBytes][msg.sender]) {
            revert Errors.Unauthorized();
        }

        if (totems[tickerBytes].creator == address(0)) {
            revert Errors.TotemNotFound(ticker);
        }
        if (!totems[tickerBytes].isActive) {
            revert Errors.TotemNotActive();
        }

        // Verify mod is authorized minter
        bool isMinter = false;
        for (uint256 i = 0; i < totems[tickerBytes].allocations.length; i++) {
            if (totems[tickerBytes].allocations[i].recipient == mod && totems[tickerBytes].allocations[i].isMinter) {
                isMinter = true;
                break;
            }
        }
        if (!isMinter) revert Errors.ModNotMinter(mod);

        // Update balances and stats
        if (balances[tickerBytes][minter] == 0) {
            unchecked {
                stats[tickerBytes].holders++;
            }
        }

        unchecked {
            stats[tickerBytes].mints++;
        }

        // Track minter's balance before to measure actual minted amount
        uint256 balanceBefore = balances[tickerBytes][minter];

        IModMinter(mod).mint{value: msg.value}(ticker, minter, amount, memo);

        // Measure actual minted amount from balance delta
        uint256 minted = balances[tickerBytes][minter] - balanceBefore;

        // Notify hooks
        _notifyMintHooks(ticker, minter, amount, msg.value, memo, totems[tickerBytes].mods.mint);

        emit TotemMinted(ticker, minter, mod, minted, msg.value);
    }

    /// @notice Burns tokens from a totem, permanently reducing supply
    function burn(
        string calldata ticker,
        address owner,
        uint256 amount,
        string calldata memo
    ) external {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (owner != msg.sender && !authorizedRelays[tickerBytes][msg.sender]) {
            revert Errors.Unauthorized();
        }

        if (totems[tickerBytes].creator == address(0)) {
            revert Errors.TotemNotFound(ticker);
        }
        if (!totems[tickerBytes].isActive) {
            revert Errors.TotemNotActive();
        }

        // Burn tokens (will revert if insufficient balance)
        _subBalance(tickerBytes, owner, amount);

        // Update stats
        if (balances[tickerBytes][owner] == 0) {
            unchecked {
                stats[tickerBytes].holders--;
            }
        }
        totems[tickerBytes].supply -= amount;
        totems[tickerBytes].maxSupply -= amount;
        unchecked {
            stats[tickerBytes].burns++;
        }

        // Notify hooks
        _notifyBurnHooks(ticker, owner, amount, memo, totems[tickerBytes].mods.burn);

        emit TotemBurned(ticker, owner, amount);
    }

    /// @notice Transfers tokens between addresses
    function transfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if (from != msg.sender && !authorizedRelays[tickerBytes][msg.sender]) {
            revert Errors.Unauthorized();
        }

        IMarket market = IMarket(marketContract);
        bool fromIsUnlimited = market.isUnlimitedMinter(from);

        // Unlimited minters must always have 0 balance
        if (market.isUnlimitedMinter(to)) {
            revert Errors.CannotTransferToUnlimitedMinter();
        }

        if (totems[tickerBytes].creator == address(0)) {
            revert Errors.TotemNotFound(ticker);
        }
        if (!totems[tickerBytes].isActive) {
            revert Errors.TotemNotActive();
        }

        // Update balances
        if (!fromIsUnlimited) {
            if (from != to) {
                _subBalance(tickerBytes, from, amount);
                if (balances[tickerBytes][from] == 0) {
                    unchecked {
                        stats[tickerBytes].holders--;
                    }
                }
            }
        }

        if (from != to) {
            // Track new holder
            if (balances[tickerBytes][to] == 0) {
                unchecked {
                    stats[tickerBytes].holders++;
                }
            }
            _addBalance(tickerBytes, to, amount);
        }

        // Update supply when unlimited minter transfers (minting new tokens)
        if (fromIsUnlimited) {
            totems[tickerBytes].supply += amount;
            totems[tickerBytes].maxSupply += amount;
        }

        unchecked {
            stats[tickerBytes].transfers++;
        }

        // Notify hooks
        _notifyTransferHooks(ticker, from, to, amount, memo, totems[tickerBytes].mods.transfer);

        emit TotemTransferred(ticker, from, to, amount);
    }

    /// @notice Transfers ownership of a totem to a new address
    function transferOwnership(string calldata ticker, address payable newOwner) external {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);

        if (totems[tickerBytes].creator == address(0)) {
            revert Errors.TotemNotFound(ticker);
        }

        address previousOwner = totems[tickerBytes].creator;
        if (msg.sender != previousOwner) {
            revert Errors.Unauthorized();
        }

        require(newOwner != address(0), "New owner cannot be zero address");

        totems[tickerBytes].creator = newOwner;

        // Notify hooks
        _notifyTransferOwnershipHooks(ticker, previousOwner, newOwner, totems[tickerBytes].mods.transferOwnership);

        emit TotemOwnershipTransferred(ticker, previousOwner, newOwner);
    }

    // ==================== VIEW FUNCTIONS ====================

    /// @notice Gets the fee for creating a totem
    function getFee(address referrer) external view returns (uint256) {
        if (referrer == address(0)) {
            return minBaseFee;
        }
        uint256 referrerFee = fees[referrer];
        return referrerFee > minBaseFee ? referrerFee : minBaseFee;
    }

    /// @notice Converts a ticker string to its normalized bytes32 representation
    function tickerToBytes(string calldata ticker) external pure returns (bytes32) {
        return TotemsLibrary.tickerToBytes(ticker);
    }

    /// @notice Retrieves a totem by its ticker symbol
    function getTotem(string calldata ticker) external view returns (ITotemTypes.Totem memory) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        ITotemTypes.Totem memory totem = totems[tickerBytes];
        if (totem.creator == address(0)) {
            revert Errors.TotemNotFound(ticker);
        }
        return totem;
    }

    /// @notice Retrieves multiple totems by their ticker symbols
    function getTotems(string[] calldata tickers) external view returns (ITotemTypes.Totem[] memory) {
        ITotemTypes.Totem[] memory results = new ITotemTypes.Totem[](tickers.length);
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes32 tickerBytes = TotemsLibrary.tickerToBytes(tickers[i]);
            ITotemTypes.Totem memory totem = totems[tickerBytes];
            if (totem.creator == address(0)) {
                revert Errors.TotemNotFound(tickers[i]);
            }
            results[i] = totem;
        }
        return results;
    }

    /// @notice Gets the token balance for an account on a specific totem
    function getBalance(string calldata ticker, address account) external view returns (uint256) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        return balances[tickerBytes][account];
    }

    /// @notice Gets the statistics for a totem
    function getStats(string calldata ticker) external view returns (ITotemTypes.TotemStats memory) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        return stats[tickerBytes];
    }

    /// @notice Checks if a mod is licensed for a specific totem
    function isLicensed(string calldata ticker, address mod) external view returns (bool) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        return licenses[tickerBytes][mod];
    }

    /// @notice Gets the proxy mod address
    function getProxyMod() external view returns (address) {
        return proxyMod;
    }

    /// @notice Lists totems with pagination support
    function listTotems(
        uint32 perPage,
        uint256 cursor
    ) external view returns (ITotemTypes.Totem[] memory, uint256, bool) {
        uint256 length = totemList.length;

        if (cursor >= length) {
            revert Errors.InvalidCursor();
        }

        uint256 startIndex = cursor;
        uint256 endIndex = startIndex + perPage;

        if (endIndex > totemList.length) {
            endIndex = totemList.length;
        }

        uint256 resultCount = endIndex - startIndex;
        ITotemTypes.Totem[] memory totemResults = new ITotemTypes.Totem[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            bytes32 tickerBytes = totemList[startIndex + i];
            totemResults[i] = totems[tickerBytes];
        }

        return (totemResults, endIndex, endIndex < totemList.length);
    }

    /// @notice Gets all authorized relays for a totem
    function getRelays(string calldata ticker) external view returns (ITotemTypes.RelayInfo[] memory) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        return authorizedRelaysList[tickerBytes];
    }

    /// @notice Gets the relay address for a specific standard on a totem
    function getRelayOfStandard(string calldata ticker, string calldata standard) external view returns (address) {
        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        ITotemTypes.RelayInfo[] storage relays = authorizedRelaysList[tickerBytes];
        uint256 length = relays.length;
        for (uint256 i = 0; i < length; i++) {
            if (keccak256(bytes(relays[i].standard)) == keccak256(bytes(standard))) {
                return relays[i].relay;
            }
        }
        return address(0);
    }

    // ==================== INTERNAL FUNCTIONS ====================

    function _validateCreationInputs(
        ITotemTypes.TotemDetails calldata details,
        ITotemTypes.MintAllocation[] calldata allocations,
        ITotemTypes.TotemMods calldata mods,
        bytes32 tickerBytes
    ) internal view {
        if (allocations.length > 50) {
            revert Errors.TooManyAllocations();
        }

        if (mods.transfer.length + mods.mint.length + mods.burn.length + mods.created.length + mods.transferOwnership.length > 200) {
            revert Errors.TooManyMods();
        }

        if (totems[tickerBytes].creator != address(0)) {
            revert Errors.TotemAlreadyExists(details.ticker);
        }

        if (bytes(details.name).length > 32) revert Errors.NameTooLong(bytes(details.name).length);
        if (bytes(details.name).length < 3) revert Errors.NameTooShort(bytes(details.name).length);
        if (bytes(details.image).length == 0) revert Errors.EmptyImage();
        if (bytes(details.description).length > 500) revert Errors.DescriptionTooLong(bytes(details.description).length);
        if (details.seed == bytes32(0)) revert Errors.InvalidSeed();
    }

    function _processAllocations(
        IMarket market,
        bytes32 tickerBytes,
        ITotemTypes.MintAllocation[] calldata allocations,
        ITotemTypes.Totem storage totem
    ) internal returns (uint256, bool) {
        uint256 maxSupply = 0;
        bool hasUnlimitedMinters = false;

        for (uint256 i = 0; i < allocations.length; i++) {
            totem.allocations.push(allocations[i]);

            if (allocations[i].recipient == address(0)) {
                revert Errors.InvalidAllocation("Cannot allocate to zero address");
            }

            if (allocations[i].isMinter) {
                ITotemTypes.Mod memory mod = market.getMod(allocations[i].recipient);
                if (!mod.details.isMinter) {
                    revert Errors.ModNotMinter(allocations[i].recipient);
                }
                if (allocations[i].amount == 0) {
                    if (!mod.details.needsUnlimited) {
                        revert Errors.ModMustSupportUnlimitedMinting(allocations[i].recipient);
                    }

                    if (!hasUnlimitedMinters) hasUnlimitedMinters = true;
                }
            } else {
                if (balances[tickerBytes][allocations[i].recipient] == 0) {
                    stats[tickerBytes].holders++;
                    stats[tickerBytes].mints++;
                }

                if (allocations[i].amount == 0) {
                    revert Errors.InvalidAllocation("Cannot allocate zero amount to non-minter");
                }
            }

            if (allocations[i].amount > 0) {
                balances[tickerBytes][allocations[i].recipient] += allocations[i].amount;
                maxSupply += allocations[i].amount;
            }
        }

        return (maxSupply, hasUnlimitedMinters);
    }

    function _processFeesAndMods(
        IMarket market,
        bytes32 tickerBytes,
        ITotemTypes.TotemMods calldata mods,
        address payable referrer
    ) internal returns (ITotemTypes.FeeDisbursement[] memory, uint256) {
        uint256 totalLength =
            mods.transfer.length +
            mods.mint.length +
            mods.burn.length +
            mods.created.length +
            mods.transferOwnership.length;

        modNonce++;

        address[] memory unique = new address[](totalLength);
        uint256 uniqueCount = 0;
        uint256 totalFees = 0;

        uniqueCount = _processModArray(mods.transfer, unique, uniqueCount);
        uniqueCount = _processModArray(mods.mint, unique, uniqueCount);
        uniqueCount = _processModArray(mods.burn, unique, uniqueCount);
        uniqueCount = _processModArray(mods.created, unique, uniqueCount);
        uniqueCount = _processModArray(mods.transferOwnership, unique, uniqueCount);

        // +2 for burn disbursement and optional referrer disbursement
        ITotemTypes.FeeDisbursement[] memory disbursements =
            new ITotemTypes.FeeDisbursement[](uniqueCount + 2);

        for (uint256 i = 0; i < uniqueCount; i++) {
            address mod = unique[i];
            uint256 fee = market.getModFee(mod);

            if (fee > 0) {
                disbursements[i] = ITotemTypes.FeeDisbursement({
                    recipient: IMod(mod).getSeller(),
                    amount: fee
                });

                totalFees += fee;
            }
            _storeLicense(tickerBytes, mod);
        }

        // Calculate the base fee (at least minBaseFee, or referrer's set fee if higher)
        uint256 referrerSetFee = referrer != address(0) ? fees[referrer] : 0;
        uint256 baseFee = referrerSetFee > minBaseFee ? referrerSetFee : minBaseFee;
        totalFees += baseFee;

        if (referrer == address(0)) {
            // No referrer - burn the entire baseFee
            disbursements[uniqueCount] = ITotemTypes.FeeDisbursement({
                recipient: payable(address(0)),
                amount: baseFee
            });
        } else {
            // burnedFee is always burned
            if (burnedFee > 0) {
                disbursements[uniqueCount] = ITotemTypes.FeeDisbursement({
                    recipient: payable(address(0)),
                    amount: burnedFee
                });
            }
            // Referrer gets the difference between baseFee and burnedFee
            uint256 referrerAmount = baseFee - burnedFee;
            if (referrerAmount > 0) {
                disbursements[uniqueCount + 1] = ITotemTypes.FeeDisbursement({
                    recipient: referrer,
                    amount: referrerAmount
                });
            }
        }

        return (disbursements, totalFees);
    }

    function _processModArray(
        address[] calldata modArray,
        address[] memory unique,
        uint256 uniqueCount
    ) internal returns (uint256) {
        for (uint256 i = 0; i < modArray.length; i++) {
            address mod = modArray[i];
            if (seenModAt[mod] != modNonce) {
                seenModAt[mod] = modNonce;
                unique[uniqueCount++] = mod;
            }
        }
        return uniqueCount;
    }

    function _storeLicense(bytes32 ticker, address mod) internal {
        licenses[ticker][mod] = true;
    }

    function _validateModsForHook(
        IMarket market,
        address[] calldata mods,
        ITotemTypes.Hook hook
    ) internal view {
        for (uint256 i = 0; i < mods.length; i++) {
            address mod = mods[i];
            ITotemTypes.Hook[] memory supported = market.getSupportedHooks(mod);
            if (!_supportsHook(supported, hook)) {
                revert Errors.ModDoesntSupportHook(mod, hook);
            }
        }
    }

    function _supportsHook(
        ITotemTypes.Hook[] memory supported,
        ITotemTypes.Hook required
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < supported.length; i++) {
            if (supported[i] == required) {
                return true;
            }
        }
        return false;
    }

    function _notifyCreatedHooks(
        string calldata ticker,
        address creator,
        address[] memory mods
    ) internal {
        for (uint256 i = 0; i < mods.length; i++) {
            if (mods[i] == proxyMod) {
                continue;
            }
            IModCreated(mods[i]).onCreated(ticker, creator);
        }
    }

    function _addBalance(bytes32 ticker, address account, uint256 amount) internal {
        balances[ticker][account] += amount;
    }

    function _subBalance(bytes32 ticker, address account, uint256 amount) internal {
        if (balances[ticker][account] < amount) {
            revert Errors.InsufficientBalance(amount, balances[ticker][account]);
        }
        balances[ticker][account] -= amount;
    }

    function _notifyMintHooks(
        string calldata ticker,
        address minter,
        uint256 amount,
        uint256 payment,
        string memory memo,
        address[] memory mods
    ) internal {
        for (uint256 i = 0; i < mods.length; i++) {
            IModMint(mods[i]).onMint(ticker, minter, amount, payment, memo);
        }
    }

    function _notifyTransferHooks(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string memory memo,
        address[] memory mods
    ) internal {
        for (uint256 i = 0; i < mods.length; i++) {
            IModTransfer(mods[i]).onTransfer(ticker, from, to, amount, memo);
        }
    }

    function _notifyBurnHooks(
        string calldata ticker,
        address owner,
        uint256 amount,
        string memory memo,
        address[] memory mods
    ) internal {
        for (uint256 i = 0; i < mods.length; i++) {
            IModBurn(mods[i]).onBurn(ticker, owner, amount, memo);
        }
    }

    function _notifyTransferOwnershipHooks(
        string calldata ticker,
        address previousOwner,
        address newOwner,
        address[] memory mods
    ) internal {
        for (uint256 i = 0; i < mods.length; i++) {
            IModTransferOwnership(mods[i]).onTransferOwnership(ticker, previousOwner, newOwner);
        }
    }
}
