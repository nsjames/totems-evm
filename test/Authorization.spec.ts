import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createTotem,
    Hook,
    setupTotemsTest,
    transfer,
    ZERO_ADDRESS,
    publishMod,
    modDetails
} from "./helpers.ts";

describe("Authorization Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer, unauthorized] = accounts;

    let testMod: any;
    let erc20Factory: any;

    it('Should setup test environment', async function () {
        // Deploy test mod
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(
            market,
            seller,
            testMod.address,
            [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer],
            modDetails({ isMinter: true })
        );

        // Create a totem with minter mod
        await createTotem(
            totems,
            market,
            seller,
            "AUTH",
            4,
            [
                { recipient: seller, amount: 1000000n },
                { recipient: testMod.address, amount: 1000n, isMinter: true },
            ],
            {
                transfer: [testMod.address],
                mint: [testMod.address],
                burn: [testMod.address],
                created: [testMod.address],
            }
        );

        // Deploy ERC20 factory for relay tests
        erc20Factory = await viem.deployContract("TotemERC20Factory", [
            totems.address,
        ]);
    });

    // Authorization: Mint Tests
    it('Should fail to mint with non-minter mod', async function () {
        const nonMinterMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(
            market,
            seller,
            nonMinterMod.address,
            [0, 1, 2],
            modDetails({ isMinter: false })
        );

        await assert.rejects(
            async () => {
                await totems.write.mint([
                    nonMinterMod.address,
                    seller,
                    "AUTH",
                    100n,
                    "unauthorized mint"
                ], { account: seller });
            },
            /ModNotMinter/,
            "Should revert with ModNotMinter error"
        );
    });

    it('Should fail to mint as non-owner through relay', async function () {
        await assert.rejects(
            async () => {
                await totems.write.mint([
                    testMod.address,
                    buyer,
                    "AUTH",
                    100n,
                    "unauthorized mint"
                ], { account: unauthorized });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    // Authorization: Burn Tests
    it('Should fail to burn tokens of another account', async function () {
        await assert.rejects(
            async () => {
                await totems.write.burn([
                    "AUTH",
                    seller,
                    100n,
                    "unauthorized burn"
                ], { account: unauthorized });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    // Authorization: Transfer Tests
    it('Should fail to transfer tokens from another account without relay', async function () {
        await assert.rejects(
            async () => {
                await totems.write.transfer([
                    "AUTH",
                    seller,
                    buyer,
                    100n,
                    "unauthorized transfer"
                ], { account: unauthorized });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    // Authorization: Relay Creation Tests
    it('Should fail to create relay for totem not owned', async function () {
        await assert.rejects(
            async () => {
                await totems.write.createRelay([
                    "AUTH",
                    erc20Factory.address,
                    "ERC20"
                ], { account: unauthorized });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    it('Should successfully create relay as totem creator', async function () {
        await totems.write.createRelay([
            "AUTH",
            erc20Factory.address,
            "ERC20"
        ], { account: seller });

        const relays = await totems.read.getRelays(["AUTH"]);
        assert.equal(relays.length, 1, "Should have one relay");
        assert.equal(relays[0].standard, "ERC20", "Should be ERC20 relay");
    });

    // Authorization: Relay Revocation Tests
    it('Should fail to revoke relay for totem not owned', async function () {
        const relays = await totems.read.getRelays(["AUTH"]);
        const relayAddress = relays[0].relay;

        await assert.rejects(
            async () => {
                await totems.write.removeRelay([
                    "AUTH",
                    relayAddress
                ], { account: unauthorized });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    it('Should successfully revoke relay as totem creator', async function () {
        const relaysBefore = await totems.read.getRelays(["AUTH"]);
        const relayAddress = relaysBefore[0].relay;

        await totems.write.removeRelay([
            "AUTH",
            relayAddress
        ], { account: seller });

        const relaysAfter = await totems.read.getRelays(["AUTH"]);
        assert.equal(relaysAfter.length, 0, "Should have no relays after revocation");
    });

    // Authorization: Relay Burn/Transfer Tests
    it('Should burn owner tokens when relay calls burn on their behalf', async function () {
        // Deploy burn relay factory
        const burnRelayFactory = await viem.deployContract("BurnRelayFactory", [
            totems.address,
        ]);

        // Create a new totem for this test
        await createTotem(
            totems,
            market,
            seller,
            "RLYBURN",
            4,
            [
                { recipient: seller, amount: 1000000n },
                { recipient: buyer, amount: 500000n },
            ]
        );

        // Create burn relay
        await totems.write.createRelay([
            "RLYBURN",
            burnRelayFactory.address,
            "BurnRelay"
        ], { account: seller });

        const relays = await totems.read.getRelays(["RLYBURN"]);
        const relayAddress = relays[0].relay;

        // Get balances before
        const sellerBalanceBefore = await totems.read.getBalance(["RLYBURN", seller]);
        const buyerBalanceBefore = await totems.read.getBalance(["RLYBURN", buyer]);

        // Relay burns on behalf of buyer (not the relay's own tokens)
        const burnRelay = await viem.getContractAt("BurnRelay", relayAddress);
        await burnRelay.write.burn([100000n], { account: buyer });

        // Verify buyer's tokens were burned, not relay's or seller's
        const sellerBalanceAfter = await totems.read.getBalance(["RLYBURN", seller]);
        const buyerBalanceAfter = await totems.read.getBalance(["RLYBURN", buyer]);

        assert.equal(sellerBalanceAfter, sellerBalanceBefore, "Seller balance should be unchanged");
        assert.equal(buyerBalanceAfter, buyerBalanceBefore - 100000n, "Buyer balance should decrease by burn amount");
    });

    // Authorization: Factory Direct Call Tests
    it('Should fail to call BurnRelayFactory.createRelay directly', async function () {
        const burnRelayFactory = await viem.deployContract("BurnRelayFactory", [
            totems.address,
        ]);

        await assert.rejects(
            async () => {
                await burnRelayFactory.write.createRelay(["TEST"], { account: seller });
            },
            /Unauthorized/,
            "Should revert when calling createRelay directly"
        );
    });

    // Authorization: Fee Setting Tests
    it('Should allow anyone to set their own referrer fee', async function () {
        const minFee = 500000000000000n;
        await totems.write.setReferrerFee([minFee + 100n], { account: buyer });
        const fee = await totems.read.getFee([buyer]);
        assert.equal(fee, minFee + 100n, "Fee should be set correctly");
    });

    it('Should allow anyone to set their own market referrer fee', async function () {
        const minFee = 500000000000000n;
        await market.write.setReferrerFee([minFee + 200n], { account: buyer });
        const fee = await market.read.getFee([buyer]);
        assert.equal(fee, minFee + 200n, "Market fee should be set correctly");
    });
});
