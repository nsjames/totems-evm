import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEventLogs } from "viem";
import {createTotem, setupTotemsTest, transfer, ZERO_ADDRESS} from "./helpers.ts";

// ERC20 event ABIs for decoding
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

describe("ERC20 Relay", async function () {
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [seller, buyer, spender] = accounts;

    let erc20Factory: any;
    let erc20Relay: any;


    it("Should deploy the ERC20 relay factory", async function () {
        erc20Factory = await viem.deployContract("TotemERC20Factory", [
            totems.address,
        ]);

        assert.ok(erc20Factory.address);
    });

    it('Should create a totem and deploy ERC20 relay', async function() {
        await createTotem(
            totems,
            market,
            seller,
            "TEST",
            18,
            [
                { recipient: seller, amount: 1000000n },
            ],
            {
                transfer: [],
                mint: [],
                burn: [],
                created: [],
            }
        );

        // Create ERC20 relay
        await totems.write.createRelay([
            "TEST",
            erc20Factory.address,
            "ERC20",
        ], { account: seller });

        const relays = await totems.read.getRelays(["TEST"]);
        assert.equal(relays.length, 1);
        assert(relays.some((r: any) => r.standard === "ERC20"));
        erc20Relay = await viem.getContractAt("IERC20", relays[0].relay);

        assert.ok(erc20Relay.address);
    });

    it('Should verify ERC20 metadata matches totem', async function() {
        const name = await erc20Relay.read.name();
        const symbol = await erc20Relay.read.symbol();
        const decimals = await erc20Relay.read.decimals();
        const totalSupply = await erc20Relay.read.totalSupply();

        assert.equal(name, "TEST Totem");
        assert.equal(symbol, "TEST");
        assert.equal(decimals, 18);
        assert.equal(totalSupply, 1000000n);
    });

    it('Should show correct balance via ERC20 relay', async function() {
        const balance = await erc20Relay.read.balanceOf([seller]);
        assert.equal(balance, 1000000n);

        const buyerBalance = await erc20Relay.read.balanceOf([buyer]);
        assert.equal(buyerBalance, 0n);
    });

    it('Should transfer tokens via ERC20 relay', async function() {
        // Transfer 1000 tokens from seller to buyer
        const transferAmount = 1000n;

        await erc20Relay.write.transfer([
            buyer,
            transferAmount,
        ], { account: seller });

        // Verify balances through ERC20 relay
        const sellerBalance = await erc20Relay.read.balanceOf([seller]);
        const buyerBalance = await erc20Relay.read.balanceOf([buyer]);

        assert.equal(sellerBalance, 999000n);
        assert.equal(buyerBalance, 1000n);

        // Verify balances through Totems match
        const sellerProxyBalance = await totems.read.getBalance(["TEST", seller]);
        const buyerProxyBalance = await totems.read.getBalance(["TEST", buyer]);

        assert.equal(sellerProxyBalance, sellerBalance);
        assert.equal(buyerProxyBalance, buyerBalance);
    });

    it('Should approve spender via ERC20 relay', async function() {
        const approvalAmount = 5000n;

        // Approve spender
        await erc20Relay.write.approve([
            spender,
            approvalAmount,
        ], { account: seller });

        // Check allowance
        const allowance = await erc20Relay.read.allowance([seller, spender]);
        assert.equal(allowance, approvalAmount);
    });

    it('Should transfer from approved account via ERC20 relay', async function() {
        const transferAmount = 2000n;

        // Get initial balances
        const sellerBalanceBefore = await erc20Relay.read.balanceOf([seller]);
        const buyerBalanceBefore = await erc20Relay.read.balanceOf([buyer]);
        const allowanceBefore = await erc20Relay.read.allowance([seller, spender]);

        // Transfer from seller to buyer via spender
        await erc20Relay.write.transferFrom([
            seller,
            buyer,
            transferAmount,
        ], { account: spender });

        // Verify balances changed
        const sellerBalanceAfter = await erc20Relay.read.balanceOf([seller]);
        const buyerBalanceAfter = await erc20Relay.read.balanceOf([buyer]);
        const allowanceAfter = await erc20Relay.read.allowance([seller, spender]);

        assert.equal(sellerBalanceAfter, sellerBalanceBefore - transferAmount);
        assert.equal(buyerBalanceAfter, buyerBalanceBefore + transferAmount);
        assert.equal(allowanceAfter, allowanceBefore - transferAmount);

        // Verify balances through Totems match
        const sellerProxyBalance = await totems.read.getBalance(["TEST", seller]);
        const buyerProxyBalance = await totems.read.getBalance(["TEST", buyer]);

        assert.equal(sellerProxyBalance, sellerBalanceAfter);
        assert.equal(buyerProxyBalance, buyerBalanceAfter);
    });

    it('Should handle unlimited allowance correctly', async function() {
        const maxUint256 = 2n ** 256n - 1n;

        // Approve max amount
        await erc20Relay.write.approve([
            spender,
            maxUint256,
        ], { account: buyer });

        const allowanceBefore = await erc20Relay.read.allowance([buyer, spender]);
        assert.equal(allowanceBefore, maxUint256);

        // Transfer some tokens
        await erc20Relay.write.transferFrom([
            buyer,
            seller,
            500n,
        ], { account: spender });

        // Allowance should still be max (unlimited)
        const allowanceAfter = await erc20Relay.read.allowance([buyer, spender]);
        assert.equal(allowanceAfter, maxUint256);
    });

    it('Should fail transferFrom with insufficient allowance', async function() {
        // Reset allowance to a low amount
        await erc20Relay.write.approve([
            spender,
            100n,
        ], { account: seller });

        // Try to transfer more than allowed
        await assert.rejects(async () => {
            await erc20Relay.write.transferFrom([
                seller,
                buyer,
                200n,
            ], { account: spender });
        }, /insufficient allowance/);
    });

    it('Should sync state between direct proxy transfers and ERC20 transfers', async function() {
        const initialSellerBalance = await erc20Relay.read.balanceOf([seller]);

        // Transfer via Totems directly
        await transfer(
            totems,
            "TEST",
            seller,
            buyer,
            100n,
            "Direct proxy transfer"
        );

        // Verify ERC20 relay shows updated balance
        const sellerBalanceAfterProxy = await erc20Relay.read.balanceOf([seller]);
        assert.equal(sellerBalanceAfterProxy, initialSellerBalance - 100n);

        // Transfer via ERC20 relay
        await erc20Relay.write.transfer([
            buyer,
            100n,
        ], { account: seller });

        // Verify Totems shows updated balance
        const sellerProxyBalance = await totems.read.getBalance(["TEST", seller]);
        assert.equal(sellerProxyBalance, initialSellerBalance - 200n);
    });

    it('Should handle zero address checks in approve', async function() {
        await assert.rejects(async () => {
            await erc20Relay.write.approve([
                ZERO_ADDRESS,
                1000n,
            ], { account: seller });
        }, /approve to zero address/);
    });

    it('Should emit Transfer events on transfer', async function() {
        const hash = await erc20Relay.write.transfer([
            buyer,
            50n,
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
        assert.equal(transferEvent.args.value, 50n, "Value should match");
    });

    it('Should emit Approval events on approve', async function() {
        const hash = await erc20Relay.write.approve([
            spender,
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
        assert.equal(approvalEvent.args.spender.toLowerCase(), spender.toLowerCase(), "Spender should match");
        assert.equal(approvalEvent.args.value, 1000n, "Value should match");
    });

    it('Should create relay for totem with different decimals', async function() {
        await createTotem(
            totems,
            market,
            seller,
            "USDC",
            6,
            [
                { recipient: seller, amount: 1000000n },
            ],
            {
                transfer: [],
                mint: [],
                burn: [],
                created: [],
            }
        );

        // Create ERC20 relay
        await totems.write.createRelay([
            "USDC",
            erc20Factory.address,
            "ERC20",
        ], { account: seller });

        const relays = await totems.read.getRelays(["USDC"]);
        assert.equal(relays.length, 1);
        assert(relays.some((r: any) => r.standard === "ERC20"));
        erc20Relay = await viem.getContractAt("IERC20", relays[0].relay);

        assert.ok(erc20Relay.address);

        const decimals = await erc20Relay.read.decimals();
        assert.equal(decimals, 6);
    });
});