import { execSync } from 'child_process';
import * as readline from 'readline';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getCurrentTag(): string | null {
  const tag = exec('git describe --tags --abbrev=0 2>/dev/null');
  return tag || null;
}

function parseVersion(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function incrementVersion(version: { major: number; minor: number; patch: number }, type: 'major' | 'minor' | 'patch'): string {
  switch (type) {
    case 'major':
      return `v${version.major + 1}.0.0`;
    case 'minor':
      return `v${version.major}.${version.minor + 1}.0`;
    case 'patch':
      return `v${version.major}.${version.minor}.${version.patch + 1}`;
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('Foundry Package Publisher\n');

  // Check for uncommitted changes
  const status = exec('git status --porcelain');
  if (status) {
    console.error('Error: You have uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  // Get current tag
  const currentTag = getCurrentTag();
  if (currentTag) {
    console.log(`Current tag: ${currentTag}`);
  } else {
    console.log('Current tag: (none)');
  }

  // Calculate suggested next versions
  let suggestions: string[] = [];
  if (currentTag) {
    const version = parseVersion(currentTag);
    if (version) {
      suggestions = [
        incrementVersion(version, 'patch'),
        incrementVersion(version, 'minor'),
        incrementVersion(version, 'major'),
      ];
      console.log(`\nSuggested versions:`);
      console.log(`  1. ${suggestions[0]} (patch)`);
      console.log(`  2. ${suggestions[1]} (minor)`);
      console.log(`  3. ${suggestions[2]} (major)`);
    }
  } else {
    suggestions = ['v0.1.0'];
    console.log(`\nSuggested initial version: v0.1.0`);
  }

  // Prompt for version
  const input = await prompt('\nEnter version (1/2/3 or custom, e.g. v1.0.0): ');

  let newTag: string;
  if (input === '1' && suggestions[0]) {
    newTag = suggestions[0];
  } else if (input === '2' && suggestions[1]) {
    newTag = suggestions[1];
  } else if (input === '3' && suggestions[2]) {
    newTag = suggestions[2];
  } else if (input.match(/^v?\d+\.\d+\.\d+$/)) {
    newTag = input.startsWith('v') ? input : `v${input}`;
  } else {
    console.error('Invalid version format. Expected: v1.0.0 or 1.0.0');
    process.exit(1);
  }

  // Confirm
  const confirm = await prompt(`\nCreate and push tag ${newTag}? (y/N): `);
  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  // Create tag
  console.log(`\nCreating tag ${newTag}...`);
  try {
    execSync(`git tag ${newTag}`, { stdio: 'inherit' });
  } catch {
    console.error('Failed to create tag.');
    process.exit(1);
  }

  // Push tag
  console.log(`Pushing tag ${newTag}...`);
  try {
    execSync(`git push origin ${newTag}`, { stdio: 'inherit' });
  } catch {
    console.error('Failed to push tag. You may need to push manually.');
    process.exit(1);
  }

  console.log(`\nSuccessfully published ${newTag}!`);
  console.log(`\nUsers can now install with:`);
  console.log(`  forge install <your-org>/totems-evm@${newTag}`);
}

main();
