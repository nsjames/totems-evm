import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';

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
  ],
};

console.log('Building @totems/evm package...\n');

// Clean existing directories
const dirsToClean = [...Object.keys(PACKAGE_STRUCTURE), 'test'];
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
    console.log(`Copied: ${file.src} -> ${dir}/${file.dest}`);
  }
}

// Copy test helpers
const testDestDir = join(PACKAGE_DIR, 'test');
mkdirSync(testDestDir, { recursive: true });
const helpersSrc = join(TEST_DIR, 'helpers.ts');
const helpersDest = join(testDestDir, 'helpers.ts');
cpSync(helpersSrc, helpersDest);
console.log(`Copied: test/helpers.ts -> test/helpers.ts`);

console.log('\nPackage built successfully!');
console.log('\nStructure:');
console.log('  @totems/evm/mods/       - TotemMod.sol, TotemsLibrary.sol');
console.log('  @totems/evm/interfaces/ - ITotems.sol, IMarket.sol, etc.');
console.log('  @totems/evm/contracts/  - Totems.sol, ModMarket.sol, etc.');
console.log('  @totems/evm/test/       - helpers.ts');
console.log(`\nTo publish:\n  npm run publish:npm`);
