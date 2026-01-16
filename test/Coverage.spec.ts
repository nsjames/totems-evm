import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, stringToBytes } from "viem";
import {
    addMod,
    createTotem,
    Hook,
    modDetails,
    publishMod,
    setupTotemsTest,
    transfer,
    transferOwnership,
    ZERO_ADDRESS,
    expectCustomError,
    expectRevertMessage,
    ErrorSelectors,
} from "./helpers.ts";

// Helper to compute tickerBytes the same way Shared.normalizeTicker does
function computeTickerBytes(ticker: string): `0x${string}` {
    const normalized = ticker.toUpperCase();
    return keccak256(stringToBytes(normalized));
}

describe("Coverage Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts,
        proxyMod,
        proxyModSeller,
    } = await setupTotemsTest();
    const [deployer, seller, buyer, spender] = accounts;

    let testMod: any;
    let erc20Factory: any;
    let erc20Relay: any;

    // ========== Setup ==========

    it('Should setup test environment', async function () {
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, testMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer, Hook.TransferOwnership], modDetails({
            isMinter: true
        }));

        await publishMod(market, proxyModSeller, proxyMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true
        }));

        erc20Factory = await viem.deployContract("TotemERC20Factory", [
            totems.address,
        ]);
    });

    // ========== Totems Storage Getters ==========

    it('Should access public storage getters', async function () {
        // Create a totem first
        await createTotem(totems, market, seller, "STORE", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        // Test storage getter routes
        const marketAddr = await totems.read.marketContract();
        assert.ok(marketAddr);

        const proxyModAddr = await totems.read.getProxyMod();
        assert.ok(proxyModAddr);
    });

    // ========== ProxyMod.removeMod ==========

    it('Should add and remove mod via ProxyMod', async function () {
        await createTotem(totems, market, seller, "RMMOD", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
            mint: [proxyMod.address],
            burn: [proxyMod.address],
        });

        // Add a mod through proxy
        await addMod(proxyMod, totems, market, "RMMOD", [Hook.Mint, Hook.Burn, Hook.Transfer], testMod.address, seller);

        // Remove the mod - this covers lines 109-119, 307-312, 320-335
        await proxyMod.write.removeMod(["RMMOD", testMod.address], { account: seller });
    });

    it('Should fail to remove mod if not creator', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.removeMod(["RMMOD", testMod.address], { account: buyer });
        }, /Only totem creator/);
    });

    // ========== ProxyMod.addMod with already licensed mod (NoFeeRequired) ==========

    it('Should fail to add mod with fee when already licensed', async function () {
        await createTotem(totems, market, seller, "NOFEE", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
            mint: [proxyMod.address],
            burn: [proxyMod.address],
        });

        // Add mod first time with fee
        await addMod(proxyMod, totems, market, "NOFEE", [Hook.Mint], testMod.address, seller);

        // Try to add again with fee - should revert with NoFeeRequired
        const modFee = await market.read.getModFee([testMod.address]);
        const referrerFee = await totems.read.getFee([ZERO_ADDRESS]);
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["NOFEE", [Hook.Burn], testMod.address, ZERO_ADDRESS], { account: seller, value: modFee + referrerFee });
        }, /NoFeeRequired/);

        // Adding without fee should work (adds to different hook)
        await proxyMod.write.addMod(["NOFEE", [Hook.Burn], testMod.address, ZERO_ADDRESS], { account: seller });
    });

    // ========== ProxyMod._hexCharToByte with invalid character (line 279) ==========

    it('Should fail to mint with invalid hex in memo', async function () {
        await createTotem(totems, market, seller, "HEXTEST", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            mint: [proxyMod.address],
        });

        // Invalid hex character in address (Z is not valid hex)
        await assert.rejects(async () => {
            await totems.write.mint([
                proxyMod.address,
                seller,
                "HEXTEST",
                100n,
                "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
            ], { account: seller });
        }, /InvalidHexCharacter/);
    });

    // ========== TotemERC20 increaseAllowance/decreaseAllowance (lines 140-157) ==========

    it('Should test increaseAllowance and decreaseAllowance', async function () {
        await createTotem(totems, market, seller, "ALLOW", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        // Create ERC20 relay
        await totems.write.createRelay([
            "ALLOW",
            erc20Factory.address,
            "ERC20",
        ], { account: seller });

        const relays = await totems.read.getRelays(["ALLOW"]);
        erc20Relay = await viem.getContractAt("TotemERC20", relays[0].relay);

        // Set initial allowance
        await erc20Relay.write.approve([spender, 1000n], { account: seller });
        let allowance = await erc20Relay.read.allowance([seller, spender]);
        assert.equal(allowance, 1000n);

        // Increase allowance - covers lines 140-143
        await erc20Relay.write.increaseAllowance([spender, 500n], { account: seller });
        allowance = await erc20Relay.read.allowance([seller, spender]);
        assert.equal(allowance, 1500n);

        // Decrease allowance - covers lines 150-157
        await erc20Relay.write.decreaseAllowance([spender, 300n], { account: seller });
        allowance = await erc20Relay.read.allowance([seller, spender]);
        assert.equal(allowance, 1200n);
    });

    it('Should fail decreaseAllowance below zero', async function () {
        await assert.rejects(async () => {
            await erc20Relay.write.decreaseAllowance([spender, 2000n], { account: seller });
        }, /decreased allowance below zero/);
    });

    // ========== ProxyMod._pushModToHook with Created hook (revert) ==========

    it('Should fail to add mod with Created hook via addMod', async function () {
        await createTotem(totems, market, seller, "CREATED", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
        });

        // Hook 0 is Created - should revert with CantUseCreatedHook
        await assert.rejects(async () => {
            await addMod(proxyMod, totems, market, "CREATED", [Hook.Created], testMod.address, seller);
        }, /CantUseCreatedHook/);
    });

    // ========== Unknown function call ==========

    it('Should fail when calling unknown function', async function () {
        // Try calling a non-existent function
        const unknownFunctionData = "0x12345678"; // Random function selector

        let reverted = false;
        try {
            await publicClient.call({
                to: totems.address,
                data: unknownFunctionData,
            });
        } catch (e) {
            reverted = true;
        }
        assert.ok(reverted, "Expected call to revert for unknown function");
    });

    // ========== Test skipping already enabled mods ==========

    it('Should skip adding mod to hook if already enabled', async function () {
        await createTotem(totems, market, seller, "SKIP", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
        });

        await addMod(proxyMod, totems, market, "SKIP", [Hook.Mint, Hook.Burn], testMod.address, seller);

        // Add same mod to same hooks again - should skip without error
        await proxyMod.write.addMod(["SKIP", [Hook.Mint, Hook.Burn], testMod.address, ZERO_ADDRESS], { account: seller });
    });

    // ========== Test removing mod that's not enabled ==========

    it('Should handle removing mod that was never added', async function () {
        await createTotem(totems, market, seller, "NOTADD", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
        });

        // Get totem state before
        const totemBefore = await totems.read.getTotem(["NOTADD"]);
        const isLicensedBefore = await totems.read.isLicensed(["NOTADD", testMod.address]);

        // Remove a mod that was never added - should not revert
        await proxyMod.write.removeMod(["NOTADD", testMod.address], { account: seller });

        // Verify state is unchanged
        const totemAfter = await totems.read.getTotem(["NOTADD"]);
        const isLicensedAfter = await totems.read.isLicensed(["NOTADD", testMod.address]);

        assert.equal(isLicensedBefore, false, "Mod should not be licensed before");
        assert.equal(isLicensedAfter, false, "Mod should not be licensed after");
        assert.equal(totemBefore.mods.transfer.length, totemAfter.mods.transfer.length, "Transfer mods should be unchanged");
    });

    // ========== Ticker validation edge cases ==========

    it('Should fail with empty ticker', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerLength/);
    });

    it('Should fail with ticker longer than 10 characters', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "ABCDEFGHIJK", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerLength/);
    });

    it('Should fail with ticker containing numbers', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "TEST123", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerChar/);
    });

    it('Should fail with ticker containing special characters', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "TEST!", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerChar/);
    });

    it('Should fail with ticker containing char above Z', async function () {
        // '[' is 0x5B, just above 'Z' (0x5A) - hits c > 0x5A branch
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "TEST[", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerChar/);
    });

    it('Should fail ProxyMod with char above Z', async function () {
        // Test through TotemsLibrary.tickerToBytes path
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["TEST]", [Hook.Mint], testMod.address, ZERO_ADDRESS], { account: seller });
        }, /InvalidTickerChar/);
    });

    it('Should fail with ticker containing spaces', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "TE ST", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerChar/);
    });

    it('Should fail with ticker containing unicode', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "TEST™", 18, [
                { recipient: seller, amount: 1000000n },
            ]);
        }, /InvalidTickerChar/);
    });

    // Test TotemsLibrary.tickerToBytes validation via ProxyMod
    it('Should fail ProxyMod.addMod with empty ticker', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["", [Hook.Mint], testMod.address, ZERO_ADDRESS], { account: seller });
        }, /InvalidTickerLength/);
    });

    it('Should fail ProxyMod.addMod with ticker too long', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["ABCDEFGHIJK", [Hook.Mint], testMod.address, ZERO_ADDRESS], { account: seller });
        }, /InvalidTickerLength/);
    });

    it('Should fail ProxyMod.addMod with invalid ticker char', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["TEST123", [Hook.Mint], testMod.address, ZERO_ADDRESS], { account: seller });
        }, /InvalidTickerChar/);
    });

    it('Should fail ProxyMod.removeMod with invalid ticker', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.removeMod(["TEST!", testMod.address], { account: seller });
        }, /InvalidTickerChar/);
    });

    // Test lowercase ticker normalization in TotemsLibrary.tickerToBytes
    it('Should normalize lowercase ticker in ProxyMod', async function () {
        // Create totem with uppercase ticker
        await createTotem(totems, market, seller, "LCASE", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
        });

        // Add mod using lowercase ticker - should normalize and work
        await addMod(proxyMod, totems, market, "lcase", [Hook.Mint], testMod.address, seller);

        // Remove mod using mixed case - should also work
        await proxyMod.write.removeMod(["LcAsE", testMod.address], { account: seller });
    });

    // ========== onlyTotems modifier tests ==========

    it('Should fail to call ProxyMod.onTransfer directly', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.onTransfer([
                "TEST",
                seller,
                buyer,
                100n,
                "direct call"
            ], { account: seller });
        }, /Only Totems contract/);
    });

    it('Should fail to call ProxyMod.onMint directly', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.onMint([
                "TEST",
                seller,
                100n,
                0n,
                "direct call"
            ], { account: seller });
        }, /Only Totems contract/);
    });

    it('Should fail to call ProxyMod.onBurn directly', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.onBurn([
                "TEST",
                seller,
                100n,
                "direct call"
            ], { account: seller });
        }, /Only Totems contract/);
    });

    it('Should fail to call ProxyMod.mint directly', async function () {
        await assert.rejects(async () => {
            await proxyMod.write.mint([
                "TEST",
                seller,
                100n,
                "direct call"
            ], { account: seller });
        }, /Only Totems contract/);
    });

    it('Should fail to call TestMod hooks directly', async function () {
        // TestMod uses TotemMod base which throws InvalidModEventOrigin
        await expectCustomError(
            testMod.write.onTransfer(["TEST", seller, buyer, 100n, "direct call"], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );

        await expectCustomError(
            testMod.write.onMint(["TEST", seller, 100n, 0n, "direct call"], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );

        await expectCustomError(
            testMod.write.onBurn(["TEST", seller, 100n, "direct call"], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );

        await expectCustomError(
            testMod.write.onCreated(["TEST", seller], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );

        await expectCustomError(
            testMod.write.mint(["TEST", seller, 100n, "direct call"], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );
    });

    // ========== TotemsLibrary helper functions ==========

    it('Should test TotemsLibrary.getBalance helper', async function () {
        const coverageMod = await viem.deployContract("CoverageMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, coverageMod.address, [1, 2, 3], modDetails({
            name: "Coverage Mod",
        }));

        await createTotem(totems, market, seller, "LIBTEST", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: coverageMod.address, amount: 5000n },
        ], {
            transfer: [coverageMod.address],
            mint: [coverageMod.address],
            burn: [coverageMod.address],
        });

        // Call checkBalance which uses TotemsLibrary.getBalance
        await coverageMod.write.checkBalance(["LIBTEST"]);
        const lastBalance = await coverageMod.read.lastBalance();
        assert.equal(lastBalance, 5000n);
    });

    it('Should test TotemsLibrary.getTotem helper', async function () {
        const coverageMod = await viem.deployContract("CoverageMod", [
            totems.address,
            seller,
        ]);

        // Call checkTotem which uses TotemsLibrary.getTotem
        await coverageMod.write.checkTotem(["LIBTEST"]);
        const lastCreator = await coverageMod.read.lastCreator();
        const lastSupply = await coverageMod.read.lastSupply();

        assert.equal(lastCreator.toLowerCase(), seller.toLowerCase());
        assert.equal(lastSupply, 1005000n);
    });

    it('Should test TotemsLibrary.getTotemStats helper', async function () {
        const coverageMod = await viem.deployContract("CoverageMod", [
            totems.address,
            seller,
        ]);

        // Call checkStats which uses TotemsLibrary.getTotemStats
        await coverageMod.write.checkStats(["LIBTEST"]);
        const lastHolders = await coverageMod.read.lastHolders();

        assert.ok(lastHolders > 0n);
    });

    it('Should test TotemsLibrary.transfer helper', async function () {
        const coverageMod = await viem.deployContract("CoverageMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, coverageMod.address, [1, 2, 3], modDetails({
            name: "Coverage Mod 2",
        }));

        await createTotem(totems, market, seller, "LIBTX", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: coverageMod.address, amount: 5000n },
        ], {
            transfer: [coverageMod.address],
        });

        const buyerBalanceBefore = await totems.read.getBalance(["LIBTX", buyer]);

        // Call doTransfer which uses TotemsLibrary.transfer
        await coverageMod.write.doTransfer(["LIBTX", buyer, 1000n]);

        const buyerBalanceAfter = await totems.read.getBalance(["LIBTX", buyer]);
        assert.equal(buyerBalanceAfter, buyerBalanceBefore + 1000n);
    });

    // ========== Totems.addRelay ==========

    it('Should add relay manually via addRelay', async function () {
        await createTotem(totems, market, seller, "RELAY", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        // Deploy a mock relay contract (using ERC20 as example)
        const mockRelay = await viem.deployContract("TotemERC20", [
            totems.address,
            "RELAY",
        ]);

        // Add relay using addRelay instead of createRelay
        await totems.write.addRelay([
            "RELAY",
            mockRelay.address,
            "CUSTOM",
        ], { account: seller });

        const relays = await totems.read.getRelays(["RELAY"]);
        assert.equal(relays.length, 1);
        assert.equal(relays[0].standard, "CUSTOM");
        assert.equal(relays[0].relay.toLowerCase(), mockRelay.address.toLowerCase());
    });

    it('Should fail to add relay if not creator', async function () {
        const mockRelay = await viem.deployContract("TotemERC20", [
            totems.address,
            "RELAY",
        ]);

        await assert.rejects(async () => {
            await totems.write.addRelay([
                "RELAY",
                mockRelay.address,
                "CUSTOM2",
            ], { account: buyer });
        }, /Unauthorized/);
    });

    // ========== Totems._storeLicense revert when no totem ==========

    it('Should fail to set license for non-existent totem', async function () {
        // Try to set license through proxyMod for a totem that doesn't exist
        // This requires calling setLicenseFromProxy on a non-existent ticker
        // The proxyMod.addMod calls totems.setLicenseFromProxy internally

        // Create a new mod but don't create the totem
        const newMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, newMod.address, [1, 2, 3], modDetails({
            name: "New Test Mod",
            isMinter: true
        }));

        // Try to add mod to non-existent totem - should fail because totem doesn't exist
        await assert.rejects(async () => {
            await addMod(proxyMod, totems, market, "NOEXIST", [Hook.Mint], newMod.address, seller);
        }, /TotemNotFound|revert/);
    });

    // ========== Totems coverage tests ==========

    // Test setLicenseFromProxy called by non-proxyMod
    it('Should fail setLicenseFromProxy from non-proxyMod address', async function () {
        // Create a totem first
        await createTotem(totems, market, seller, "LICTEST", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        // Call setLicenseFromProxy directly (not through proxyMod) - should fail
        const tickerBytes = computeTickerBytes("LICTEST");

        // Use writeContract with ABI fragment since setLicenseFromProxy isn't in ITotems
        const walletClient = await viem.getWalletClient(seller);
        await assert.rejects(async () => {
            await walletClient.writeContract({
                address: totems.address,
                abi: [{
                    name: 'setLicenseFromProxy',
                    type: 'function',
                    inputs: [
                        { name: 'tickerBytes', type: 'bytes32' },
                        { name: 'mod', type: 'address' }
                    ],
                    outputs: [],
                    stateMutability: 'nonpayable'
                }],
                functionName: 'setLicenseFromProxy',
                args: [tickerBytes, testMod.address],
                account: seller,
            });
        }, /Unauthorized/);
    });

    // Test setLicenseFromProxy for non-existent totem (lines 167-169)
    // Note: This path is already tested via proxyMod.addMod for non-existent totem above
    // The CantSetLicense error is thrown when totem.creator == address(0)

    // Test creating totem with too many mods (lines 188-190)
    it('Should fail to create totem with too many mods', async function () {
        // Create array with 201 mods (exceeds 200 limit)
        const manyMods = Array(51).fill(testMod.address);

        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "MANYMOD", 18, [
                { recipient: seller, amount: 1000000n },
            ], {
                transfer: manyMods,
                mint: manyMods,
                burn: manyMods,
                created: manyMods,
            });
        }, /TooManyMods/);
    });

    // Test allocation with mod that is NOT a minter (lines 223-225)
    it('Should fail allocation to mod that is not a minter', async function () {
        // Create a mod that is NOT a minter
        const nonMinterMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, nonMinterMod.address, [1, 2, 3], modDetails({
            name: "Non Minter Mod",
            isMinter: false,  // Not a minter
        }));

        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "NOTMINT", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: nonMinterMod.address, amount: 1000n, isMinter: true },  // Mark as minter but mod isn't
            ]);
        }, /ModNotMinter/);
    });

    // Test unlimited minting with mod that doesn't support it (lines 227-229)
    it('Should fail unlimited allocation to mod that doesnt support it', async function () {
        // Create a mod that is a minter but doesn't support unlimited
        const limitedMinterMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, limitedMinterMod.address, [1, 2, 3], modDetails({
            name: "Limited Minter Mod",
            isMinter: true,
            needsUnlimited: false,  // Doesn't support unlimited
        }));

        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "NOUNLIM", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: limitedMinterMod.address, amount: 0n, isMinter: true },  // Zero amount = unlimited
            ]);
        }, /ModMustSupportUnlimitedMinting/);
    });

    // Test non-minter allocation with zero amount (lines 239-241)
    it('Should fail non-minter allocation with zero amount', async function () {
        await assert.rejects(async () => {
            await createTotem(totems, market, seller, "ZEROALL", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: buyer, amount: 0n, isMinter: false },  // Zero to non-minter
            ]);
        }, /InvalidAllocation/);
    });

    // Test created hooks (lines 353-366)
    // Note: Lines 359-363 (proxyMod skip) require proxyMod to support Created hook,
    // but proxyMod is published with hooks [1,2,3] = Mint,Burn,Transfer (not Created=0).
    // This skip logic is defensive code for edge cases.
    it('Should process created hooks successfully', async function () {
        // Create totem with testMod in created hooks
        await createTotem(totems, market, seller, "CREDHK", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: testMod.address, amount: 1000n, isMinter: true },
        ], {
            created: [testMod.address],
            transfer: [testMod.address],
        });

        // If we get here, created hooks were processed successfully
        const balance = await totems.read.getBalance(["CREDHK", seller]);
        assert.equal(balance, 1000000n);
    });

    // ========== ProxyMod skip in created hooks (lines 769-771) ==========

    it('Should skip proxyMod in _notifyCreatedHooks', async function () {
        // Create totem with proxyMod in created hooks
        // The _notifyCreatedHooks function should skip calling onCreated on proxyMod
        await createTotem(totems, market, seller, "PXYSKP", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            created: [proxyMod.address, testMod.address], // proxyMod should be skipped
            transfer: [proxyMod.address],
        });

        // If we get here without error, the skip worked correctly
        // (proxyMod's onCreated was not called, which would have caused issues)
        const balance = await totems.read.getBalance(["PXYSKP", seller]);
        assert.equal(balance, 1000000n);
    });

    // ========== Totems view coverage tests ==========

    // Test getTotems with multiple tickers (lines 37-44)
    it('Should get multiple totems with getTotems', async function () {
        // Create two totems
        await createTotem(totems, market, seller, "VIEWA", 18, [
            { recipient: seller, amount: 1000000n },
        ]);
        await createTotem(totems, market, seller, "VIEWB", 18, [
            { recipient: seller, amount: 2000000n },
        ]);

        // Get both totems at once
        const results = await totems.read.getTotems([["VIEWA", "VIEWB"]]);
        assert.equal(results.length, 2);
        assert.equal(results[0].details.ticker, "VIEWA");
        assert.equal(results[1].details.ticker, "VIEWB");
    });

    // Test getTotems with non-existent totem (lines 40-42)
    it('Should fail getTotems with non-existent totem', async function () {
        await assert.rejects(async () => {
            await totems.read.getTotems([["VIEWA", "NONEXIST"]]);
        }, /TotemNotFound/);
    });

    // Test getRelayOfStandard with matching relay (lines 110-114)
    it('Should get relay of specific standard', async function () {
        // Create totem and add relay
        await createTotem(totems, market, seller, "RELSTD", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        const mockRelay = await viem.deployContract("TotemERC20", [
            totems.address,
            "RELSTD",
        ]);

        await totems.write.addRelay([
            "RELSTD",
            mockRelay.address,
            "ERC20",
        ], { account: seller });

        // Get relay by standard
        const relay = await totems.read.getRelayOfStandard(["RELSTD", "ERC20"]);
        assert.equal(relay.toLowerCase(), mockRelay.address.toLowerCase());
    });

    // Test getRelayOfStandard with no matching relay (returns address(0))
    it('Should return zero address for non-existent relay standard', async function () {
        // Use existing totem from previous test
        const relay = await totems.read.getRelayOfStandard(["RELSTD", "ERC721"]);
        assert.equal(relay, ZERO_ADDRESS);
    });

    // ========== TotemERC20Factory coverage tests (lines 31-33) ==========

    // Test createRelay called directly (not through proxy) - should fail
    it('Should fail TotemERC20Factory.createRelay from non-proxy address', async function () {
        await assert.rejects(async () => {
            await erc20Factory.write.createRelay(["TEST"], { account: seller });
        }, /Unauthorized/);
    });

    // ========== Raw storage getter tests ==========

    it('Should access totemList(uint256) storage getter', async function () {
        const result = await publicClient.readContract({
            address: totems.address,
            abi: [{
                name: 'totemList',
                type: 'function',
                inputs: [{ name: '', type: 'uint256' }],
                outputs: [{ name: '', type: 'bytes32' }],
                stateMutability: 'view'
            }],
            functionName: 'totemList',
            args: [0n]
        });
        assert.ok(result);
    });

    // ========== Additional Coverage Tests ==========

    // Test ModMarket.getModFee for non-existent mod
    it('Should fail getModFee for non-existent mod', async function () {
        const randomAddress = '0x1234567890123456789012345678901234567890';
        await assert.rejects(async () => {
            await market.read.getModFee([randomAddress]);
        }, /ModNotFound/);
    });

    // Test ModMarket.getModsFee with non-existent mod
    it('Should fail getModsFee with non-existent mod in array', async function () {
        const randomAddress = '0x1234567890123456789012345678901234567890';
        await assert.rejects(async () => {
            await market.read.getModsFee([[testMod.address, randomAddress]]);
        }, /ModNotFound/);
    });

    // Test ModMarket.getSupportedHooks for non-existent mod
    it('Should fail getSupportedHooks for non-existent mod', async function () {
        const randomAddress = '0x1234567890123456789012345678901234567890';
        await assert.rejects(async () => {
            await market.read.getSupportedHooks([randomAddress]);
        }, /ModNotFound/);
    });

    // Test publishing mod with EOA address (no code)
    it('Should fail to publish mod with EOA address', async function () {
        const fee = await market.read.getFee([ZERO_ADDRESS]);
        await assert.rejects(async () => {
            await market.write.publish([
                seller, // EOA, not a contract
                [Hook.Mint],
                1000000n,
                {
                    name: "Test Mod",
                    summary: "A test mod for coverage",
                    markdown: "## Test",
                    image: "https://example.com/image.png",
                    website: "https://example.com",
                    websiteTickerPath: "/token/{ticker}",
                    isMinter: false,
                    needsUnlimited: false,
                },
                [],
                ZERO_ADDRESS,
            ], { value: fee, account: seller });
        }, /InvalidContractAddress/);
    });

    // Test ProxyMod.mint with mod not enabled for mint hook
    it('Should fail ProxyMod.mint when mod not enabled for Mint hook', async function () {
        // Create totem with proxyMod as minter but don't add testMod to mint hook
        await createTotem(totems, market, seller, "NOMINT", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            mint: [proxyMod.address],
            transfer: [proxyMod.address],
        });

        // Try to mint through proxy with testMod address in memo
        // testMod is not added to this totem's mint hooks through proxyMod
        await assert.rejects(async () => {
            await totems.write.mint([
                proxyMod.address,
                seller,
                "NOMINT",
                100n,
                testMod.address,
            ], { account: seller });
        }, /ModNotEnabledForMint/);
    });

    // Test uppercase hex in address parsing (A-F range)
    it('Should parse uppercase hex in mod address for mint', async function () {
        await createTotem(totems, market, seller, "HEXUP", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: proxyMod.address, amount: 1000n, isMinter: true },
        ], {
            mint: [proxyMod.address],
        });

        // Add testMod through proxy
        await addMod(proxyMod, totems, market, "HEXUP", [Hook.Mint], testMod.address, seller);

        // Transfer tokens to testMod so it can mint
        await transfer(totems, "HEXUP", seller, testMod.address, 500n, "funding");

        // Convert address to uppercase hex
        const upperAddr = testMod.address.toUpperCase();

        // Mint using uppercase hex address
        await totems.write.mint([
            proxyMod.address,
            seller,
            "HEXUP",
            100n,
            upperAddr,
        ], { account: seller });
    });

    // Test burning all tokens reduces holder count
    it('Should reduce holder count when burning all tokens', async function () {
        await createTotem(totems, market, seller, "BURNALL", 18, [
            { recipient: seller, amount: 1000n },
            { recipient: buyer, amount: 500n },
        ]);

        const statsBefore = await totems.read.getStats(["BURNALL"]);
        assert.equal(statsBefore.holders, 2n);

        // Burn all of buyer's tokens
        await totems.write.burn(["BURNALL", buyer, 500n, "burn all"], { account: buyer });

        const statsAfter = await totems.read.getStats(["BURNALL"]);
        assert.equal(statsAfter.holders, 1n);
    });

    // Test TestMod.onMint revert path (line 44)
    // This tests the onMint hook revert, not the mint() function revert
    it('Should fail onMint hook when shouldRevert is true', async function () {
        // Deploy a separate MinterMod to do the actual minting
        const onMintTestMinter = await viem.deployContract("MinterMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, onMintTestMinter.address, [Hook.Created, Hook.Mint, Hook.Transfer], modDetails({
            name: "OnMint Test Minter",
            isMinter: true,
        }));

        // Create totem with:
        // - onMintTestMinter as minter allocation AND in created hook (for licensing)
        // - testMod in mint hooks (will call onMint)
        await createTotem(totems, market, seller, "MINTRVT", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: onMintTestMinter.address, amount: 1000n, isMinter: true },
        ], {
            created: [onMintTestMinter.address],  // License the minter
            mint: [testMod.address],  // testMod as mint hook - onMint will be called
        });

        // Transfer tokens to minter so it can mint
        await transfer(totems, "MINTRVT", seller, onMintTestMinter.address, 500n, "funding");

        // Toggle testMod to revert
        await testMod.write.toggle([true]);

        // Mint through onMintTestMinter - it succeeds, then testMod.onMint() is called and reverts
        await assert.rejects(async () => {
            await totems.write.mint([
                onMintTestMinter.address,
                seller,
                "MINTRVT",
                100n,
                "test",
            ], { account: seller });
        }, /Not supported/);

        // Reset toggle
        await testMod.write.toggle([false]);
    });

    // Test onlyTotems modifier - direct calls fail with InvalidModEventOrigin
    it('Should fail mod hook when called directly (not from Totems)', async function () {
        // Deploy a new mod
        const directCallMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        // Publish it so it can be used
        await publishMod(market, seller, directCallMod.address, [Hook.Transfer], modDetails({
            name: "Direct Call Mod",
        }));

        // Try to call onTransfer directly - should fail with InvalidModEventOrigin
        // (onlyTotems modifier is checked before onlyLicensed)
        await expectCustomError(
            directCallMod.write.onTransfer(["TEST", seller, buyer, 100n, "test"], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );
    });

    // ========== TotemMod modifier coverage tests ==========

    it('Should fail MinerMod.setup when caller is not creator (onlyCreator)', async function () {
        const minerMod = await viem.deployContract("MinerMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, minerMod.address, [Hook.Created, Hook.Mint, Hook.Transfer], modDetails({
            name: "Miner Mod",
            isMinter: true,
        }));

        // Create totem with minerMod
        await createTotem(totems, market, seller, "MINER", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: minerMod.address, amount: 10000n, isMinter: true },
        ], {
            created: [minerMod.address],
            transfer: [minerMod.address],
            mint: [minerMod.address],
        });

        // Non-creator (buyer) tries to call setup - should fail with "Only totem creator"
        await expectRevertMessage(
            minerMod.write.setup(["MINER", 100n, 1000n], { account: buyer }),
            "Only totem creator"
        );
    });

    it('Should fail MinerMod.setup when mod is not licensed (onlyLicensed)', async function () {
        const minerMod = await viem.deployContract("MinerMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, minerMod.address, [Hook.Created, Hook.Mint, Hook.Transfer], modDetails({
            name: "Miner Mod 2",
            isMinter: true,
        }));

        // Create totem WITHOUT minerMod (so it's not licensed)
        await createTotem(totems, market, seller, "MNOLIC", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        // Creator tries to call setup but minerMod is not licensed for this totem
        await expectCustomError(
            minerMod.write.setup(["MNOLIC", 100n, 1000n], { account: seller }),
            ErrorSelectors.NotLicensed,
            "NotLicensed"
        );
    });

    // ========== TransferOwnership Coverage Tests ==========

    it('Should transfer ownership successfully', async function () {
        await createTotem(totems, market, seller, "TXOWN", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        const totemBefore = await totems.read.getTotem(["TXOWN"]);
        assert.equal(totemBefore.creator.toLowerCase(), seller.toLowerCase());

        await transferOwnership(totems, "TXOWN", seller, buyer);

        const totemAfter = await totems.read.getTotem(["TXOWN"]);
        assert.equal(totemAfter.creator.toLowerCase(), buyer.toLowerCase());
    });

    it('Should fail transferOwnership to zero address', async function () {
        await createTotem(totems, market, seller, "TXZERO", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        await assert.rejects(async () => {
            await transferOwnership(totems, "TXZERO", seller, ZERO_ADDRESS);
        }, /New owner cannot be zero address/);
    });

    it('Should fail transferOwnership from non-owner', async function () {
        await createTotem(totems, market, seller, "TXAUTH", 18, [
            { recipient: seller, amount: 1000000n },
        ]);

        await assert.rejects(async () => {
            await transferOwnership(totems, "TXAUTH", buyer, spender);
        }, /Unauthorized/);
    });

    it('Should fail transferOwnership for non-existent totem', async function () {
        await assert.rejects(async () => {
            await transferOwnership(totems, "NOEXIST", seller, buyer);
        }, /TotemNotFound/);
    });

    it('Should call onTransferOwnership hooks', async function () {
        // Create totem with testMod in transferOwnership hooks
        await createTotem(totems, market, seller, "TXHOOK", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: testMod.address, amount: 1000n, isMinter: true },
        ], {
            transferOwnership: [testMod.address],
        });

        // Transfer ownership - should call testMod.onTransferOwnership
        await transferOwnership(totems, "TXHOOK", seller, buyer);

        // Verify ownership transferred
        const totem = await totems.read.getTotem(["TXHOOK"]);
        assert.equal(totem.creator.toLowerCase(), buyer.toLowerCase());
    });

    it('Should fail onTransferOwnership hook when shouldRevert is true', async function () {
        await createTotem(totems, market, seller, "TXRVT", 18, [
            { recipient: seller, amount: 1000000n },
            { recipient: testMod.address, amount: 1000n, isMinter: true },
        ], {
            transferOwnership: [testMod.address],
        });

        // Toggle testMod to revert
        await testMod.write.toggle([true]);

        await assert.rejects(async () => {
            await transferOwnership(totems, "TXRVT", seller, buyer);
        }, /Not supported/);

        // Reset toggle
        await testMod.write.toggle([false]);
    });

    it('Should fail to call TestMod.onTransferOwnership directly', async function () {
        await expectCustomError(
            testMod.write.onTransferOwnership(["TEST", seller, buyer], { account: seller }),
            ErrorSelectors.InvalidModEventOrigin,
            "InvalidModEventOrigin"
        );
    });
});
