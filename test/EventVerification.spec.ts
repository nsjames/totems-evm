import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEventLogs } from "viem";
import {
    createTotem,
    Hook,
    setupTotemsTest,
    transfer,
    ZERO_ADDRESS,
    publishMod,
    modDetails
} from "./helpers.ts";

// Event ABIs for decoding
const totemEvents = [
    {
        type: 'event',
        name: 'TotemCreated',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'creator', type: 'address', indexed: true }
        ]
    },
    {
        type: 'event',
        name: 'TotemTransferred',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
        ]
    },
    {
        type: 'event',
        name: 'TotemMinted',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'minter', type: 'address', indexed: true },
            { name: 'mod', type: 'address', indexed: false },
            { name: 'minted', type: 'uint256', indexed: false },
            { name: 'payment', type: 'uint256', indexed: false }
        ]
    },
    {
        type: 'event',
        name: 'TotemBurned',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'owner', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
        ]
    },
    {
        type: 'event',
        name: 'RelayAuthorized',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'relay', type: 'address', indexed: true }
        ]
    },
    {
        type: 'event',
        name: 'RelayRevoked',
        inputs: [
            { name: 'ticker', type: 'string', indexed: false },
            { name: 'relay', type: 'address', indexed: true }
        ]
    }
] as const;

const marketEvents = [
    {
        type: 'event',
        name: 'ModPublished',
        inputs: [
            { name: 'mod', type: 'address', indexed: true }
        ]
    },
    {
        type: 'event',
        name: 'ModUpdated',
        inputs: [
            { name: 'mod', type: 'address', indexed: true }
        ]
    }
] as const;

const erc20Events = [
    {
        type: 'event',
        name: 'Transfer',
        inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false }
        ]
    },
    {
        type: 'event',
        name: 'Approval',
        inputs: [
            { name: 'owner', type: 'address', indexed: true },
            { name: 'spender', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false }
        ]
    }
] as const;

describe("Event Verification Tests", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [deployer, seller, buyer] = accounts;

    let testMod: any;
    let erc20Factory: any;
    let erc20Relay: any;

    it('Should setup test environment', async function () {
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

        await createTotem(
            totems,
            market,
            seller,
            "EVENT",
            18,
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

        erc20Factory = await viem.deployContract("TotemERC20Factory", [
            totems.address,
        ]);

        await totems.write.createRelay([
            "EVENT",
            erc20Factory.address,
            "ERC20"
        ], { account: seller });

        const relays = await totems.read.getRelays(["EVENT"]);
        erc20Relay = await viem.getContractAt("IERC20", relays[0].relay);
    });

    // Event: TotemCreated
    it('Should emit TotemCreated event on totem creation', async function () {
        const hash = await createTotem(
            totems,
            market,
            seller,
            "EVTEST",
            4,
            [{ recipient: seller, amount: 1000n }]
        );

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const totemCreatedEvent = events.find(e => e.eventName === 'TotemCreated');
        assert.ok(totemCreatedEvent, "TotemCreated event should be emitted");
        assert.equal(totemCreatedEvent.args.ticker, "EVTEST", "Ticker should match");
        assert.equal(totemCreatedEvent.args.creator.toLowerCase(), seller.toLowerCase(), "Creator should match");
    });

    // Event: TotemTransferred
    it('Should emit TotemTransferred event on transfer', async function () {
        const hash = await transfer(totems, "EVENT", seller, buyer, 100n, "test transfer");

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const transferEvent = events.find(e => e.eventName === 'TotemTransferred');
        assert.ok(transferEvent, "TotemTransferred event should be emitted");
        assert.equal(transferEvent.args.ticker, "EVENT", "Ticker should match");
        assert.equal(transferEvent.args.from.toLowerCase(), seller.toLowerCase(), "From address should match");
        assert.equal(transferEvent.args.to.toLowerCase(), buyer.toLowerCase(), "To address should match");
        assert.equal(transferEvent.args.amount, 100n, "Amount should match");
    });

    // Event: TotemMinted
    it('Should emit TotemMinted event on mint', async function () {
        const hash = await totems.write.mint([
            testMod.address,
            seller,
            "EVENT",
            100n,
            "test mint"
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const mintEvent = events.find(e => e.eventName === 'TotemMinted');
        assert.ok(mintEvent, "TotemMinted event should be emitted");
        assert.equal(mintEvent.args.ticker, "EVENT", "Ticker should match");
        assert.equal(mintEvent.args.minter.toLowerCase(), seller.toLowerCase(), "Minter should match");
        assert.equal(mintEvent.args.mod.toLowerCase(), testMod.address.toLowerCase(), "Mod address should match");
    });

    // Event: TotemBurned
    it('Should emit TotemBurned event on burn', async function () {
        const hash = await totems.write.burn([
            "EVENT",
            seller,
            50n,
            "test burn"
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const burnEvent = events.find(e => e.eventName === 'TotemBurned');
        assert.ok(burnEvent, "TotemBurned event should be emitted");
        assert.equal(burnEvent.args.ticker, "EVENT", "Ticker should match");
        assert.equal(burnEvent.args.owner.toLowerCase(), seller.toLowerCase(), "Owner should match");
        assert.equal(burnEvent.args.amount, 50n, "Amount should match");
    });

    // Event: RelayAuthorized
    it('Should emit RelayAuthorized event on relay creation', async function () {
        await createTotem(
            totems,
            market,
            seller,
            "RELAYB",
            18,
            [{ recipient: seller, amount: 1000n }]
        );

        const hash = await totems.write.createRelay([
            "RELAYB",
            erc20Factory.address,
            "ERC20"
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const relayEvent = events.find(e => e.eventName === 'RelayAuthorized');
        assert.ok(relayEvent, "RelayAuthorized event should be emitted");
        assert.equal(relayEvent.args.ticker, "RELAYB", "Ticker should match");
        assert.ok(relayEvent.args.relay, "Relay address should be present");
    });

    // Event: RelayRevoked
    it('Should emit RelayRevoked event on relay revocation', async function () {
        const relays = await totems.read.getRelays(["RELAYB"]);
        const relayAddress = relays[0].relay;

        const hash = await totems.write.removeRelay([
            "RELAYB",
            relayAddress
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: totemEvents,
            logs: receipt.logs,
        });

        const revokeEvent = events.find(e => e.eventName === 'RelayRevoked');
        assert.ok(revokeEvent, "RelayRevoked event should be emitted");
        assert.equal(revokeEvent.args.ticker, "RELAYB", "Ticker should match");
        assert.equal(revokeEvent.args.relay.toLowerCase(), relayAddress.toLowerCase(), "Relay address should match");
    });

    // Event: ModPublished
    it('Should emit ModPublished event on mod publication', async function () {
        const newMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const fee = await market.read.getFee([ZERO_ADDRESS]);
        const hash = await market.write.publish([
            newMod.address,
            [Hook.Created, Hook.Mint],
            1_000_000n,
            modDetails({ name: "Event Test Mod" }),
            [],
            ZERO_ADDRESS,
        ], { value: fee, account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: marketEvents,
            logs: receipt.logs,
        });

        const publishEvent = events.find(e => e.eventName === 'ModPublished');
        assert.ok(publishEvent, "ModPublished event should be emitted");
        assert.equal(publishEvent.args.mod.toLowerCase(), newMod.address.toLowerCase(), "Contract address should match");
    });

    // Event: ModUpdated
    it('Should emit ModUpdated event on mod update', async function () {
        const hash = await market.write.update([
            testMod.address,
            2_000_000n,
            modDetails({ name: "Updated Test Mod" }),
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: marketEvents,
            logs: receipt.logs,
        });

        const updateEvent = events.find(e => e.eventName === 'ModUpdated');
        assert.ok(updateEvent, "ModUpdated event should be emitted");
        assert.equal(updateEvent.args.mod.toLowerCase(), testMod.address.toLowerCase(), "Contract address should match");
    });

    // Event: ERC20 Transfer
    it('Should emit Transfer event on ERC20 relay transfer', async function () {
        const hash = await erc20Relay.write.transfer([
            buyer,
            100n,
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: erc20Events,
            logs: receipt.logs,
        });

        const transferEvent = events.find(e => e.eventName === 'Transfer');
        assert.ok(transferEvent, "Transfer event should be emitted");
        assert.equal(transferEvent.args.from.toLowerCase(), seller.toLowerCase(), "From address should match");
        assert.equal(transferEvent.args.to.toLowerCase(), buyer.toLowerCase(), "To address should match");
        assert.equal(transferEvent.args.value, 100n, "Value should match");
    });

    // Event: ERC20 Approval
    it('Should emit Approval event on ERC20 relay approval', async function () {
        const hash = await erc20Relay.write.approve([
            buyer,
            1000n,
        ], { account: seller });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        const events = parseEventLogs({
            abi: erc20Events,
            logs: receipt.logs,
        });

        const approvalEvent = events.find(e => e.eventName === 'Approval');
        assert.ok(approvalEvent, "Approval event should be emitted");
        assert.equal(approvalEvent.args.owner.toLowerCase(), seller.toLowerCase(), "Owner should match");
        assert.equal(approvalEvent.args.spender.toLowerCase(), buyer.toLowerCase(), "Spender should match");
        assert.equal(approvalEvent.args.value, 1000n, "Value should match");
    });

});
