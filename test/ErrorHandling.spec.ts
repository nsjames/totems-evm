import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createTotem,
    setupTotemsTest,
    transfer,
    burn,
    ZERO_ADDRESS,
    totemDetails
} from "./helpers.ts";

describe("Error Handling Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer] = accounts;

    let testMod: any;

    it('Should setup test environment', async function () {
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await createTotem(
            totems,
            market,
            seller,
            "ERROR",
            18,
            [
                { recipient: seller, amount: 1000000n },
                { recipient: buyer, amount: 500000n },
            ]
        );
    });

    // Error Handling: Non-existent Totem Tests
    it('Should fail to get non-existent totem', async function () {
        await assert.rejects(
            async () => {
                await totems.read.getTotem(["NONEXIST"]);
            },
            /TotemNotFound/,
            "Should revert with TotemNotFound error"
        );
    });

    it('Should fail to transfer non-existent totem', async function () {
        await assert.rejects(
            async () => {
                await totems.write.transfer([
                    "NONEXIST",
                    seller,
                    buyer,
                    100n,
                    "test"
                ], { account: seller });
            },
            /TotemNotFound/,
            "Should revert with TotemNotFound error"
        );
    });

    it('Should fail to mint non-existent totem', async function () {
        await assert.rejects(
            async () => {
                await totems.write.mint([
                    testMod.address,
                    seller,
                    "NONEXIST",
                    100n,
                    "test"
                ], { account: seller });
            },
            /TotemNotFound/,
            "Should revert with TotemNotFound error"
        );
    });

    it('Should fail to burn non-existent totem', async function () {
        await assert.rejects(
            async () => {
                await totems.write.burn([
                    "NONEXIST",
                    seller,
                    100n,
                    "test"
                ], { account: seller });
            },
            /TotemNotFound/,
            "Should revert with TotemNotFound error"
        );
    });

    // Error Handling: Insufficient Balance Tests
    it('Should fail to transfer with insufficient balance', async function () {
        const balance = await totems.read.getBalance(["ERROR", seller]);
        const excessAmount = balance + 1n;

        await assert.rejects(
            async () => {
                await totems.write.transfer([
                    "ERROR",
                    seller,
                    buyer,
                    excessAmount,
                    "insufficient balance"
                ], { account: seller });
            },
            /InsufficientBalance/,
            "Should revert with InsufficientBalance error"
        );
    });

    it('Should fail to burn with insufficient balance', async function () {
        const balance = await totems.read.getBalance(["ERROR", buyer]);
        const excessAmount = balance + 1n;

        await assert.rejects(
            async () => {
                await totems.write.burn([
                    "ERROR",
                    buyer,
                    excessAmount,
                    "insufficient balance"
                ], { account: buyer });
            },
            /InsufficientBalance/,
            "Should revert with InsufficientBalance error"
        );
    });

    // Error Handling: Zero Address Tests
    it('Should fail to create totem with zero address in allocation', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("ZEROALLOC", 4),
                    [{
                        label: "",
                        recipient: ZERO_ADDRESS,
                        amount: 1000n,
                        isMinter: false
                    }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidAllocation/,
            "Should revert with InvalidAllocation error"
        );
    });

    it('Should fail to create totem with insufficient fee', async function () {
        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("LOWFEE", 4),
                    [{
                        label: "",
                        recipient: seller,
                        amount: 1000n,
                        isMinter: false
                    }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: 100n, account: seller });
            },
            /InsufficientFee/,
            "Should revert with InsufficientFee error"
        );
    });

    // Error Handling: Zero Amount Tests
    it('Should handle zero amount transfer', async function () {
        const balanceBefore = await totems.read.getBalance(["ERROR", seller]);
        
        await totems.write.transfer([
            "ERROR",
            seller,
            buyer,
            0n,
            "zero transfer"
        ], { account: seller });

        const balanceAfter = await totems.read.getBalance(["ERROR", seller]);
        assert.equal(balanceAfter, balanceBefore, "Balance should not change");
    });

    it('Should handle zero amount burn', async function () {
        const balanceBefore = await totems.read.getBalance(["ERROR", seller]);
        
        await totems.write.burn([
            "ERROR",
            seller,
            0n,
            "zero burn"
        ], { account: seller });

        const balanceAfter = await totems.read.getBalance(["ERROR", seller]);
        assert.equal(balanceAfter, balanceBefore, "Balance should not change");
    });

    // Error Handling: Balance of Non-existent Account
    it('Should return zero balance for account with no tokens', async function () {
        const randomAddress = "0x1234567890123456789012345678901234567890";
        const balance = await totems.read.getBalance(["ERROR", randomAddress]);
        assert.equal(balance, 0n, "Should return zero balance");
    });

    // Error Handling: Referrer Fee Too Low
    it('Should fail to set referrer fee below minimum', async function () {
        const minFee = 500000000000000n;

        await assert.rejects(
            async () => {
                await totems.write.setReferrerFee([minFee - 1n], { account: seller });
            },
            /ReferrerFeeTooLow/,
            "Should revert with ReferrerFeeTooLow error"
        );
    });

    it('Should fail to set market referrer fee below minimum', async function () {
        const minFee = 500000000000000n;

        await assert.rejects(
            async () => {
                await market.write.setReferrerFee([minFee - 1n], { account: seller });
            },
            /ReferrerFeeTooLow/,
            "Should revert with ReferrerFeeTooLow error"
        );
    });
});
