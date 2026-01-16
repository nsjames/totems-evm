import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createTotem,
    Hook,
    setupTotemsTest,
    transfer,
    ZERO_ADDRESS,
    totemDetails, modDetails
} from "./helpers.ts";

describe("Edge Cases Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer, third, fourth] = accounts;

    it('Should setup test environment', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "EDGE",
            18,
            [
                { recipient: seller, amount: 1000000n },
            ]
        );
    });

    // Edge Cases: Holder Count Tracking
    it('Should correctly track holder count on first transfer', async function () {
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await transfer(totems, "EDGE", seller, buyer, 100n);
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        assert.equal(statsAfter.holders, statsBefore.holders + 1n, "Holder count should increase by 1");
    });

    it('Should not increase holder count on second transfer to same address', async function () {
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await transfer(totems, "EDGE", seller, buyer, 100n);
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        assert.equal(statsAfter.holders, statsBefore.holders, "Holder count should not change");
    });

    it('Should decrease holder count when balance goes to zero', async function () {
        const buyerBalance = await totems.read.getBalance(["EDGE", buyer]);
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await transfer(totems, "EDGE", buyer, seller, buyerBalance);
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        const finalBalance = await totems.read.getBalance(["EDGE", buyer]);
        
        assert.equal(finalBalance, 0n, "Balance should be zero");
        assert.equal(statsAfter.holders, statsBefore.holders - 1n, "Holder count should decrease by 1");
    });

    it('Should track multiple new holders correctly', async function () {
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await transfer(totems, "EDGE", seller, third, 100n);
        await transfer(totems, "EDGE", seller, fourth, 100n);
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        assert.equal(statsAfter.holders, statsBefore.holders + 2n, "Holder count should increase by 2");
    });

    // Edge Cases: Pagination Tests
    it('Should handle listTotems with cursor beyond list length', async function () {
        await assert.rejects(
            async () => {
                await totems.read.listTotems([10, 9999999])
            },
            /InvalidCursor/,
            "Should not allow invalid cursors"
        );
    });

    it('Should handle listTotems with perPage = 0', async function () {
        const [totems_list, cursor, hasMore] = await totems.read.listTotems([0, 0]);
        
        assert.equal(totems_list.length, 0, "Should return empty array");
    });

    it('Should handle listTotems pagination correctly', async function () {
        // Create additional totems to ensure we have enough for pagination
        await createTotem(totems, market, seller, "PAGA", 18, [{ recipient: seller, amount: 1000n }]);
        await createTotem(totems, market, seller, "PAGB", 18, [{ recipient: seller, amount: 1000n }]);
        await createTotem(totems, market, seller, "PAGC", 18, [{ recipient: seller, amount: 1000n }]);

        // Get first page with 2 items
        const [page1, cursor1, hasMore1] = await totems.read.listTotems([2, 0n]);
        assert.equal(page1.length, 2, "First page should have 2 items");
        assert.ok(hasMore1, "Should have more pages");

        // Get second page
        const [page2, cursor2, hasMore2] = await totems.read.listTotems([2, cursor1]);
        assert.ok(page2.length > 0, "Second page should have results");

        // Verify no duplicates between pages
        const page1Tickers = page1.map((t: any) => t.details.ticker);
        const page2Tickers = page2.map((t: any) => t.details.ticker);
        const hasDuplicates = page1Tickers.some((t: string) => page2Tickers.includes(t));
        assert.equal(hasDuplicates, false, "Pages should not have duplicate totems");
    });

    it('Should handle listMods with cursor at end', async function () {
        const [allMods] = await market.read.listMods([100, 0]);
        const totalMods = allMods.length;
        
        const [mods, cursor, hasMore] = await market.read.listMods([10, totalMods]);
        
        assert.equal(mods.length, 0, "Should return empty array at end");
        assert.equal(hasMore, false, "Should indicate no more mods");
    });

    // Edge Cases: Maximum Allocations
    it('Should handle maximum allowed allocations (50)', async function () {
        const maxAllocations = Array(50).fill(null).map((_, i) => ({
            recipient: accounts[0],
            amount: 100n,
        }));

        await createTotem(
            totems,
            market,
            seller,
            "MAXALLOC",
            4,
            maxAllocations
        );

        const totem = await totems.read.getTotem(["MAXALLOC"]);
        assert.ok(totem.creator !== ZERO_ADDRESS, "Totem should be created");
    });

    // Edge Cases: Stats Counter Tests
    it('Should correctly increment transfer counter', async function () {
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await transfer(totems, "EDGE", seller, buyer, 100n);
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        assert.equal(statsAfter.transfers, statsBefore.transfers + 1n, "Transfer count should increase");
    });

    it('Should correctly increment burn counter', async function () {
        const statsBefore = await totems.read.getStats(["EDGE"]);
        
        await totems.write.burn([
            "EDGE",
            seller,
            100n,
            "test burn"
        ], { account: seller });
        
        const statsAfter = await totems.read.getStats(["EDGE"]);
        assert.equal(statsAfter.burns, statsBefore.burns + 1n, "Burn count should increase");
    });

    // Edge Cases: Ticker Normalization
    it('Should normalize ticker case consistently', async function () {
        const lowerHash = await totems.read.tickerToBytes(["edge"]);
        const upperHash = await totems.read.tickerToBytes(["EDGE"]);
        const mixedHash = await totems.read.tickerToBytes(["EdGe"]);
        
        assert.equal(lowerHash, upperHash, "Lowercase should match uppercase");
        assert.equal(lowerHash, mixedHash, "Mixed case should match uppercase");
    });

    // Edge Cases: Get Multiple Items
    it('Should handle getTotems with empty array', async function () {
        const result = await totems.read.getTotems([[]]);
        assert.equal(result.length, 0, "Should return empty array");
    });

    it('Should handle getMods with empty array', async function () {
        const result = await market.read.getMods([[]]);
        assert.equal(result.length, 0, "Should return empty array");
    });

    it('Should handle getMods with duplicate addresses', async function () {
        // Create a test mod
        const testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const baseFee = await market.read.getFee([ZERO_ADDRESS]);
        await market.write.publish([
            testMod.address,
            [Hook.Created, Hook.Mint],
            1_000_000n,
            {
                name: "Test Mod",
                summary: "A test mod for duplicates",
                markdown: "## Test",
                image: "https://example.com/test.png",
                website: "https://example.com",
                websiteTickerPath: "/test",
                isMinter: false,
                needsUnlimited: false,
            },
            [],
            ZERO_ADDRESS,
        ], { value: baseFee, account: seller });

        const result = await market.read.getMods([[testMod.address, testMod.address]]);
        assert.equal(result.length, 2, "Should return 2 results even with duplicate");
        assert.equal(result[0].mod.toLowerCase(), testMod.address.toLowerCase(), "First should match");
        assert.equal(result[1].mod.toLowerCase(), testMod.address.toLowerCase(), "Second should match");
    });

    // Edge Cases: Supply Management
    it('Should track supply correctly after multiple operations', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "SUPPLY",
            4,
            [
                { recipient: seller, amount: 1000n, isMinter: false },
            ]
        );

        const totemBefore = await totems.read.getTotem(["SUPPLY"]);
        const initialSupply = totemBefore.supply;

        // Burn some
        await totems.write.burn([
            "SUPPLY",
            seller,
            100n,
            "burn test"
        ], { account: seller });

        const totemAfter = await totems.read.getTotem(["SUPPLY"]);
        assert.equal(totemAfter.supply, initialSupply - 100n, "Supply should decrease by burn amount");
    });

    // Edge Cases: Balance Queries
    it('Should return correct balance for non-existent account', async function () {
        const balance = await totems.read.getBalance(["EDGE", "0x9999999999999999999999999999999999999999"]);
        assert.equal(balance, 0n, "Should return zero for non-existent account");
    });

    // Edge Cases: Relay Standard Lookup
    it('Should return zero address for non-existent relay standard', async function () {
        const relayAddress = await totems.read.getRelayOfStandard(["EDGE", "NONEXISTENT"]);
        assert.equal(relayAddress, ZERO_ADDRESS, "Should return zero address");
    });

    // Edge Cases: Multiple Transfers Same Block
    it('Should handle multiple transfers in same transaction sequence', async function () {
        const balanceBefore = await totems.read.getBalance(["EDGE", seller]);
        
        await transfer(totems, "EDGE", seller, buyer, 10n);
        await transfer(totems, "EDGE", seller, third, 20n);
        await transfer(totems, "EDGE", seller, fourth, 30n);
        
        const balanceAfter = await totems.read.getBalance(["EDGE", seller]);
        assert.equal(balanceAfter, balanceBefore - 60n, "Should deduct all transfers");
    });
});
