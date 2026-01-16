// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import "../totems/Totems.sol";
import "../market/ModMarket.sol";
import "../mods/ProxyMod.sol";
import "../mods/TestMod.sol";
import "../library/ITotemTypes.sol";
import "../interfaces/ITotems.sol";

contract TotemsFuzzTest is Test {
    ITotems public totems;
    ModMarket public market;
    ProxyMod public proxyMod;
    TestMod public testMod;

    address payable public seller;
    address public user1;
    address public user2;

    uint256 constant MIN_BASE_FEE = 0.0005 ether;
    uint256 constant BURNED_FEE = 0.0001 ether;

    function setUp() public {
        seller = payable(address(0x1));
        user1 = address(0x2);
        user2 = address(0x3);

        market = new ModMarket(MIN_BASE_FEE, BURNED_FEE);
        proxyMod = new ProxyMod(seller);

        Totems totemsContract = new Totems(
            address(market),
            address(proxyMod),
            MIN_BASE_FEE,
            BURNED_FEE
        );

        totems = ITotems(address(totemsContract));

        vm.prank(seller);
        proxyMod.initialize(address(totems), address(market));

        testMod = new TestMod(address(totems), payable(seller));

        ITotemTypes.Hook[] memory hooks = new ITotemTypes.Hook[](4);
        hooks[0] = ITotemTypes.Hook.Created;
        hooks[1] = ITotemTypes.Hook.Mint;
        hooks[2] = ITotemTypes.Hook.Burn;
        hooks[3] = ITotemTypes.Hook.Transfer;

        ITotemTypes.ModDetails memory modDetails = ITotemTypes.ModDetails({
            name: "Test Mod",
            summary: "A test mod for fuzzing",
            markdown: "## Test Mod",
            image: "https://example.com/image.png",
            website: "https://example.com",
            websiteTickerPath: "/token/{ticker}",
            isMinter: true,
            needsUnlimited: false
        });

        uint256 fee = market.getFee(address(0));
        vm.deal(seller, 100 ether);
        vm.prank(seller);

        ITotemTypes.ModRequiredAction[] memory requiredActions = new ITotemTypes.ModRequiredAction[](0);
        market.publish{value: fee}(
            address(testMod),
            hooks,
            1_000_000,
            modDetails,
            requiredActions,
            payable(address(0))
        );
    }

    // ========== Transfer Fuzzing ==========

    function testFuzz_TransferAmount(uint128 initialSupply, uint128 transferAmount) public {
        vm.assume(initialSupply > 0);
        vm.assume(transferAmount > 0);
        vm.assume(transferAmount <= initialSupply);

        _createTotem("FUZZA", initialSupply);

        vm.prank(seller);
        totems.transfer("FUZZA", seller, user1, transferAmount, "fuzz transfer");

        uint256 sellerBalance = totems.getBalance("FUZZA", seller);
        uint256 user1Balance = totems.getBalance("FUZZA", user1);

        require(sellerBalance == initialSupply - transferAmount, "Seller balance incorrect");
        require(user1Balance == transferAmount, "User1 balance incorrect");
    }

    function testFuzz_MultipleTransfers(uint64 amount1, uint64 amount2, uint64 amount3) public {
        uint256 total = uint256(amount1) + uint256(amount2) + uint256(amount3);
        vm.assume(total > 0);
        vm.assume(amount1 > 0 || amount2 > 0 || amount3 > 0);

        _createTotem("FUZZB", total);

        if (amount1 > 0) {
            vm.prank(seller);
            totems.transfer("FUZZB", seller, user1, amount1, "");
        }

        uint256 remaining = total - amount1;
        if (amount2 > 0 && amount2 <= remaining) {
            vm.prank(seller);
            totems.transfer("FUZZB", seller, user2, amount2, "");
            remaining -= amount2;
        }

        uint256 sellerBalance = totems.getBalance("FUZZB", seller);
        require(sellerBalance == remaining, "Final seller balance incorrect");
    }

    // ========== Burn Fuzzing ==========

    function testFuzz_BurnAmount(uint128 initialSupply, uint128 burnAmount) public {
        vm.assume(initialSupply > 0);
        vm.assume(burnAmount > 0);
        vm.assume(burnAmount <= initialSupply);

        _createTotem("FUZZC", initialSupply);

        ITotemTypes.Totem memory totemBefore = totems.getTotem("FUZZC");

        vm.prank(seller);
        totems.burn("FUZZC", seller, burnAmount, "fuzz burn");

        ITotemTypes.Totem memory totemAfter = totems.getTotem("FUZZC");

        require(totemAfter.supply == totemBefore.supply - burnAmount, "Supply not reduced correctly");
        require(totems.getBalance("FUZZC", seller) == initialSupply - burnAmount, "Balance not reduced correctly");
    }

    // ========== Ticker Validation Fuzzing ==========

    function testFuzz_ValidTickerLength(uint8 length) public {
        vm.assume(length >= 3 && length <= 10);

        bytes memory ticker = new bytes(length);
        for (uint8 i = 0; i < length; i++) {
            ticker[i] = bytes1(65 + (i % 26)); // A-Z
        }

        string memory tickerStr = string(ticker);
        _createTotem(tickerStr, 1000);

        ITotemTypes.Totem memory totem = totems.getTotem(tickerStr);
        require(totem.supply == 1000, "Totem not created correctly");
    }

    // ========== Decimals Fuzzing ==========

    function testFuzz_Decimals(uint8 decimals) public {
        vm.assume(decimals <= 18);

        _createTotemWithDecimals("DECFZ", 1000, decimals);

        ITotemTypes.Totem memory totem = totems.getTotem("DECFZ");
        require(totem.details.decimals == decimals, "Decimals not set correctly");
    }

    // ========== Stats Fuzzing ==========

    function testFuzz_TransferStats(uint8 numTransfers) public {
        vm.assume(numTransfers > 0 && numTransfers <= 50);

        uint256 initialSupply = uint256(numTransfers) * 10;
        _createTotem("STATS", initialSupply);

        for (uint8 i = 0; i < numTransfers; i++) {
            vm.prank(seller);
            totems.transfer("STATS", seller, user1, 1, "");

            if (i < numTransfers - 1) {
                vm.prank(user1);
                totems.transfer("STATS", user1, seller, 1, "");
            }
        }

        ITotemTypes.TotemStats memory stats = totems.getStats("STATS");
        uint256 expectedTransfers = numTransfers == 1 ? 1 : (numTransfers * 2 - 1);
        require(stats.transfers == expectedTransfers, "Transfer count incorrect");
    }

    function testFuzz_BurnStats(uint8 numBurns) public {
        vm.assume(numBurns > 0 && numBurns <= 50);

        uint256 initialSupply = uint256(numBurns) * 100;
        _createTotem("BSTAT", initialSupply);

        for (uint8 i = 0; i < numBurns; i++) {
            vm.prank(seller);
            totems.burn("BSTAT", seller, 1, "");
        }

        ITotemTypes.TotemStats memory stats = totems.getStats("BSTAT");
        require(stats.burns == numBurns, "Burn count incorrect");
    }

    // ========== Supply Invariant Fuzzing ==========

    function testFuzz_SupplyInvariant(uint64 supply, uint64 transfer1, uint64 transfer2, uint64 burnAmt) public {
        vm.assume(supply > 0);
        vm.assume(transfer1 <= supply);
        vm.assume(transfer2 <= transfer1);
        vm.assume(burnAmt <= supply - transfer1);

        _createTotem("INVRT", supply);

        // Transfer some to user1
        if (transfer1 > 0) {
            vm.prank(seller);
            totems.transfer("INVRT", seller, user1, transfer1, "");
        }

        // Transfer some from user1 to user2
        if (transfer2 > 0) {
            vm.prank(user1);
            totems.transfer("INVRT", user1, user2, transfer2, "");
        }

        // Burn some from seller
        if (burnAmt > 0) {
            vm.prank(seller);
            totems.burn("INVRT", seller, burnAmt, "");
        }

        // Verify invariant: sum of balances == supply
        uint256 sellerBal = totems.getBalance("INVRT", seller);
        uint256 user1Bal = totems.getBalance("INVRT", user1);
        uint256 user2Bal = totems.getBalance("INVRT", user2);

        ITotemTypes.Totem memory totem = totems.getTotem("INVRT");

        require(sellerBal + user1Bal + user2Bal == totem.supply, "Supply invariant violated");
        require(totem.supply == supply - burnAmt, "Supply not reduced by burns");
    }

    // ========== Holder Count Fuzzing ==========

    function testFuzz_HolderCount(uint8 numRecipients) public {
        vm.assume(numRecipients > 0 && numRecipients <= 20);

        uint256 supply = uint256(numRecipients) * 100;
        _createTotem("HOLDR", supply);

        // Transfer to unique addresses
        for (uint8 i = 0; i < numRecipients; i++) {
            address recipient = address(uint160(0x100 + i));
            vm.prank(seller);
            totems.transfer("HOLDR", seller, recipient, 1, "");
        }

        ITotemTypes.TotemStats memory stats = totems.getStats("HOLDR");
        // +1 for seller who still has balance
        require(stats.holders == numRecipients + 1, "Holder count incorrect");
    }

    function testFuzz_HolderCountDecreasesOnZeroBalance(uint8 numRecipients) public {
        vm.assume(numRecipients > 0 && numRecipients <= 20);

        uint256 supply = uint256(numRecipients) * 100;
        _createTotem("HLDRZ", supply);

        // Transfer to unique addresses
        for (uint8 i = 0; i < numRecipients; i++) {
            address recipient = address(uint160(0x200 + i));
            vm.prank(seller);
            totems.transfer("HLDRZ", seller, recipient, 10, "");
        }

        // Transfer all back from each recipient
        for (uint8 i = 0; i < numRecipients; i++) {
            address recipient = address(uint160(0x200 + i));
            vm.prank(recipient);
            totems.transfer("HLDRZ", recipient, seller, 10, "");
        }

        ITotemTypes.TotemStats memory stats = totems.getStats("HLDRZ");
        require(stats.holders == 1, "Should only have seller as holder");
    }

    // ========== Transfer Chain Fuzzing ==========

    function testFuzz_TransferChain(uint64 amount) public {
        vm.assume(amount > 0);

        _createTotem("CHAIN", amount);

        // seller -> user1 -> user2 -> seller (full circle)
        vm.prank(seller);
        totems.transfer("CHAIN", seller, user1, amount, "");

        vm.prank(user1);
        totems.transfer("CHAIN", user1, user2, amount, "");

        vm.prank(user2);
        totems.transfer("CHAIN", user2, seller, amount, "");

        // Seller should have original amount back
        require(totems.getBalance("CHAIN", seller) == amount, "Chain transfer failed");
        require(totems.getBalance("CHAIN", user1) == 0, "User1 should be empty");
        require(totems.getBalance("CHAIN", user2) == 0, "User2 should be empty");
    }

    // ========== Multiple Allocations Fuzzing ==========

    function testFuzz_MultipleAllocations(uint64 alloc1, uint64 alloc2, uint64 alloc3) public {
        vm.assume(alloc1 > 0 || alloc2 > 0 || alloc3 > 0);
        uint256 total = uint256(alloc1) + uint256(alloc2) + uint256(alloc3);
        vm.assume(total > 0);

        ITotemTypes.TotemDetails memory details = ITotemTypes.TotemDetails({
            seed: bytes32(uint256(1)),
            decimals: 18,
            ticker: "ALLOC",
            name: "Alloc Token",
            description: "Multi allocation test",
            image: "https://example.com/image.png",
            website: "https://example.com"
        });

        uint8 numAllocs = (alloc1 > 0 ? 1 : 0) + (alloc2 > 0 ? 1 : 0) + (alloc3 > 0 ? 1 : 0);
        ITotemTypes.MintAllocation[] memory allocations = new ITotemTypes.MintAllocation[](numAllocs);

        uint8 idx = 0;
        if (alloc1 > 0) {
            allocations[idx++] = ITotemTypes.MintAllocation({
                recipient: seller,
                isMinter: false,
                amount: alloc1,
                label: "Alloc1"
            });
        }
        if (alloc2 > 0) {
            allocations[idx++] = ITotemTypes.MintAllocation({
                recipient: payable(user1),
                isMinter: false,
                amount: alloc2,
                label: "Alloc2"
            });
        }
        if (alloc3 > 0) {
            allocations[idx++] = ITotemTypes.MintAllocation({
                recipient: payable(user2),
                isMinter: false,
                amount: alloc3,
                label: "Alloc3"
            });
        }

        ITotemTypes.TotemMods memory mods = ITotemTypes.TotemMods({
            transfer: new address[](0),
            mint: new address[](0),
            burn: new address[](0),
            created: new address[](0),
            transferOwnership: new address[](0)
        });

        uint256 fee = totems.getFee(address(0));
        vm.deal(seller, fee + 1 ether);
        vm.prank(seller);
        totems.create{value: fee}(details, allocations, mods, payable(address(0)));

        // Verify allocations
        if (alloc1 > 0) require(totems.getBalance("ALLOC", seller) == alloc1, "Alloc1 incorrect");
        if (alloc2 > 0) require(totems.getBalance("ALLOC", user1) == alloc2, "Alloc2 incorrect");
        if (alloc3 > 0) require(totems.getBalance("ALLOC", user2) == alloc3, "Alloc3 incorrect");

        ITotemTypes.Totem memory totem = totems.getTotem("ALLOC");
        require(totem.supply == total, "Total supply incorrect");
    }

    // ========== Self Transfer Fuzzing ==========

    function testFuzz_SelfTransfer(uint128 supply, uint128 amount) public {
        vm.assume(supply > 0);
        vm.assume(amount > 0 && amount <= supply);

        _createTotem("SELFF", supply);

        uint256 balBefore = totems.getBalance("SELFF", seller);

        vm.prank(seller);
        totems.transfer("SELFF", seller, seller, amount, "self transfer");

        uint256 balAfter = totems.getBalance("SELFF", seller);
        require(balAfter == balBefore, "Self transfer changed balance");
    }

    // ========== Helpers ==========

    function _createTotem(string memory ticker, uint256 supply) internal {
        _createTotemWithDecimals(ticker, supply, 18);
    }

    function _createTotemWithDecimals(string memory ticker, uint256 supply, uint8 decimals) internal {
        ITotemTypes.TotemDetails memory details = ITotemTypes.TotemDetails({
            seed: bytes32(uint256(1)),
            decimals: decimals,
            ticker: ticker,
            name: string(abi.encodePacked(ticker, " Token")),
            description: "A fuzz test token",
            image: "https://example.com/image.png",
            website: "https://example.com"
        });

        ITotemTypes.MintAllocation[] memory allocations = new ITotemTypes.MintAllocation[](1);
        allocations[0] = ITotemTypes.MintAllocation({
            recipient: payable(seller),
            isMinter: false,
            amount: supply,
            label: "Initial"
        });

        ITotemTypes.TotemMods memory mods = ITotemTypes.TotemMods({
            transfer: new address[](0),
            mint: new address[](0),
            burn: new address[](0),
            created: new address[](0),
            transferOwnership: new address[](0)
        });

        uint256 fee = totems.getFee(address(0));
        vm.deal(seller, fee + 1 ether);
        vm.prank(seller);
        totems.create{value: fee}(details, allocations, mods, payable(address(0)));
    }
}
