import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {createTotem, Hook, modDetails, publishMod, setupTotemsTest, ZERO_ADDRESS} from "./helpers.ts";

describe("Mod Interactions", async function () {
    let testMod: any;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer, referrer] = accounts;

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

        const create = async () => {
            return createTotem(totems, market, seller, "TEST", 4, [
                { recipient: seller, amount: 1000n },
                { recipient: testMod.address, amount: 1000n, isMinter: true },
            ], {
                transfer: [testMod.address],
                mint: [testMod.address],
                burn: [testMod.address],
                created: [testMod.address],
            });
        }

        await toggleModFailures(true);
        await assert.rejects(async () => {
            await create();
        }, /Not supported/);

        await toggleModFailures(false);
        await create();
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
        await assert.rejects(async () => {
            await totems.write.mint([
                testMod.address,
                seller,
                "TEST",
                100n,
                "Test mint failure",
            ], { account: seller });
        }, (err:any) => err.message.includes('Not supported.'));

        await toggleModFailures(false);
        await totems.write.mint([
            testMod.address,
            seller,
            "TEST",
            100n,
            "Test mint success",
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


});