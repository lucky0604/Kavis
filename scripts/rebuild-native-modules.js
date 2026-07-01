#!/usr/bin/env node
/**
 * Rebuild native modules for Electron's Node.js ABI
 * 
 * This script runs automatically after pnpm install (via postinstall hook).
 * It ensures native modules like better-sqlite3 and node-pty are compiled
 * against Electron's Node.js ABI, not the system Node.js.
 * 
 * Why: Electron bundles its own Node.js with a different ABI than system Node.
 * Native modules must be recompiled with Electron's headers to work.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();

// Get Electron version from package.json
let electronVersion;
try {
  const pkgJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const electronDep = pkgJson.devDependencies?.electron || pkgJson.dependencies?.electron;
  if (!electronDep) {
    console.log('No Electron dependency found, skipping native module rebuild');
    process.exit(0);
  }
  // Extract version (handles "^42.4.1", "42.4.1", etc.)
  electronVersion = electronDep.replace(/^[\^~]/, '');
} catch (err) {
  console.error('Failed to read Electron version from package.json:', err.message);
  process.exit(1);
}

console.log(`Rebuilding native modules for Electron v${electronVersion}...`);

// List of native modules to rebuild
const nativeModules = ['better-sqlite3', 'node-pty'];

for (const moduleName of nativeModules) {
  const modulePath = join(projectRoot, 'node_modules', moduleName);
  
  if (!existsSync(modulePath)) {
    console.log(`  ${moduleName}: not installed, skipping`);
    continue;
  }
  
  console.log(`  Rebuilding ${moduleName}...`);
  
  try {
    // Remove existing build to force full rebuild
    execSync(`rm -rf ${join(modulePath, 'build')}`, { stdio: 'inherit' });
    
    // Rebuild with Electron's Node.js headers
    execSync(
      `cd ${modulePath} && npx node-gyp rebuild ` +
      `--target=${electronVersion} ` +
      `--arch=${process.arch} ` +
      `--dist-url=https://electronjs.org/headers`,
      { 
        stdio: 'inherit',
        env: { ...process.env, npm_config_yes: 'true' }
      }
    );
    
    console.log(`  ✓ ${moduleName} rebuilt successfully`);
  } catch (err) {
    console.error(`  ✗ Failed to rebuild ${moduleName}:`, err.message);
    process.exit(1);
  }
}

console.log('All native modules rebuilt for Electron ✅');