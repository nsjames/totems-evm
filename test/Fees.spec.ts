import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {burn, createTotem, getBalance, setupTotemsTest, transfer, ZERO_ADDRESS, MIN_BASE_FEE} from "./helpers.ts";

describe("Fees", async function () {
    let testMod;
    const {
        totems,
        market,
        accounts,
    } = await setupTotemsTest();
    const [referrer, seller, buyer] = accounts;


    it("Totems: Should get MIN_BASE_FEE as the fee for no referral address", async function () {
        const fee = await totems.read.getFee([ZERO_ADDRESS]);
        assert.equal(fee, MIN_BASE_FEE);
    });

    it("Totems: Should register a fee as a referrer", async function () {
        await totems.write.setReferrerFee([MIN_BASE_FEE + 100n], { account: referrer });
        const fee = await totems.read.getFee([referrer]);
        assert.equal(fee, MIN_BASE_FEE + 100n);
    });

    it('Totems: Should not be able to set a fee below the minimum', async function () {
        await assert.rejects(
            totems.write.setReferrerFee([MIN_BASE_FEE - 1n], { account: referrer }),
            /ReferrerFeeTooLow/
        );
    });

    it("Market: Should get MIN_BASE_FEE as the fee for no referral address", async function () {
        const fee = await market.read.getFee([ZERO_ADDRESS]);
        assert.equal(fee, MIN_BASE_FEE);
    });

    it("Market: Should register a fee as a referrer", async function () {
        await market.write.setReferrerFee([MIN_BASE_FEE + 100n], { account: referrer });
        const fee = await market.read.getFee([referrer]);
        assert.equal(fee, MIN_BASE_FEE + 100n);
    });

    it('Market: Should not be able to set a fee below the minimum', async function () {
        await assert.rejects(
            market.write.setReferrerFee([MIN_BASE_FEE - 1n], { account: referrer }),
            /ReferrerFeeTooLow/
        );
    });
});