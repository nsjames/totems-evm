import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createTotem,
    Hook,
    modDetails,
    publishMod,
    setupTotemsTest,
    mint,
    burn,
    transfer,
    ZERO_ADDRESS
} from "./helpers.ts";

describe("Security Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts,
    } = await setupTotemsTest();
    const [deployer, seller, buyer, attacker] = accounts;

    let reentrancyMod: any;
    let testMod: any;

    // ========== Setup ==========

    it('Should setup security test environment', async function () {
        // Deploy the reentrancy mod
        reentrancyMod = await viem.deployContract("ReentrancyMod", [
            totems.address,
            seller,
        ]);

        // Publish it to the market with all hooks
        await publishMod(market, seller, reentrancyMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            name: "Reentrancy Mod",
            isMinter: true,
            needsUnlimited: true,
        }));

        // Deploy a normal test mod for minting
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, testMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            name: "Test Mod",
            isMinter: true,
        }));
    });

    // ========== Reentrancy Tests ==========

    describe("Reentrancy Protection", async function () {

        it('Should block transfer of totem being created (isActive=false during onCreated)', async function () {
            // Configure the attack BEFORE creating - try to transfer SECA during its own creation
            await reentrancyMod.write.setAttack([1, "SECA"], { account: seller }); // AttackType.Transfer = 1

            // Create totem - onCreated will try to transfer SECA but it's not active yet
            await createTotem(totems, market, seller, "SECA", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 1000n },
            ], {
                created: [reentrancyMod.address],
            });

            // Check that attack was attempted but FAILED (totem not active during onCreated)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Attack should have been attempted");
            assert.equal(succeeded, false, "Attack should fail - totem is not active during onCreated hook");
        });

        it('Should block mint of totem being created (isActive=false during onCreated)', async function () {
            // Configure the attack BEFORE creating - try to mint SECMINT during its own creation
            await reentrancyMod.write.setAttack([2, "SECMINT"], { account: seller }); // AttackType.Mint = 2

            // Create totem with reentrancyMod as minter so it can attempt mint
            await createTotem(totems, market, seller, "SECMINT", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 10000n, isMinter: true },
            ], {
                created: [reentrancyMod.address],
            });

            // Check that attack was attempted but FAILED (totem not active during onCreated)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Attack should have been attempted");
            assert.equal(succeeded, false, "Attack should fail - totem is not active during onCreated hook");
        });

        it('Should block burn of totem being created (isActive=false during onCreated)', async function () {
            // Configure the attack BEFORE creating - try to burn SECBURN during its own creation
            await reentrancyMod.write.setAttack([3, "SECBURN"], { account: seller }); // AttackType.Burn = 3

            // Create totem with reentrancyMod having balance so it can attempt burn
            await createTotem(totems, market, seller, "SECBURN", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 10000n },
            ], {
                created: [reentrancyMod.address],
            });

            // Check that attack was attempted but FAILED (totem not active during onCreated)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Attack should have been attempted");
            assert.equal(succeeded, false, "Attack should fail - totem is not active during onCreated hook");
        });

        it('Should allow transfer of OTHER totems during onCreated hook', async function () {
            // First create SECB which will be active
            await createTotem(totems, market, seller, "SECB", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 1000n },
            ], {});

            // Configure the attack to transfer SECB (which is active)
            await reentrancyMod.write.setAttack([1, "SECB"], { account: seller }); // AttackType.Transfer = 1

            // Create SECC - onCreated will try to transfer SECB (different totem, already active)
            await createTotem(totems, market, seller, "SECC", 18, [
                { recipient: seller, amount: 1000000n },
            ], {
                created: [reentrancyMod.address],
            });

            // Check that the operation SUCCEEDED (transferring a different, active totem)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - SECB is active");
        });

        // Note: mint(), burn(), and transfer() do NOT have nonReentrant guards.
        // This is intentional - mods may need to perform operations during hooks.
        // The following tests verify that hooks CAN call back into the contract.

        it('Should allow mod to transfer during onMint hook (no reentrancy guard)', async function () {
            // Create totem with testMod as minter and reentrancyMod in mint hooks
            await createTotem(totems, market, seller, "SECD", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: testMod.address, amount: 10000n, isMinter: true },
                { recipient: reentrancyMod.address, amount: 1000n }, // Give it balance to transfer
            ], {
                mint: [reentrancyMod.address, testMod.address],
            });

            // Configure the attack - try to transfer during onMint
            await reentrancyMod.write.setAttack([1, "SECD"], { account: seller }); // AttackType.Transfer = 1

            // Mint tokens which will trigger onMint hook
            await mint(totems, testMod.address, seller, "SECD", 100n, "test mint");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - mint() has no reentrancy guard");
        });

        it('Should allow mod to transfer during onBurn hook (no reentrancy guard)', async function () {
            // Create totem with reentrancy mod in burn hooks
            await createTotem(totems, market, seller, "SECE", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 1000n },
            ], {
                burn: [reentrancyMod.address],
            });

            // Configure the attack - try to transfer during onBurn
            await reentrancyMod.write.setAttack([1, "SECE"], { account: seller }); // AttackType.Transfer = 1

            // Burn tokens which will trigger onBurn hook
            await burn(totems, "SECE", seller, 100n, "test burn");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - burn() has no reentrancy guard");
        });

        it('Should allow mod to transfer during onTransfer hook (no reentrancy guard)', async function () {
            // Create totem with reentrancy mod in transfer hooks
            await createTotem(totems, market, seller, "SECF", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 1000n },
            ], {
                transfer: [reentrancyMod.address],
            });

            // Configure the attack - try to transfer during onTransfer
            await reentrancyMod.write.setAttack([1, "SECF"], { account: seller }); // AttackType.Transfer = 1

            // Transfer tokens which will trigger onTransfer hook
            await transfer(totems, "SECF", seller, buyer, 100n, "test transfer");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - transfer() has no reentrancy guard");
        });

        it('Should allow mod to burn during onMint hook (no reentrancy guard)', async function () {
            // Create totem with testMod as minter and reentrancyMod in mint hooks
            await createTotem(totems, market, seller, "SECG", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: testMod.address, amount: 10000n, isMinter: true },
                { recipient: reentrancyMod.address, amount: 1000n }, // Give it balance to burn
            ], {
                mint: [reentrancyMod.address, testMod.address],
            });

            // Configure the attack - try to burn during onMint
            await reentrancyMod.write.setAttack([3, "SECG"], { account: seller }); // AttackType.Burn = 3

            // Mint tokens which will trigger onMint hook
            await mint(totems, testMod.address, seller, "SECG", 100n, "test mint");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - mint() has no reentrancy guard");
        });

        it('Should allow mod to burn during onBurn hook (no reentrancy guard)', async function () {
            // Create totem with reentrancyMod in burn hooks
            await createTotem(totems, market, seller, "SECH", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 1000n }, // Give it balance to burn
            ], {
                burn: [reentrancyMod.address],
            });

            // Configure the attack - try to burn during onBurn
            await reentrancyMod.write.setAttack([3, "SECH"], { account: seller }); // AttackType.Burn = 3

            // Burn tokens which will trigger onBurn hook
            await burn(totems, "SECH", seller, 100n, "test burn");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - burn() has no reentrancy guard");
        });

        it('Should allow mod to mint during onBurn hook (no reentrancy guard)', async function () {
            // Create totem with reentrancyMod as minter (with balance) and in burn hooks
            await createTotem(totems, market, seller, "SECI", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 10000n, isMinter: true }, // Minter with initial balance
            ], {
                burn: [reentrancyMod.address],
            });

            // Configure the attack - try to mint during onBurn
            await reentrancyMod.write.setAttack([2, "SECI"], { account: seller }); // AttackType.Mint = 2

            // Burn tokens which will trigger onBurn hook
            await burn(totems, "SECI", seller, 100n, "test burn");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - burn() has no reentrancy guard");
        });

        it('Should allow mod to mint during onTransfer hook (no reentrancy guard)', async function () {
            // Create totem with reentrancyMod as minter and in transfer hooks
            await createTotem(totems, market, seller, "SECJ", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 10000n, isMinter: true }, // Minter with initial balance
            ], {
                transfer: [reentrancyMod.address],
            });

            // Configure the attack - try to mint during onTransfer
            await reentrancyMod.write.setAttack([2, "SECJ"], { account: seller }); // AttackType.Mint = 2

            // Transfer tokens which will trigger onTransfer hook
            await transfer(totems, "SECJ", seller, buyer, 100n, "test transfer");

            // Check that the operation was attempted and SUCCEEDED (no reentrancy guard)
            const attempted = await reentrancyMod.read.attackAttempted();
            const succeeded = await reentrancyMod.read.attackSucceeded();

            assert.equal(attempted, true, "Operation should have been attempted");
            assert.equal(succeeded, true, "Operation should succeed - transfer() has no reentrancy guard");
        });
    });

    // ========== Balance/Supply Manipulation Tests ==========

    describe("Balance/Supply Manipulation", async function () {

        it('Should revert when burning more than balance', async function () {
            await createTotem(totems, market, seller, "BALA", 18, [
                { recipient: seller, amount: 100n },
            ], {});

            // Try to burn more than balance
            await assert.rejects(
                burn(totems, "BALA", seller, 200n, "over burn"),
                /InsufficientBalance/,
                "Should revert with InsufficientBalance"
            );
        });

        it('Should revert when transferring more than balance', async function () {
            await createTotem(totems, market, seller, "BALB", 18, [
                { recipient: seller, amount: 100n },
            ], {});

            // Try to transfer more than balance
            await assert.rejects(
                transfer(totems, "BALB", seller, buyer, 200n, "over transfer"),
                /InsufficientBalance/,
                "Should revert with InsufficientBalance"
            );
        });

        it('Should revert when burning exactly balance + 1', async function () {
            await createTotem(totems, market, seller, "BALC", 18, [
                { recipient: seller, amount: 100n },
            ], {});

            // Try to burn exactly 1 more than balance
            await assert.rejects(
                burn(totems, "BALC", seller, 101n, "edge burn"),
                /InsufficientBalance/,
                "Should revert with InsufficientBalance"
            );
        });
    });

    // ========== Edge Case Tests (Valid Operations) ==========

    describe("Edge Cases (Valid Operations)", async function () {

        it('Should allow self-transfer (from == to)', async function () {
            await createTotem(totems, market, seller, "EDGA", 18, [
                { recipient: seller, amount: 1000n },
            ], {});

            const balanceBefore = await totems.read.getBalance(["EDGA", seller]);

            // Self-transfer should work
            await transfer(totems, "EDGA", seller, seller, 100n, "self transfer");

            const balanceAfter = await totems.read.getBalance(["EDGA", seller]);

            // Balance should remain the same
            assert.equal(balanceAfter, balanceBefore, "Balance should be unchanged after self-transfer");
        });

        it('Should allow zero amount transfer', async function () {
            await createTotem(totems, market, seller, "EDGB", 18, [
                { recipient: seller, amount: 1000n },
            ], {});

            // Zero transfer should work
            await transfer(totems, "EDGB", seller, buyer, 0n, "zero transfer");

            // Verify balances unchanged
            const sellerBalance = await totems.read.getBalance(["EDGB", seller]);
            const buyerBalance = await totems.read.getBalance(["EDGB", buyer]);

            assert.equal(sellerBalance, 1000n, "Seller balance should be unchanged");
            assert.equal(buyerBalance, 0n, "Buyer balance should be zero");
        });

        it('Should allow zero amount burn', async function () {
            await createTotem(totems, market, seller, "EDGC", 18, [
                { recipient: seller, amount: 1000n },
            ], {});

            // Zero burn should work
            await burn(totems, "EDGC", seller, 0n, "zero burn");

            const balance = await totems.read.getBalance(["EDGC", seller]);
            assert.equal(balance, 1000n, "Balance should be unchanged after zero burn");
        });
    });

    // ========== Unlimited Minter Exploit Tests ==========

    describe("Unlimited Minter Exploits", async function () {

        it('Should block transfer TO unlimited minter', async function () {
            // reentrancyMod is registered as unlimited minter (needsUnlimited: true)
            await createTotem(totems, market, seller, "UNLA", 18, [
                { recipient: seller, amount: 1000000n },
            ], {});

            // Try to transfer TO the unlimited minter
            await assert.rejects(
                transfer(totems, "UNLA", seller, reentrancyMod.address, 100n, "to unlimited"),
                /CannotTransferToUnlimitedMinter/,
                "Should revert when transferring to unlimited minter"
            );
        });

        it('Should allow unlimited minter to transfer OUT (minting)', async function () {
            // Create totem with reentrancyMod as unlimited minter
            await createTotem(totems, market, seller, "UNLB", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 0n, isMinter: true },
            ], {});

            // Get initial supply
            const totemBefore = await totems.read.getTotem(["UNLB"]);
            const supplyBefore = totemBefore.supply;

            // Mint via unlimited minter - seller calls mint, reentrancyMod is the minter mod
            await mint(totems, reentrancyMod.address, seller, "UNLB", 500n, "unlimited mint");

            // Supply should increase
            const totemAfter = await totems.read.getTotem(["UNLB"]);
            assert.equal(totemAfter.supply, supplyBefore + 500n, "Supply should increase");
        });

        it('Should not deduct balance from unlimited minter on transfer', async function () {
            // Create totem with reentrancyMod as unlimited minter
            await createTotem(totems, market, seller, "UNLC", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: reentrancyMod.address, amount: 0n, isMinter: true },
            ], {});

            // Mint using unlimited minter - seller calls, tokens go to seller
            await mint(totems, reentrancyMod.address, seller, "UNLC", 1000n, "setup mint");

            // Unlimited minter's balance stays 0 (it never holds tokens, just mints out of thin air)
            const unlimitedBalance = await totems.read.getBalance(["UNLC", reentrancyMod.address]);
            assert.equal(unlimitedBalance, 0n, "Unlimited minter should have 0 balance");
        });
    });

    // ========== Relay Security Tests ==========

    describe("Relay Security", async function () {

        it('Should block removed relay from operating', async function () {
            await createTotem(totems, market, seller, "RELA", 18, [
                { recipient: seller, amount: 1000000n },
            ], {});

            // Add buyer as a relay
            await totems.write.addRelay(["RELA", buyer, "TEST"], { account: seller });

            // Verify relay can operate (transfer on behalf of seller)
            await totems.write.transfer(["RELA", seller, attacker, 100n, "relay transfer"], { account: buyer });

            // Remove the relay
            await totems.write.removeRelay(["RELA", buyer], { account: seller });

            // Removed relay should not be able to operate
            await assert.rejects(
                totems.write.transfer(["RELA", seller, attacker, 100n, "removed relay"], { account: buyer }),
                /Unauthorized/,
                "Removed relay should not be able to transfer"
            );
        });

        it('Should block relay impersonation (random address acting as relay)', async function () {
            await createTotem(totems, market, seller, "RELB", 18, [
                { recipient: seller, amount: 1000000n },
            ], {});

            // Attacker (not a relay) tries to transfer seller's tokens
            await assert.rejects(
                totems.write.transfer(["RELB", seller, attacker, 100n, "impersonation"], { account: attacker }),
                /Unauthorized/,
                "Non-relay should not be able to transfer others tokens"
            );
        });

        it('Should block relay impersonation for burn', async function () {
            await createTotem(totems, market, seller, "RELC", 18, [
                { recipient: seller, amount: 1000000n },
            ], {});

            // Attacker tries to burn seller's tokens
            await assert.rejects(
                totems.write.burn(["RELC", seller, 100n, "burn impersonation"], { account: attacker }),
                /Unauthorized/,
                "Non-relay should not be able to burn others tokens"
            );
        });

        it('Should block relay impersonation for mint (minting for someone else)', async function () {
            await createTotem(totems, market, seller, "RELD", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: testMod.address, amount: 10000n, isMinter: true },
            ], {});

            // Attacker tries to mint FOR seller (attacker is not seller and not a relay)
            await assert.rejects(
                totems.write.mint([testMod.address, seller, "RELD", 100n, "mint impersonation"], { account: attacker }),
                /Unauthorized/,
                "Non-relay should not be able to mint for others"
            );
        });

        it('Should allow anyone to mint to themselves using minter mod (auth passes)', async function () {
            await createTotem(totems, market, seller, "RELE", 18, [
                { recipient: seller, amount: 1000000n },
                { recipient: testMod.address, amount: 10000n, isMinter: true },
            ], { mint: [testMod.address] });

            // Anyone can call mint() to themselves using a valid minter mod
            // This is by design - the mod controls what happens (payments, limits, token distribution)
            // The authorization passes, but TestMod.mint() returns 0 (it's a stub)
            await totems.write.mint([testMod.address, attacker, "RELE", 100n, "self mint"], { account: attacker });

            // Authorization passed (no revert) - actual minting behavior depends on the mod
        });
    });
});
