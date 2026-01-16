import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

// These were from a previous run of the Gas.spec.ts tests
// I update these and use them as a baseline when trying to optimize gas costs
const BASELINE = {
    create: 898318n,
    transfer: 98909n,
    mint: 83069n,
    burn: 72399n,
};

async function runGasTest(): Promise<Map<string, bigint>> {
    console.log('Running gas tests...\n');

    const result = execSync(
        'RUN_GAS_CALCS=true npx hardhat test test/Gas.spec.ts 2>&1',
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const gasMap = new Map<string, bigint>();

    // Parse the scaling table output for 1 mod (first data row after header)
    const lines = result.split('\n');
    let inRawGasSection = false;
    let headerFound = false;

    for (const line of lines) {
        if (line.includes('RAW GAS COSTS')) {
            inRawGasSection = true;
            continue;
        }

        if (inRawGasSection && line.startsWith('Mods')) {
            headerFound = true;
            continue;
        }

        if (inRawGasSection && headerFound && line.startsWith('---')) {
            continue;
        }

        // First data row (1 mod)
        if (inRawGasSection && headerFound && line.trim().startsWith('1 ')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
                gasMap.set('create', BigInt(parts[1]));
                gasMap.set('transfer', BigInt(parts[2]));
                gasMap.set('mint', BigInt(parts[3]));
                gasMap.set('burn', BigInt(parts[4]));
            }
            break;
        }
    }

    return gasMap;
}

function calculateChange(baseline: bigint, current: bigint): { diff: bigint, percent: string, direction: string } {
    const diff = current - baseline;
    const percent = ((Number(diff) / Number(baseline)) * 100).toFixed(2);
    const direction = diff > 0n ? '+' : diff < 0n ? '' : '';
    return { diff, percent, direction };
}

async function main() {
    const current = await runGasTest();

    if (current.size === 0) {
        console.error('Failed to parse gas test output');
        process.exit(1);
    }

    console.log('='.repeat(70));
    console.log('GAS COMPARISON: BASELINE vs CURRENT');
    console.log('='.repeat(70));
    console.log('');
    console.log(
        'Operation'.padEnd(15) +
        'Baseline'.padEnd(12) +
        'Current'.padEnd(12) +
        'Diff'.padEnd(10) +
        'Change'
    );
    console.log('-'.repeat(70));

    const operations = ['create', 'transfer', 'mint', 'burn'];

    for (const op of operations) {
        const baseline = BASELINE[op as keyof typeof BASELINE];
        const currentVal = current.get(op);

        if (!currentVal) {
            console.log(`${op.padEnd(15)} - no data -`);
            continue;
        }

        const { diff, percent, direction } = calculateChange(baseline, currentVal);
        const diffStr = `${direction}${diff}`;
        const percentStr = `${direction}${percent}%`;

        console.log(
            op.charAt(0).toUpperCase() + op.slice(1).padEnd(14) +
            baseline.toString().padEnd(12) +
            currentVal.toString().padEnd(12) +
            diffStr.padEnd(10) +
            percentStr
        );
    }

    console.log('='.repeat(70));

    // Summary
    const totalBaseline = Object.values(BASELINE).reduce((a, b) => a + b, 0n);
    const totalCurrent = operations.reduce((sum, op) => sum + (current.get(op) || 0n), 0n);
    const { diff: totalDiff, percent: totalPercent, direction: totalDir } = calculateChange(totalBaseline, totalCurrent);

    console.log('');
    console.log(`Total baseline: ${totalBaseline} gas`);
    console.log(`Total current:  ${totalCurrent} gas`);
    console.log(`Net change:     ${totalDir}${totalDiff} gas (${totalDir}${totalPercent}%)`);
}

main().catch(console.error);
