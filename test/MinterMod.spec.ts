import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEventLogs } from "viem";
import {createTotem, Hook, mint, modDetails, publishMod, setupTotemsTest, ZERO_ADDRESS} from "./helpers.ts";

const totemsEvents = [
    {
        type: 'event',
        name: 'TotemMinted',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'minter', type: 'address', indexed: true },
            { name: 'mod', type: 'address', indexed: false },
            { name: 'minted', type: 'uint256', indexed: false },
            { name: 'payment', type: 'uint256', indexed: false },
        ],
    },
] as const;

describe("Minter Mod", async function () {
    let minterMod: any;
    let unlimitedMinterMod: any;
    let lyingMinterMod: any;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [creator, seller, user1, user2, user3] = accounts;


    it('Should deploy the minter mod', async function() {
        minterMod = await viem.deployContract("MinterMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, minterMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true
        }));

        await createTotem(totems, market, creator, "TEST", 4, [
            { recipient: minterMod.address, amount: 1000n, isMinter: true },
        ], {
            mint: [minterMod.address],
            created: [minterMod.address],
        });

        // balance of the minter should be 1000n
        const minterModInternalBalance = await minterMod.read.balances(["TEST"]);
        assert.equal(minterModInternalBalance, 1000n, "Minter balance doesn't match");
    });

    it('Should mint some totems', async () => {
        const supplyBeforeMint = await totems.read.getTotem(["TEST"]);
        await mint(totems, minterMod.address, user1, "TEST", 1n, "Minting 1 totem");

        const user1Balance = await totems.read.getBalance([ "TEST", user1 ]);
        assert.equal(user1Balance, 1n, "User1 balance doesn't match after minting");

        const minterModInternalBalanceAfterMint = await minterMod.read.balances(["TEST"]);
        assert.equal(minterModInternalBalanceAfterMint, 999n, "Minter balance doesn't match after minting");
        const totemsMinterBalance = await totems.read.getBalance([ "TEST", minterMod.address ]);
        assert.equal(totemsMinterBalance, 999n, "Totems minter balance doesn't match after minting");

        // should have the same supply
        const supplyAfterMint = await totems.read.getTotem(["TEST"]);
        assert.equal(supplyAfterMint.maxSupply, supplyBeforeMint.maxSupply, "Supply doesn't match after minting");
    });

    it('Should be able to mint unlimited totems', async () => {
        unlimitedMinterMod = await viem.deployContract("UnlimitedMinterMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, unlimitedMinterMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true,
            needsUnlimited: true,
        }));

        await createTotem(totems, market, creator, "UNLIM", 4, [
            { recipient: unlimitedMinterMod.address, amount: 0, isMinter: true },
        ], {
            mint: [unlimitedMinterMod.address],
        });

        assert.equal(await totems.read.getBalance(["UNLIM", unlimitedMinterMod.address]), 0n,
            "Minter balance doesn't match");
    });

    it('Should mint some unlimited totems', async () => {
        const supplyBeforeMint = await totems.read.getTotem(["UNLIM"]);
        await mint(totems, unlimitedMinterMod.address, user2, "UNLIM", 1n, "Minting 1 totem");

        const user2Balance = await totems.read.getBalance([ "UNLIM", user2 ]);
        assert.equal(user2Balance, 1n, "User2 balance doesn't match after minting");

        const unlimitedMinterModBalanceAfterMint = await totems.read.getBalance([ "UNLIM", unlimitedMinterMod.address ]);
        assert.equal(unlimitedMinterModBalanceAfterMint, 0n, "Minter balance doesn't match after minting");

        // should have increased supply
        const supplyAfterMint = await totems.read.getTotem(["UNLIM"]);
        assert.equal(supplyAfterMint.maxSupply, supplyBeforeMint.maxSupply+1n, "Supply doesn't match after minting");
    });

    // ========== Minted Amount Verification Tests ==========

    it('Should emit correct minted amount in TotemMinted event for limited minter', async () => {
        const tx = await mint(totems, minterMod.address, user1, "TEST", 10n, "Minting 10 totems");
        const receipt = await publicClient.getTransactionReceipt({ hash: tx });

        const logs = parseEventLogs({
            abi: totemsEvents,
            logs: receipt.logs,
        });

        const mintEvent = logs.find((log: any) => log.eventName === 'TotemMinted');
        assert.ok(mintEvent, "TotemMinted event should be emitted");
        assert.equal((mintEvent as any).args.minted, 10n, "Event should report correct minted amount");
    });

    it('Should emit correct minted amount in TotemMinted event for unlimited minter', async () => {
        const tx = await mint(totems, unlimitedMinterMod.address, user2, "UNLIM", 100n, "Minting 100 totems");
        const receipt = await publicClient.getTransactionReceipt({ hash: tx });

        const logs = parseEventLogs({
            abi: totemsEvents,
            logs: receipt.logs,
        });

        const mintEvent = logs.find((log: any) => log.eventName === 'TotemMinted');
        assert.ok(mintEvent, "TotemMinted event should be emitted");
        assert.equal((mintEvent as any).args.minted, 100n, "Event should report correct minted amount");

        // Verify supply also increased correctly
        const totem = await totems.read.getTotem(["UNLIM"]);
        assert.equal(totem.supply, 101n, "Supply should reflect actual minted amount");
    });

    // ========== Lying Minter Tests ==========

    it('Should deploy lying minter mod', async () => {
        lyingMinterMod = await viem.deployContract("LyingMinterMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, lyingMinterMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true,
            needsUnlimited: true,
        }));

        await createTotem(totems, market, creator, "LYING", 4, [
            { recipient: lyingMinterMod.address, amount: 0, isMinter: true },
        ], {
            mint: [lyingMinterMod.address],
        });
    });

    it('Should measure actual minted amount, not trust lying minter return value', async () => {
        const supplyBefore = await totems.read.getTotem(["LYING"]);

        // Request to mint 100, but lying minter only mints 50 (half)
        const tx = await mint(totems, lyingMinterMod.address, user3, "LYING", 100n, "Lying mint");
        const receipt = await publicClient.getTransactionReceipt({ hash: tx });

        const logs = parseEventLogs({
            abi: totemsEvents,
            logs: receipt.logs,
        });

        const mintEvent = logs.find((log: any) => log.eventName === 'TotemMinted');
        assert.ok(mintEvent, "TotemMinted event should be emitted");

        // Event should report actual minted amount (50), not the lied amount (100)
        assert.equal((mintEvent as any).args.minted, 50n, "Event should report actual minted amount, not lied amount");

        // User should only have received 50 tokens
        const user3Balance = await totems.read.getBalance(["LYING", user3]);
        assert.equal(user3Balance, 50n, "User should only have actual minted tokens");

        // Supply should only have increased by 50
        const supplyAfter = await totems.read.getTotem(["LYING"]);
        assert.equal(supplyAfter.supply, supplyBefore.supply + 50n, "Supply should reflect actual minted amount");
        assert.equal(supplyAfter.maxSupply, supplyBefore.maxSupply + 50n, "MaxSupply should reflect actual minted amount");
    });

    it('Should correctly handle lying minter with multiple mints', async () => {
        const supplyBefore = await totems.read.getTotem(["LYING"]);

        // Mint twice
        await mint(totems, lyingMinterMod.address, user3, "LYING", 200n, "Lying mint 1");
        await mint(totems, lyingMinterMod.address, user3, "LYING", 100n, "Lying mint 2");

        // User should have 50 + 100 + 50 = 200 (first 50 from previous test, then 100 + 50 from these)
        const user3Balance = await totems.read.getBalance(["LYING", user3]);
        assert.equal(user3Balance, 200n, "User balance should reflect cumulative actual mints");

        // Supply should reflect actual amounts (50 + 100 + 50 = 200)
        const supplyAfter = await totems.read.getTotem(["LYING"]);
        assert.equal(supplyAfter.supply, supplyBefore.supply + 150n, "Supply should reflect actual minted amounts");
    });
});