import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {addMod, createTotem, getBalance, Hook, modDetails, publishMod, setupTotemsTest, transfer, ZERO_ADDRESS} from "./helpers.ts";

describe("ProxyMod Interactions", async function () {
    let testMod: any;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts,
        proxyMod,
        proxyModSeller
    } = await setupTotemsTest();
    const [deployer, seller, buyer, minter] = accounts;

    const toggleModFailures = async (fail:boolean) => {
        await testMod.write.toggle([fail]);
    }

    it('Should deploy the test mod', async function() {
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, testMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true
        }));

        await publishMod(market, proxyModSeller, proxyMod.address, [Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true
        }));

        // "created" can never be a proxy mod hook, since the totem contract
        // needs to call the mod during creation and the proxy will never have registered
        // as a mod at that point.
        await createTotem(totems, market, seller, "TEST", 4, [
            { recipient: seller, amount: 1000n },
            { recipient: proxyMod.address, amount: 10000000n, isMinter: true },
        ], {
            transfer: [proxyMod.address],
            mint: [proxyMod.address],
            burn: [proxyMod.address],
        });
    });

    it('should add the test mod as a proxied mod', async function() {
        // fail if no fee
        await assert.rejects(async () => {
            await proxyMod.write.addMod(["TEST", [1,2,3], testMod.address, ZERO_ADDRESS], { account: seller });
        });
        await addMod(proxyMod, totems, market, "TEST", [Hook.Mint, Hook.Burn, Hook.Transfer], testMod.address, seller);
    });

    it('should fail to transfer', async function() {
        await toggleModFailures(true);
        await assert.rejects(async () => {
            await totems.write.transfer([
                "TEST",
                seller,
                buyer,
                100n,
                "Test transfer failure",
            ], { account: seller });
        }, /Not supported/);
        await toggleModFailures(false);

        const hash = await totems.write.transfer([
            "TEST",
            seller,
            buyer,
            100n,
            "Test transfer success",
        ], { account: seller });
    });

    it('should fail to mint', async function() {
        await toggleModFailures(true);
        // Mint must happen through the proxy mod
        await assert.rejects(async () => {
            await totems.write.mint([
                testMod.address,
                seller,
                "TEST",
                100n,
                "Test mint failure",
            ], { account: seller });
        }, /ModNotMinter/);

        // Memo must be the mod address
        await assert.rejects(async () => {
            await totems.write.mint([
                proxyMod.address,
                seller,
                "TEST",
                100n,
                "Test mint failure",
            ], { account: seller });
        }, /InvalidAddressLength/);

        // Memo must be the mod address
        await assert.rejects(async () => {
            await totems.write.mint([
                proxyMod.address,
                seller,
                "TEST",
                100n,
                testMod.address,
            ], { account: seller });
        }, /Not supported/);

        await toggleModFailures(false);
        await totems.write.mint([
            proxyMod.address,
            seller,
            "TEST",
            100n,
            testMod.address,
        ], { account: seller });
    });

    it('should fail to burn', async function() {
        await toggleModFailures(true);
        await assert.rejects(async () => {
            await totems.write.burn([
                "TEST",
                seller,
                50n,
                "Test burn failure",
            ], { account: seller });
        }, /Not supported/);

        await toggleModFailures(false);
        await totems.write.burn([
            "TEST",
            seller,
            50n,
            "Test burn success",
        ], { account: seller });
    });

    it('should deploy the minter mod and mint through proxy', async function() {
        const initialBalance = await getBalance(totems, "TEST", minter);
        const mintAmount = 500n;

        const minterMod = await viem.deployContract("MinterMod", [
            totems.address,
            seller,
        ]);

        await publishMod(market, seller, minterMod.address, [Hook.Mint, Hook.Transfer], modDetails({
            isMinter: true
        }));


        await addMod(proxyMod, totems, market, "TEST", [Hook.Mint, Hook.Transfer], minterMod.address, seller);

        // send the minter some tokens to mint with
        await transfer(totems, "TEST", seller, minterMod.address, 500n, "Funding minter");
        assert.strictEqual(await getBalance(totems, "TEST", minterMod.address), 500n);

        await totems.write.mint([
            proxyMod.address,
            minter,
            "TEST",
            mintAmount,
            minterMod.address,
        ], { account: minter });

        const finalBalance = await getBalance(totems, "TEST", minter);
        assert.strictEqual(finalBalance, initialBalance + mintAmount);
    });

});