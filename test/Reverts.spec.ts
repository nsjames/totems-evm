import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {Hook, setupTotemsTest, ZERO_ADDRESS, publishMod, modDetails, createTotem, totemDetails, BURNED_FEE} from "./helpers.ts";

let publishFee = 0n;
describe("Reverts", async function () {
    let testMod: any;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [seller, buyer, referrer] = accounts;

    it("Should return the base fee", async function () {
        const fee = await market.read.getFee([ZERO_ADDRESS]);
        assert(fee === 500000000000000n, "Base fee should be 0.0005 ether");
    });

    it('Should be able to publish a mod', async function () {
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        publishFee = await market.read.getFee([ZERO_ADDRESS]);
        await publishMod(
            market,
            seller,
            testMod.address,
            [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer],
            modDetails({
                name: "Test Mod",
                summary: "This is a test mod",
                markdown: "## Test Mod\nThis is a test mod.",
                image: "https://example.com/image.png",
                website: "https://example.com",
                websiteTickerPath: "/path/to/token",
            }),
            [],
            ZERO_ADDRESS,
            1_000_000n
        );

        const modInfo = await market.read.getMod([testMod.address]);
        assert(modInfo.details.name === "Test Mod", "Mod name should be 'Test Mod'");
        assert(modInfo.price === 1_000_000n, "Mod price should be 1,000,000 wei");
        assert(modInfo.seller === seller, "Mod seller should match");
        assert(modInfo.hooks.length === 4, "Mod should have 4 hooks");
        assert(modInfo.hooks[0] === Hook.Created, "First hook should be Created");
        assert(modInfo.hooks[Hook.Mint] === Hook.Mint, "Second hook should be Mint");
        assert(modInfo.details.summary === "This is a test mod", "Mod description should match");
        assert(modInfo.details.markdown === "## Test Mod\nThis is a test mod.", "Mod long description should match");
        assert(modInfo.details.image === "https://example.com/image.png", "Mod image URL should match");
        assert(modInfo.details.website === "https://example.com", "Mod website URL should match");
        assert(modInfo.details.websiteTickerPath === "/path/to/token", "Mod token path should match");
    });

    it('Should publish a mod with referrer and distribute fees', async function () {
        const testMod2 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const baseFee = await market.read.getFee([referrer]);
        const initialReferrerBalance = await publicClient.getBalance({ address: referrer });

        await publishMod(
            market,
            seller,
            testMod2.address,
            [Hook.Created, Hook.Mint],
            modDetails({
                name: "Test Mod 2",
                summary: "This is another test mod",
                markdown: "## Test Mod 2\nThis is another test mod.",
                image: "https://example.com/image2.png",
                website: "https://example.com",
                websiteTickerPath: "/path/to/token2",
            }),
            [],
            referrer,
            2_000_000n
        );

        const finalReferrerBalance = await publicClient.getBalance({ address: referrer });
        const expectedReferrerPayment = baseFee - BURNED_FEE;
        assert(finalReferrerBalance === initialReferrerBalance + expectedReferrerPayment, "Referrer should receive base fee minus burned fee");
    });

    it('Should fail to publish if caller is not seller', async function () {
        const testMod3 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const buyerWallet = await viem.getWalletClient(buyer);
        await assert.rejects(
            async () => {
                await buyerWallet.writeContract({
                    address: market.address,
                    abi: market.abi,
                    functionName: 'publish',
                    args: [
                        testMod3.address,
                        [Hook.Created, Hook.Mint],
                        1_000_000n,
                        modDetails({
                            name: "Test Mod 3",
                            summary: "This is test mod 3",
                            markdown: "## Test Mod 3\nThis is test mod 3.",
                            image: "https://example.com/image3.png",
                            websiteTickerPath: "/path/to/token3",
                        }),
                        [],
                        ZERO_ADDRESS,
                    ],
                });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    it('Should fail to publish with ZERO_ADDRESS address', async function () {
        await assert.rejects(
            async () => {
                await market.write.publish([
                    ZERO_ADDRESS,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /InvalidContractAddress/,
            "Should revert with InvalidContractAddress error"
        );
    });

    it('Should fail to publish already published mod', async function () {
        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /ModAlreadyPublished/,
            "Should revert with ModAlreadyPublished error"
        );
    });

    it('Should fail to publish with empty mod name', async function () {
        const testMod4 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod4.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ name: "" }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /EmptyModName/,
            "Should revert with EmptyModName error"
        );
    });

    it('Should fail to publish with mod name too short', async function () {
        const testMod5 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod5.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ name: "AB" }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /ModNameTooShort/,
            "Should revert with ModNameTooShort error"
        );
    });

    it('Should fail to publish with mod name too long', async function () {
        const testMod6 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const longName = "A".repeat(101);
        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod6.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ name: longName }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /ModNameTooLong/,
            "Should revert with ModNameTooLong error"
        );
    });

    it('Should fail to publish with empty summary', async function () {
        const testMod7 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod7.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ summary: "" }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /EmptyModSummary/,
            "Should revert with EmptyModSummary error"
        );
    });

    it('Should fail to publish with summary too short', async function () {
        const testMod8 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod8.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ summary: "Too short" }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /ModSummaryTooShort/,
            "Should revert with ModSummaryTooShort error"
        );
    });

    it('Should fail to publish with summary too long', async function () {
        const testMod9 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const longSummary = "A".repeat(151);
        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod9.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ summary: longSummary }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /ModSummaryTooLong/,
            "Should revert with ModSummaryTooLong error"
        );
    });

    it('Should fail to publish with empty image', async function () {
        const testMod10 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod10.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails({ image: "" }),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /EmptyModImage/,
            "Should revert with EmptyModImage error"
        );
    });

    it('Should fail to publish with no hooks', async function () {
        const testMod11 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod11.address,
                    [],
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /NoHooksSpecified/,
            "Should revert with NoHooksSpecified error"
        );
    });

    it('Should fail to publish with invalid hook', async function () {
        const testMod12 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod12.address,
                    [99],
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            "Transaction should revert with InvalidHook error"
        );
    });

    it('Should fail to publish with duplicate hooks', async function () {
        const testModDupe = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testModDupe.address,
                    [Hook.Created, Hook.Mint, Hook.Created], // duplicate Created
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: publishFee });
            },
            /DuplicateHook/,
            "Should revert with DuplicateHook error"
        );
    });

    it('Should fail to publish with insufficient fee', async function () {
        const testMod13 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await assert.rejects(
            async () => {
                await market.write.publish([
                    testMod13.address,
                    [Hook.Created, Hook.Mint],
                    1_000_000n,
                    modDetails(),
                    [],
                    ZERO_ADDRESS,
                ], { value: 10n });
            },
            /InsufficientFee/,
            "Should revert with InsufficientFee error"
        );
    });

    it('Should refund excess payment on publish', async function () {
        const testModRefund = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const baseFee = await market.read.getFee([ZERO_ADDRESS]);
        const excessPayment = baseFee * 2n;

        const initialBalance = await publicClient.getBalance({ address: seller });

        const tx = await market.write.publish([
            testModRefund.address,
            [Hook.Created, Hook.Mint],
            1_000_000n,
            modDetails({ name: "Refund Test Mod" }),
            [],
            ZERO_ADDRESS,
        ], { value: excessPayment, account: seller });

        const receipt = await publicClient.getTransactionReceipt({ hash: tx });
        const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
        const finalBalance = await publicClient.getBalance({ address: seller });

        const expectedBalance = initialBalance - baseFee - gasUsed;
        assert(finalBalance === expectedBalance, "Should refund excess payment on publish");
    });

    it('Should update mod price and details', async function () {
        await market.write.update([
            testMod.address,
            2_000_000n,
            modDetails({
                name: "Updated Test Mod",
                summary: "This is an updated test mod",
                markdown: "## Updated Test Mod\nThis is an updated test mod.",
                image: "https://example.com/updated-image.png",
                website: "https://example.com/updated",
                websiteTickerPath: "/updated/path",
                isMinter: true,
                needsUnlimited: true,
            }),
        ]);

        const modInfo = await market.read.getMod([testMod.address]);
        assert(modInfo.price === 2_000_000n, "Mod price should be updated");
        assert(modInfo.details.name === "Updated Test Mod", "Mod name should be updated");
        assert(modInfo.details.summary === "This is an updated test mod", "Mod summary should be updated");
    });

    it('Should fail to update mod if not seller', async function () {
        const buyerWallet = await viem.getWalletClient(buyer);
        await assert.rejects(
            async () => {
                await buyerWallet.writeContract({
                    address: market.address,
                    abi: market.abi,
                    functionName: 'update',
                    args: [
                        testMod.address,
                        3_000_000n,
                        modDetails({
                            name: "Hacked Mod",
                            summary: "This should not work",
                            markdown: "## Hacked\nFail.",
                            image: "https://example.com/hack.png",
                            websiteTickerPath: "/hack",
                        }),
                    ],
                });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    it('Should fail to update non-existent mod', async function () {
        await assert.rejects(
            async () => {
                await market.write.update([
                    buyer,
                    1_000_000n,
                    modDetails({
                        name: "Ghost Mod",
                        summary: "This mod does not exist",
                        markdown: "## Ghost\nDoes not exist.",
                        image: "https://example.com/ghost.png",
                        websiteTickerPath: "/ghost",
                    }),
                ]);
            },
            /ModNotFound/,
            "Should revert with ModNotFound error"
        );
    });

    it('Should update required actions for a mod', async function () {
        // First verify there are no required actions
        const initialActions = await market.read.getModRequiredActions([testMod.address]);
        assert.equal(initialActions.length, 0, "Should have no required actions initially");

        // Define new required actions
        // Note: isTotems must be explicitly set for ABI encoding, defaults to false
        const newRequiredActions = [
            {
                signature: "configure(string ticker, uint256 value)",
                inputFields: [
                    {
                        name: "ticker",
                        mode: 2, // TOTEM
                        value: "",
                        description: "The totem ticker",
                        min: 0n,
                        max: 0n,
                        isTotems: false,
                    },
                    {
                        name: "value",
                        mode: 0, // DYNAMIC
                        value: "",
                        description: "Configuration value",
                        min: 1n,
                        max: 100n,
                        isTotems: false,
                    }
                ],
                cost: 0n,
                reason: "Configure the mod before use"
            }
        ];

        // Update required actions
        await market.write.updateRequiredActions([testMod.address, newRequiredActions]);

        // Verify the update
        const updatedActions = await market.read.getModRequiredActions([testMod.address]);
        assert.equal(updatedActions.length, 1, "Should have one required action after update");
        assert.equal(updatedActions[0].signature, "configure(string ticker, uint256 value)", "Signature should match");
        assert.equal(updatedActions[0].reason, "Configure the mod before use", "Reason should match");
        assert.equal(updatedActions[0].inputFields.length, 2, "Should have two input fields");
    });

    it('Should clear required actions when updating with empty array', async function () {
        // Clear required actions by updating with empty array
        await market.write.updateRequiredActions([testMod.address, []]);

        // Verify cleared
        const clearedActions = await market.read.getModRequiredActions([testMod.address]);
        assert.equal(clearedActions.length, 0, "Should have no required actions after clearing");
    });

    it('Should fail to update required actions if not seller', async function () {
        const buyerWallet = await viem.getWalletClient(buyer);
        await assert.rejects(
            async () => {
                await buyerWallet.writeContract({
                    address: market.address,
                    abi: market.abi,
                    functionName: 'updateRequiredActions',
                    args: [
                        testMod.address,
                        [{
                            signature: "hack()",
                            inputFields: [],
                            cost: 0n,
                            reason: "Hacked"
                        }],
                    ],
                });
            },
            /Unauthorized/,
            "Should revert with Unauthorized error"
        );
    });

    it('Should fail to update required actions for non-existent mod', async function () {
        await assert.rejects(
            async () => {
                await market.write.updateRequiredActions([
                    buyer, // non-existent mod address
                    [],
                ]);
            },
            /ModNotFound/,
            "Should revert with ModNotFound error"
        );
    });

    it('Should get multiple mods', async function () {
        const testMod14 = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(
            market,
            seller,
            testMod14.address,
            [2, 3],
            modDetails({
                name: "Another Mod",
                summary: "This is another mod for testing",
                markdown: "## Another Mod\nTesting multiple mods.",
                image: "https://example.com/another.png",
                websiteTickerPath: "/another",
            }),
            [],
            ZERO_ADDRESS,
            500_000n
        );

        const mods = await market.read.getMods([[testMod.address, testMod14.address]]);
        assert(mods.length === 2, "Should return 2 mods");
        assert(mods[0].mod.toLowerCase() === testMod.address.toLowerCase(), "First mod address should match");
        assert(mods[Hook.Mint].mod.toLowerCase() === testMod14.address.toLowerCase(), "Second mod address should match");
    });

    it('Should list mods with pagination', async function () {
        const result = await market.read.listMods([10, 0n]);
        const [mods, nextCursor, hasMore] = result;

        assert(mods.length > 0, "Should return at least one mod");
        assert(typeof nextCursor === 'bigint', "Should return nextCursor");
    });

    it('Should fail to get non-existent mod', async function () {
        await assert.rejects(
            async () => {
                await market.read.getMod([buyer]);
            },
            /ModNotFound/,
            "Should revert with ModNotFound error"
        );
    });

    // ==================== TOTEM CREATION TESTS ====================

    it('Should create a totem without mods', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "TEST",
            4,
            [{ recipient: seller, amount: 1000000n }]
        );

        const totem = await totems.read.getTotem(['TEST']);

        assert(totem.creator.toLowerCase() === seller.toLowerCase(), "Creator should match");
        assert(totem.supply === 1000000n, "Supply should be 1,000,000");
        assert(totem.maxSupply === 1000000n, "Max supply should be 1,000,000");
        assert(totem.details.name === "TEST Totem", "Name should match");
        assert(totem.isActive === true, "Totem should be active");

        const balance = await totems.read.getBalance(['TEST', seller]);
        assert(balance === 1000000n, "Seller should have allocated tokens");
    });

    it('Should create a totem with the test mod', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "MODDED",
            4,
            [{ recipient: seller, amount: 500000n }],
            { transfer: [testMod.address] }
        );

        const totem = await totems.read.getTotem(['MODDED']);

        assert(totem.creator.toLowerCase() === seller.toLowerCase(), "Creator should match");
        assert(totem.mods.transfer.length === 1, "Should have 1 transfer mod");
        assert(totem.mods.transfer[0].toLowerCase() === testMod.address.toLowerCase(), "Transfer mod should match");

        const hasLicense = await totems.read.isLicensed(['MODDED', testMod.address]);
        assert(hasLicense === true, "Mod should be licensed");
    });

    it('Should send mod fee to seller, not mod contract', async function () {
        // Deploy a mod with a specific seller (buyer in this case)
        const modSeller = buyer;
        const feeTestMod = await viem.deployContract("TestMod", [
            totems.address,
            modSeller,
        ]);

        const modPrice = 5_000_000n;
        await publishMod(
            market,
            modSeller,
            feeTestMod.address,
            [Hook.Transfer],
            modDetails({
                name: "Fee Test Mod",
                summary: "A mod to test fee distribution",
            }),
            [],
            ZERO_ADDRESS,
            modPrice
        );

        // Get initial balances
        const initialSellerBalance = await publicClient.getBalance({ address: modSeller });
        const initialModBalance = await publicClient.getBalance({ address: feeTestMod.address });

        // Create a totem using this mod
        await createTotem(
            totems,
            market,
            seller,
            "FEEMOD",
            4,
            [{ recipient: seller, amount: 1000000n }],
            { transfer: [feeTestMod.address] }
        );

        // Verify the seller received the mod fee
        const finalSellerBalance = await publicClient.getBalance({ address: modSeller });
        const finalModBalance = await publicClient.getBalance({ address: feeTestMod.address });

        assert(finalSellerBalance === initialSellerBalance + modPrice, "Mod seller should receive the mod fee");
        assert(finalModBalance === initialModBalance, "Mod contract should NOT receive the fee");
    });

    it('Should fail to create totem with empty ticker', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidTicker/,
            "Should revert with InvalidTicker"
        );
    });

    it('Should fail to create totem with ticker too long', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("TOOLONGTICKER", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidTickerLength/,
            "Should revert with InvalidTickerLength"
        );
    });

    it('Should fail to create totem with invalid ticker character', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("TEST123", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidTickerChar/,
            "Should revert with InvalidTickerChar"
        );
    });

    it('Should fail to create duplicate totem', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("TEST", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /TotemAlreadyExists/,
            "Should revert with TotemAlreadyExists"
        );
    });

    it('Should fail to create totem with name too short', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const seed = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

        await assert.rejects(
            async () => {
                await totems.write.create([
                    {
                        ticker: "SHORT",
                        decimals: 4,
                        name: "AB",
                        description: "This is the SHORT totem.",
                        image: "https://example.com/short.png",
                        website: "https://example.com/short",
                        seed: seed,
                    },
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /NameTooShort/,
            "Should revert with NameTooShort"
        );
    });

    it('Should fail to create totem with name too long', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const seed = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const longName = "A".repeat(33);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    {
                        ticker: "LONG",
                        decimals: 4,
                        name: longName,
                        description: "This is the LONG totem.",
                        image: "https://example.com/long.png",
                        website: "https://example.com/long",
                        seed: seed,
                    },
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /NameTooLong/,
            "Should revert with NameTooLong"
        );
    });

    it('Should fail to create totem with description too long', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const seed = '0x1111111111111111111111111111111111111111111111111111111111111111';
        const longDesc = "A".repeat(501);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    {
                        ticker: "DESC",
                        decimals: 4,
                        name: "DESC Totem",
                        description: longDesc,
                        image: "https://example.com/desc.png",
                        website: "https://example.com/desc",
                        seed: seed,
                    },
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /DescriptionTooLong/,
            "Should revert with DescriptionTooLong"
        );
    });

    it('Should fail to create totem with empty image', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const seed = '0x2222222222222222222222222222222222222222222222222222222222222222';

        await assert.rejects(
            async () => {
                await totems.write.create([
                    {
                        ticker: "NOIMG",
                        decimals: 4,
                        name: "NOIMG Totem",
                        description: "This is the NOIMG totem.",
                        image: "",
                        website: "https://example.com/noimg",
                        seed: seed,
                    },
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /EmptyImage/,
            "Should revert with EmptyImage"
        );
    });

    it('Should fail to create totem with ZERO_ADDRESS seed', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    {
                        ticker: "NOSEED",
                        decimals: 4,
                        name: "NOSEED Totem",
                        description: "This is the NOSEED totem.",
                        image: "https://example.com/noseed.png",
                        website: "https://example.com/noseed",
                        seed: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    },
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidSeed/,
            "Should revert with InvalidSeed"
        );
    });

    it('Should fail to create totem with ZERO_ADDRESS supply', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("ZERO", 4),
                    [],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /ZeroSupply/,
            "Should revert with ZeroSupply"
        );
    });

    it('Should fail to create totem with allocation to ZERO_ADDRESS address', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("ZEROADDR", 4),
                    [{
                        label: "",
                        recipient: ZERO_ADDRESS, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /InvalidAllocation/,
            "Should revert with InvalidAllocation"
        );
    });

    it('Should fail to create totem with insufficient fee', async function () {
        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("NOFEE", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: 1000n, account: seller });
            },
            /InsufficientFee/,
            "Should revert with InsufficientFee"
        );
    });

    it('Should fail to create totem with too many allocations', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const tooManyAllocations = Array(51).fill({
            label: "",
            recipient: seller, amount: 100n, isMinter: false });

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("MANY", 4),
                    tooManyAllocations,
                    { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
                    ZERO_ADDRESS,
                ], { value: baseFee, account: seller });
            },
            /TooManyAllocations/,
            "Should revert with TooManyAllocations"
        );
    });

    it('Should fail to create totem with mod that doesnt support hook', async function () {
        // insert new mod with only transfer hook
        const _testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(
            market,
            seller,
            _testMod.address,
            [Hook.Mint], // only transfer hook
            modDetails({
                name: "Another Test Mod",
                summary: "This is another test mod",
                markdown: "## Another Test Mod\nThis is another test mod.",
            })
        );

        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const modFee = await market.read.getModFee([_testMod.address]);
        const totalFee = baseFee + modFee;

        await assert.rejects(
            async () => {
                await totems.write.create([
                    totemDetails("BADHOOK", 4),
                    [{
                        label: "",
                        recipient: seller, amount: 1000n, isMinter: false }],
                    {
                        transfer: [],
                        mint: [],
                        burn: [],
                        created: [_testMod.address],
                        transferOwnership: [],
                    },
                    ZERO_ADDRESS,
                ], { value: totalFee, account: seller });
            },
            /ModDoesntSupportHook/,
            "Should revert with ModDoesntSupportHook"
        );
    });

    it('Should create totem with multiple allocations', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "MULTI",
            4,
            [
                { recipient: seller, amount: 500000n },
                { recipient: buyer, amount: 300000n },
                { recipient: referrer, amount: 200000n },
            ]
        );

        const totem = await totems.read.getTotem(['MULTI']);

        assert(totem.supply === 1000000n, "Total supply should be 1,000,000");

        const sellerBalance = await totems.read.getBalance(['MULTI', seller]);
        const buyerBalance = await totems.read.getBalance(['MULTI', buyer]);
        const referrerBalance = await totems.read.getBalance(['MULTI', referrer]);

        assert(sellerBalance === 500000n, "Seller balance should match");
        assert(buyerBalance === 300000n, "Buyer balance should match");
        assert(referrerBalance === 200000n, "Referrer balance should match");

        const stats = await totems.read.getStats(['MULTI']);
        assert(stats.holders === 3n, "Should have 3 holders");
        assert(stats.mints === 3n, "Should have 3 mints");
    });

    it('Should create totem with referrer and distribute fees', async function () {
        const baseFee = await totems.read.getFee([referrer]);
        const initialReferrerBalance = await publicClient.getBalance({ address: referrer });

        await createTotem(
            totems,
            market,
            seller,
            "REFER",
            4,
            [{ recipient: seller, amount: 1000000n }],
            undefined,
            referrer
        );

        const finalReferrerBalance = await publicClient.getBalance({ address: referrer });
        const expectedReferrerPayment = baseFee - BURNED_FEE;
        assert(finalReferrerBalance === initialReferrerBalance + expectedReferrerPayment, "Referrer should receive base fee minus burned fee");
    });

    it('Should normalize ticker to uppercase', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "lowercase",
            4,
            [{ recipient: seller, amount: 1000000n }]
        );

        const lowercaseHash = await totems.read.tickerToBytes(['lowercase']);
        const uppercaseHash = await totems.read.tickerToBytes(['LOWERCASE']);

        assert(lowercaseHash === uppercaseHash, "Ticker hashes should match regardless of case");

        const totem = await totems.read.getTotem(['lowercase']);
        assert(totem.creator.toLowerCase() === seller.toLowerCase(), "Totem should exist");
    });

    it('Should refund excess payment', async function () {
        const baseFee = await totems.read.getFee([ZERO_ADDRESS]);
        const excessPayment = baseFee * 2n;

        const initialBalance = await publicClient.getBalance({ address: seller });

        const tx = await totems.write.create([
            totemDetails("REFUND", 4),
            [{
                label: "",
                recipient: seller, amount: 1000000n, isMinter: false }],
            { transfer: [], mint: [], burn: [], created: [], transferOwnership: [] },
            ZERO_ADDRESS,
        ], { value: excessPayment, account: seller });

        const receipt = await publicClient.getTransactionReceipt({ hash: tx });
        const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
        const finalBalance = await publicClient.getBalance({ address: seller });

        const expectedBalance = initialBalance - baseFee - gasUsed;
        assert(finalBalance === expectedBalance, "Should refund excess payment");
    });
});