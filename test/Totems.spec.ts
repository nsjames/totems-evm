import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {burn, createTotem, getBalance, setupTotemsTest, transfer, transferOwnership, ZERO_ADDRESS} from "./helpers.ts";

describe("Totems", async function () {
    let testMod;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts,
    } = await setupTotemsTest();
    const [deployer, seller, buyer, referrer] = accounts;

    it("Should get base fee", async function () {
        const fee = await totems.read.getFee([ZERO_ADDRESS]);
        assert.ok(fee > 0n);
    });

    it("Should create a totem", async function () {
        await createTotem(
            totems,
            market,
            seller,
            "TEST",
            4,
            [
                { recipient: seller, amount: 1000000n, isMinter: false },
            ],
            {
                transfer: [],
                mint: [],
                burn: [],
                created: [],
            },
            ZERO_ADDRESS,
            {
                name: "Test Totem",
                description: "A test totem",
                image: "ipfs://test",
                website: "https://example.com",
                seed: "0x" + "1".repeat(64), // 32 bytes
            }
        );

        const totem = await totems.read.getTotem(["TEST"]);

        assert.equal(totem.details.ticker, "TEST");
        assert.equal(totem.creator, seller);
    });

    it("Should get balance", async function () {
        const balance = await getBalance(totems, "TEST", seller);
        assert.equal(balance, 1000000n);
    });

    it("Should transfer tokens", async function () {
        await transfer(totems, "TEST", seller, buyer, 100000n);

        const sellerBalance = await totems.read.getBalance(["TEST", seller]);
        const buyerBalance = await totems.read.getBalance(["TEST", buyer]);

        assert.equal(sellerBalance, 900000n);
        assert.equal(buyerBalance, 100000n);
    });

    it("Should burn tokens", async function () {
        const balanceBefore = await getBalance(totems, "TEST", seller);
        await burn(totems, "TEST", seller, 50000n);
        const balanceAfter = await getBalance(totems, "TEST", seller);

        assert.equal(balanceAfter, balanceBefore - 50000n);
    });

    it("Should list totems", async function () {
        const [_totems, cursor, hasMore] = await totems.read.listTotems([10, 0n]);
        assert.ok(_totems.length > 0);
        assert.equal(_totems[0].details.ticker, "TEST");
    });

    it("Should transfer ownership of a totem", async function () {
        // Create a new totem for ownership transfer test
        await createTotem(
            totems,
            market,
            seller,
            "OWNER",
            18,
            [{ recipient: seller, amount: 1000n, isMinter: false }],
            { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
            ZERO_ADDRESS
        );

        // Verify initial owner
        const totemBefore = await totems.read.getTotem(["OWNER"]);
        assert.equal(totemBefore.creator.toLowerCase(), seller.toLowerCase());

        // Transfer ownership to buyer
        await transferOwnership(totems, "OWNER", seller, buyer);

        // Verify new owner
        const totemAfter = await totems.read.getTotem(["OWNER"]);
        assert.equal(totemAfter.creator.toLowerCase(), buyer.toLowerCase());
    });

    it("Should not allow non-owner to transfer ownership", async function () {
        // Try to transfer ownership from buyer (not the owner)
        try {
            await transferOwnership(totems, "OWNER", referrer, seller);
            assert.fail("Should have reverted");
        } catch (error: any) {
            assert.ok(error.message.includes("Unauthorized") || error.message.includes("revert"));
        }
    });
});