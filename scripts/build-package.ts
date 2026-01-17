import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const PACKAGE_DIR = join(ROOT, 'package');
const CONTRACTS_DIR = join(ROOT, 'contracts');
const TEST_DIR = join(ROOT, 'test');

// New package structure:
// @totems/evm/mods/       - TotemMod.sol & TotemsLibrary.sol
// @totems/evm/contracts/  - Totems, Market, Shared contracts
// @totems/evm/interfaces/ - All interfaces
// @totems/evm/test/       - Test helpers

const PACKAGE_STRUCTURE = {
  // @totems/evm/mods/
  'mods': [
    { src: 'interfaces/TotemMod.sol', dest: 'TotemMod.sol' },
    { src: 'library/TotemsLibrary.sol', dest: 'TotemsLibrary.sol' },
  ],
  // @totems/evm/interfaces/
  'interfaces': [
    { src: 'interfaces/ITotems.sol', dest: 'ITotems.sol' },
    { src: 'interfaces/IMarket.sol', dest: 'IMarket.sol' },
    { src: 'interfaces/IRelayFactory.sol', dest: 'IRelayFactory.sol' },
    { src: 'library/ITotemTypes.sol', dest: 'ITotemTypes.sol' },
  ],
  // @totems/evm/contracts/
  'contracts': [
    // Totems
    { src: 'totems/Errors.sol', dest: 'Errors.sol' },
    { src: 'totems/Totems.sol', dest: 'Totems.sol' },
    // Market
    { src: 'market/ModMarket.sol', dest: 'ModMarket.sol' },
    // Shared
    { src: 'shared/Shared.sol', dest: 'Shared.sol' },
    { src: 'shared/ReentrancyGuard.sol', dest: 'ReentrancyGuard.sol' },
    // ProxyMod
    { src: 'mods/ProxyMod.sol', dest: 'ProxyMod.sol' },
  ],
};

// Import rewrites for the flattened package structure
// Maps from original import path patterns to new paths based on destination folder
const IMPORT_REWRITES: Record<string, Record<string, string>> = {
  'contracts': {
    // Shared files are now in contracts/
    '"../shared/ReentrancyGuard.sol"': '"./ReentrancyGuard.sol"',
    '"../shared/Shared.sol"': '"./Shared.sol"',
    // Errors is in contracts/
    '"../totems/Errors.sol"': '"./Errors.sol"',
    // TotemMod moved to mods/
    '"../interfaces/TotemMod.sol"': '"../mods/TotemMod.sol"',
    // ITotemTypes moved to interfaces/
    '"../library/ITotemTypes.sol"': '"../interfaces/ITotemTypes.sol"',
    // TotemsLibrary moved to mods/
    '"../library/TotemsLibrary.sol"': '"../mods/TotemsLibrary.sol"',
    // Remove hardhat console import (dev only)
    'import "hardhat/console.sol";\n': '',
  },
  'mods': {
    // ITotemTypes moved to interfaces/
    '"../library/ITotemTypes.sol"': '"../interfaces/ITotemTypes.sol"',
    // TotemsLibrary is in same folder
    '"../library/TotemsLibrary.sol"': '"./TotemsLibrary.sol"',
  },
  'interfaces': {
    // ITotemTypes is in same folder
    '"../library/ITotemTypes.sol"': '"./ITotemTypes.sol"',
  },
};

function rewriteImports(filePath: string, folder: string): void {
  const rewrites = IMPORT_REWRITES[folder];
  if (!rewrites) return;

  let content = readFileSync(filePath, 'utf-8');
  let modified = false;

  for (const [from, to] of Object.entries(rewrites)) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(filePath, content);
  }
}

console.log('Building @totems/evm package...\n');

// Artifacts needed for test helpers (setupTotemsTest deploys these)
const ARTIFACTS_DIR = join(ROOT, 'artifacts/contracts');
const ARTIFACTS_TO_COPY = [
  { src: 'mods/ProxyMod.sol/ProxyMod.json', dest: 'ProxyMod.json' },
  { src: 'market/ModMarket.sol/ModMarket.json', dest: 'ModMarket.json' },
  { src: 'totems/Totems.sol/Totems.json', dest: 'Totems.json' },
  { src: 'interfaces/ITotems.sol/ITotems.json', dest: 'ITotems.json' },
  { src: 'interfaces/IMarket.sol/IMarket.json', dest: 'IMarket.json' },
];

// Clean existing directories
const dirsToClean = [...Object.keys(PACKAGE_STRUCTURE), 'test', 'artifacts'];
for (const dir of dirsToClean) {
  const destDir = join(PACKAGE_DIR, dir);
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true });
    console.log(`Cleaned: ${dir}/`);
  }
}

// Create directories and copy files
for (const [dir, files] of Object.entries(PACKAGE_STRUCTURE)) {
  const destDir = join(PACKAGE_DIR, dir);
  mkdirSync(destDir, { recursive: true });

  for (const file of files) {
    const srcPath = join(CONTRACTS_DIR, file.src);
    const destPath = join(destDir, file.dest);

    if (!existsSync(srcPath)) {
      console.error(`ERROR: File not found: ${srcPath}`);
      process.exit(1);
    }

    cpSync(srcPath, destPath);
    rewriteImports(destPath, dir);
    console.log(`Copied: ${file.src} -> ${dir}/${file.dest}`);
  }
}

// Copy test helpers (TypeScript source + generate declarations)
const testDestDir = join(PACKAGE_DIR, 'test');
mkdirSync(testDestDir, { recursive: true });
const helpersSrc = join(TEST_DIR, 'helpers.ts');
const helpersDest = join(testDestDir, 'helpers.ts');

cpSync(helpersSrc, helpersDest);
console.log('Copied: test/helpers.ts');

// Generate type declarations with tsc
execSync(`tsc --project scripts/tsconfig.helpers.json`, {
  stdio: 'inherit',
});

console.log('Generated: test/helpers.d.ts');

// Copy artifacts for test helpers
const artifactsDestDir = join(PACKAGE_DIR, 'artifacts');
mkdirSync(artifactsDestDir, { recursive: true });

for (const artifact of ARTIFACTS_TO_COPY) {
  const srcPath = join(ARTIFACTS_DIR, artifact.src);
  const destPath = join(artifactsDestDir, artifact.dest);

  if (!existsSync(srcPath)) {
    console.error(`ERROR: Artifact not found: ${srcPath}`);
    console.error('Run "hardhat compile" first to generate artifacts.');
    process.exit(1);
  }

  cpSync(srcPath, destPath);
  console.log(`Copied artifact: ${artifact.dest}`);
}

console.log('\nPackage built successfully!');
console.log('\nStructure:');
console.log('  @totems/evm/mods/       - TotemMod.sol, TotemsLibrary.sol');
console.log('  @totems/evm/interfaces/ - ITotems.sol, IMarket.sol, etc.');
console.log('  @totems/evm/contracts/  - Totems.sol, ModMarket.sol, etc.');
console.log('  @totems/evm/test/       - helpers.ts, helpers.d.ts');
console.log('  @totems/evm/artifacts/  - Pre-built contract artifacts');
console.log(`\nTo publish:\n  npm run publish:npm`);
