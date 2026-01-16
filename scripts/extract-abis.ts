import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_DIR = path.join(import.meta.dirname, '..', 'artifacts');
const ABIS_DIR = path.join(import.meta.dirname, '..', 'abis');

const CONTRACTS = [
    {
        name: 'totems',
        artifactPath: 'contracts/interfaces/ITotems.sol/ITotems.json'
    },
    {
        name: 'market',
        artifactPath: 'contracts/interfaces/IMarket.sol/IMarket.json'
    }
];

function extractAbis() {
    // Create abis directory if it doesn't exist
    if (!fs.existsSync(ABIS_DIR)) {
        fs.mkdirSync(ABIS_DIR, { recursive: true });
    }

    for (const contract of CONTRACTS) {
        const artifactFullPath = path.join(ARTIFACTS_DIR, contract.artifactPath);

        if (!fs.existsSync(artifactFullPath)) {
            console.error(`Artifact not found: ${artifactFullPath}`);
            console.error('Run "npx hardhat build" first to generate artifacts.');
            process.exit(1);
        }

        const artifact = JSON.parse(fs.readFileSync(artifactFullPath, 'utf-8'));
        const abi = artifact.abi;

        const outputPath = path.join(ABIS_DIR, `${contract.name}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(abi, null, 2));

        console.log(`Extracted ${contract.name} ABI to ${outputPath}`);
    }

    console.log('Done!');
}

extractAbis();
