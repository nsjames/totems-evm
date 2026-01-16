import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createTotem,
    Hook,
    setupTotemsTest,
    ZERO_ADDRESS,
    modDetails,
} from "./helpers.ts";
import {
    validateFunctionExists,
    validateRequiredAction,
    deriveValidationSignature
} from "../utils/requiredActionVerifier.ts";
import { executeModAction, type ModRequiredAction } from "../utils/requiredActionSender.ts";

describe("Required Actions Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer] = accounts;

    let minerMod: any;

    // Define the required action for the MinerMod setup
    // Note: isTotems must be explicitly set for ABI encoding (defaults to false)
    const setupRequiredAction = {
        signature: "setup(string ticker, uint256 _totemsPerMine, uint256 _userMaxPerDay)",
        inputFields: [
            {
                name: "ticker",
                mode: 2, // TOTEM - auto-fill with current totem ticker
                value: "",
                description: "The totem ticker",
                min: 0n,
                max: 0n,
                isTotems: false,
            },
            {
                name: "_totemsPerMine",
                mode: 0, // DYNAMIC - user provides this value
                value: "",
                description: "Amount of totems to mine per transaction",
                min: 1n,
                max: 0n,
                isTotems: true,
            },
            {
                name: "_userMaxPerDay",
                mode: 0, // DYNAMIC - user provides this value
                value: "",
                description: "Maximum totems a user can mine per day",
                min: 1n,
                max: 0n,
                isTotems: true,
            }
        ],
        cost: 0n,
        reason: "Configure mining parameters before mining can begin"
    };

    it('Should deploy MinerMod', async function () {
        minerMod = await viem.deployContract("MinerMod", [
            totems.address,
            seller,
        ]);
        assert.ok(minerMod.address, "MinerMod should be deployed");
    });

    it('Should verify both setup and canSetup functions exist before publishing', async function () {
        // Validate that both the main function and validation function exist
        const result = await validateRequiredAction(
            publicClient,
            minerMod.address,
            setupRequiredAction.signature
        );

        assert.equal(result.valid, true, `Required action validation failed: ${result.errors.join(', ')}`);
    });

    it('Should derive correct validation signature', async function () {
        const validationSig = deriveValidationSignature("setup(string ticker, uint256 _totemsPerMine, uint256 _userMaxPerDay)");
        assert.equal(validationSig, "canSetup(string ticker, uint256 _totemsPerMine, uint256 _userMaxPerDay)");
    });

    it('Should fail verification for non-existent function on contract without fallback', async function () {
        // Note: MinerMod has a fallback function, so non-existent calls don't revert
        // Use a contract without fallback (like the market contract) to test this
        const result = await validateFunctionExists(
            publicClient,
            market.address,
            "nonExistentFunction(string ticker)"
        );

        assert.equal(result.exists, false, "Non-existent function should not be found on contract without fallback");
    });

    it('Should publish MinerMod with requiredActions', async function () {
        const fee = await market.read.getFee([ZERO_ADDRESS]);

        await market.write.publish([
            minerMod.address,
            [Hook.Created, Hook.Mint, Hook.Transfer],
            1_000_000n,
            modDetails({
                name: "Miner Mod with Setup",
                summary: "A miner mod that requires setup",
                isMinter: true,
            }),
            [setupRequiredAction],
            ZERO_ADDRESS,
        ], { value: fee, account: seller });

        const modInfo = await market.read.getMod([minerMod.address]);
        assert.equal(modInfo.details.name, "Miner Mod with Setup", "Mod name should match");

        const requiredActions = await market.read.getModRequiredActions([minerMod.address]);
        assert.equal(requiredActions.length, 1, "Should have 1 required action");
    });

    it('Should retrieve requiredActions from chain', async function () {
        const requiredActions = await market.read.getModRequiredActions([minerMod.address]);

        assert.equal(requiredActions.length, 1, "Should have 1 required action");

        const requiredAction = requiredActions[0];
        assert.equal(
            requiredAction.signature,
            "setup(string ticker, uint256 _totemsPerMine, uint256 _userMaxPerDay)",
            "Signature should match"
        );
        assert.equal(requiredAction.inputFields.length, 3, "Should have 3 input fields");
        assert.equal(requiredAction.inputFields[0].name, "ticker", "First field should be ticker");
        assert.equal(requiredAction.inputFields[0].mode, 2, "ticker should be TOTEM mode");
        assert.equal(requiredAction.inputFields[1].name, "_totemsPerMine", "Second field should be _totemsPerMine");
        assert.equal(requiredAction.inputFields[1].mode, 0, "_totemsPerMine should be DYNAMIC mode");
        assert.equal(requiredAction.inputFields[2].name, "_userMaxPerDay", "Third field should be _userMaxPerDay");
        assert.equal(requiredAction.inputFields[2].mode, 0, "_userMaxPerDay should be DYNAMIC mode");
        assert.equal(requiredAction.reason, "Configure mining parameters before mining can begin", "Reason should match");
    });

    it('Should validate setup params with canSetup before totem creation', async function () {
        // Use canSetup to pre-validate params before committing to totem creation
        const [valid, reason] = await minerMod.read.canSetup(["MINE", 100n, 1000n]);
        assert.equal(valid, true, `canSetup should return valid for good params: ${reason}`);
    });

    it('Should reject invalid params via canSetup', async function () {
        // totemsPerMine = 0 should fail
        const [valid1, reason1] = await minerMod.read.canSetup(["MINE", 0n, 1000n]);
        assert.equal(valid1, false, "canSetup should reject totemsPerMine = 0");
        assert.ok(reason1.includes("totemsPerMine"), "Error should mention totemsPerMine");

        // userMaxPerDay = 0 should fail
        const [valid2, reason2] = await minerMod.read.canSetup(["MINE", 100n, 0n]);
        assert.equal(valid2, false, "canSetup should reject userMaxPerDay = 0");
        assert.ok(reason2.includes("userMaxPerDay"), "Error should mention userMaxPerDay");

        // userMaxPerDay < totemsPerMine should fail
        const [valid3, reason3] = await minerMod.read.canSetup(["MINE", 1000n, 100n]);
        assert.equal(valid3, false, "canSetup should reject userMaxPerDay < totemsPerMine");
        assert.ok(reason3.includes("greater than or equal"), "Error should explain the constraint");
    });

    it('Should create totem with MinerMod after validating params', async function () {
        // Params were validated in previous test, now safe to create totem
        await createTotem(
            totems,
            market,
            seller,
            "MINE",
            18,
            [
                { recipient: seller, amount: 500000n },
                { recipient: minerMod.address, amount: 500000n, isMinter: true },
            ],
            {
                created: [minerMod.address],
                mint: [minerMod.address],
                transfer: [minerMod.address],
            }
        );

        const totem = await totems.read.getTotem(["MINE"]);
        assert.equal(totem.supply, 1000000n, "Total supply should be 1,000,000");
    });

    it('Should fail to mine before setup is called', async function () {
        await assert.rejects(async () => {
            await totems.write.mint([
                minerMod.address,
                buyer,
                "MINE",
                0n, // MinerMod requires amount=0, it mines fixed amount
                "test mine",
            ], { account: buyer });
        }, /Mod is not setup for this totem/, "Should fail because mod is not configured");
    });

    it('Should execute required action using action sender', async function () {
        // Pull required actions directly from chain
        const requiredActions = await market.read.getModRequiredActions([minerMod.address]);
        const chainRequiredAction = requiredActions[0];

        // Get wallet client for the transaction
        const walletClient = await viem.getWalletClient(seller);

        // Execute using chain data directly - no manual reconstruction
        const result = await executeModAction({
            publicClient,
            walletClient,
            modAddress: minerMod.address,
            requiredAction: chainRequiredAction as ModRequiredAction,
            totemTicker: "MINE",
            dynamicParams: {
                _totemsPerMine: "100", // 100 totems per mine
                _userMaxPerDay: "1000", // 1000 totems max per day
            },
            account: seller,
        });

        assert.ok(result.hash, "Transaction hash should exist");
        assert.equal(result.receipt.status, "success", "Transaction should succeed");
    });

    it('Should verify setup was completed', async function () {
        const totemsPerMine = await minerMod.read.totemsPerMine(["MINE"]);
        assert.equal(totemsPerMine, 100n, "Totems per mine should be 100");

        const userMaxPerDay = await minerMod.read.userMaxPerDay(["MINE"]);
        assert.equal(userMaxPerDay, 1000n, "Max per day should be 1000");
    });

    it('Should successfully mine after setup is called', async function () {
        const balanceBefore = await totems.read.getBalance(["MINE", buyer]);

        // Mine totems (amount must be 0, fixed amount is mined)
        await totems.write.mint([
            minerMod.address,
            buyer,
            "MINE",
            0n,
            "mining totems",
        ], { account: buyer });

        const balanceAfter = await totems.read.getBalance(["MINE", buyer]);
        assert.equal(balanceAfter, balanceBefore + 100n, "Buyer should receive mined totems (100 per mine)");
    });

    it('Should track daily mining limits', async function () {
        const userMinedToday = await minerMod.read.userMinedToday(["MINE", buyer]);
        assert.equal(userMinedToday, 100n, "User should have mined 100 today");
    });

    it('Should allow mining up to daily limit', async function () {
        // Mine more totems (should work until we hit the limit)
        for (let i = 0; i < 8; i++) {
            await totems.write.mint([
                minerMod.address,
                buyer,
                "MINE",
                0n,
                "mining more",
            ], { account: buyer });
        }

        const userMinedToday = await minerMod.read.userMinedToday(["MINE", buyer]);
        assert.equal(userMinedToday, 900n, "User should have mined 900 today");
    });

    it('Should fail to mine beyond daily limit', async function () {
        // Already mined 900, limit is 1000, next mine would be 1000 which equals limit
        await totems.write.mint([
            minerMod.address,
            buyer,
            "MINE",
            0n,
            "last mine",
        ], { account: buyer });

        // Now at 1000, trying to mine more should fail
        await assert.rejects(async () => {
            await totems.write.mint([
                minerMod.address,
                buyer,
                "MINE",
                0n,
                "over limit",
            ], { account: buyer });
        }, /User has reached max for today/, "Should fail when daily limit is reached");
    });

    it('Should handle STATIC mode for input fields', async function () {
        // Deploy a new mod instance
        const minerModStatic = await viem.deployContract("MinerMod", [
            totems.address,
            seller,
        ]);

        // Define required action with STATIC values (no hook wrapper needed)
        // Note: isTotems must be explicitly set for ABI encoding (defaults to false)
        const setupWithStaticAction = {
            signature: "setup(string ticker, uint256 _totemsPerMine, uint256 _userMaxPerDay)",
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
                    name: "_totemsPerMine",
                    mode: 1, // STATIC - predefined value
                    value: "50", // Fixed 50 totems per mine
                    description: "Amount of totems to mine per transaction",
                    min: 1n,
                    max: 0n,
                    isTotems: true,
                },
                {
                    name: "_userMaxPerDay",
                    mode: 1, // STATIC - predefined value
                    value: "500", // Fixed 500 max per day
                    description: "Maximum totems a user can mine per day",
                    min: 1n,
                    max: 0n,
                    isTotems: true,
                }
            ],
            cost: 0n,
            reason: "Configure with predefined mining parameters"
        };

        // Validate both setup and canSetup functions exist
        const result = await validateRequiredAction(
            publicClient,
            minerModStatic.address,
            setupWithStaticAction.signature
        );
        assert.equal(result.valid, true, `Required action validation failed: ${result.errors.join(', ')}`);

        // Publish mod
        const fee = await market.read.getFee([ZERO_ADDRESS]);
        await market.write.publish([
            minerModStatic.address,
            [Hook.Created, Hook.Mint, Hook.Transfer],
            100_000n,
            modDetails({
                name: "Static Config Miner",
                summary: "Miner with predefined config",
                isMinter: true,
            }),
            [setupWithStaticAction],
            ZERO_ADDRESS,
        ], { value: fee, account: seller });

        // Create totem
        await createTotem(
            totems,
            market,
            seller,
            "STATIC",
            18,
            [
                { recipient: seller, amount: 500000n },
                { recipient: minerModStatic.address, amount: 500000n, isMinter: true },
            ],
            {
                created: [minerModStatic.address],
                mint: [minerModStatic.address],
                transfer: [minerModStatic.address],
            }
        );

        // Pull required actions directly from chain and execute
        const requiredActions = await market.read.getModRequiredActions([minerModStatic.address]);
        const chainRequiredAction = requiredActions[0];
        const walletClient = await viem.getWalletClient(seller);

        // Execute using chain data directly - no manual reconstruction
        await executeModAction({
            publicClient,
            walletClient,
            modAddress: minerModStatic.address,
            requiredAction: chainRequiredAction as ModRequiredAction,
            totemTicker: "STATIC",
            dynamicParams: {}, // No dynamic params needed - using STATIC mode
            account: seller,
        });

        // Verify static values were used
        const totemsPerMine = await minerModStatic.read.totemsPerMine(["STATIC"]);
        assert.equal(totemsPerMine, 50n, "Totems per mine should be 50 (static value)");

        const userMaxPerDay = await minerModStatic.read.userMaxPerDay(["STATIC"]);
        assert.equal(userMaxPerDay, 500n, "Max per day should be 500 (static value)");
    });
});
