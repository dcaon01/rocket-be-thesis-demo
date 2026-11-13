/**
 * @keus/rocket-shared - Build Script
 *
 * This script builds the shared package by copying DTOs and enums
 * from the core app source, rewriting imports, and compiling with TypeScript.
 *
 * Usage:
 *   cd libs/rocket-shared
 *   npm run build
 *
 * No source duplication: files are read from apps/core/src/ at build time.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'apps', 'core', 'src');
const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

/**
 * File mapping: package destination (relative to src/) -> core source (relative to CORE).
 * Add new entries here when new DTOs or enums need to be shared.
 */
const FILE_MAP = {
  // Enums
  'enums/notification/operation.enum.ts': 'commons/enums/operation.enum.ts',
  'enums/notification/entity-type.enum.ts': 'commons/enums/entity-type.enum.ts',
  'enums/notification/recipient-type.enum.ts': 'commons/enums/recipient-type.enum.ts',
  'enums/notification/product-message-template.enum.ts': 'commons/enums/product-message-template.enum.ts',
  'enums/tenants/tenant-status.enum.ts': 'modules/tenants/enums/tenant-status.enum.ts',
  'enums/users/user-status.enum.ts': 'modules/users/enums/user-status.enum.ts',
  'enums/trials/trial-status.enum.ts': 'modules/trials/enums/trial-status.enum.ts',
  'enums/accounts/account-type.enum.ts': 'commons/enums/account-type.enum.ts',

  // Classes nested in the DTOs
  'classes/product-error.class.ts': 'commons/classes/product-error.class.ts',

  // DTOs
  'dtos/notification/rocket-notification.dto.ts': 'commons/dtos/rocket-notification.dto.ts',
  'dtos/notification/message-payload.dto.ts': 'commons/dtos/message-payload.dto.ts',
  'dtos/users/user-payload.dto.ts': 'modules/users/dtos/user-payload.dto.ts',
  'dtos/tenants/tenant-payload.dto.ts': 'modules/tenants/dtos/tenant-payload.dto.ts',
  'dtos/trials/trial-payload.dto.ts': 'modules/trials/dtos/trial-payload.dto.ts',
  'dtos/trials/trial-bundle.dto.ts': 'modules/trials/dtos/trial-bundle.dto.ts',
  'dtos/contracts/contract-payload.dto.ts': 'modules/contracts/dtos/contract-payload.dto.ts',
};

/**
 * Import rewrite rules: original import path -> new import path.
 * Fixes relative imports so they resolve correctly within the package structure.
 */
const IMPORT_REWRITES = {
  // Notification DTOs
  '"../enums/operation.enum"': '"../../enums/notification/operation.enum"',
  '"../enums/entity-type.enum"': '"../../enums/notification/entity-type.enum"',
  '"../enums/recipient-type.enum"': '"../../enums/notification/recipient-type.enum"',
  '"../enums/product-message-template.enum"': '"../../enums/notification/product-message-template.enum"',

  // Tenant payload DTOs
  '"../enums/tenant-status.enum"': '"../../enums/tenants/tenant-status.enum"',

  // User payload DTOs
  '"../enums/user-status.enum"': '"../../enums/users/user-status.enum"',

  // Account type, imported by the tenant and user payload DTOs
  '"../../../commons/enums/account-type.enum"': '"../../enums/accounts/account-type.enum"',

  // Error of a product, imported by the tenant and user payload DTOs
  '"../../../commons/classes/product-error.class"': '"../../classes/product-error.class"',

  // Trial payload DTOs
  '"../enums/trial-status.enum"': '"../../enums/trials/trial-status.enum"',

  // Trial bundle DTO (cross-module imports)
  '"../../tenants/dtos/tenant-payload.dto"': '"../tenants/tenant-payload.dto"',
  '"../../users/dtos/user-payload.dto"': '"../users/user-payload.dto"',
};

/**
 * Barrel (index) files: re-export everything for clean imports.
 */
const INDEX_FILES = {
  'enums/notification/index.ts': [
    'export { OperationEnum } from "./operation.enum";',
    'export { EntityTypeEnum } from "./entity-type.enum";',
    'export { RecipientTypeEnum } from "./recipient-type.enum";',
    'export { ProductMessageTemplate } from "./product-message-template.enum";',
  ],
  'enums/tenants/index.ts': [
    'export { TenantStatus } from "./tenant-status.enum";',
  ],
  'enums/users/index.ts': [
    'export { UserStatus } from "./user-status.enum";',
  ],
  'enums/trials/index.ts': [
    'export { TrialStatus } from "./trial-status.enum";',
  ],
  'enums/accounts/index.ts': [
    'export { AccountType } from "./account-type.enum";',
  ],
  'enums/index.ts': [
    'export * from "./accounts";',
    'export * from "./notification";',
    'export * from "./tenants";',
    'export * from "./users";',
    'export * from "./trials";',
  ],
  'classes/index.ts': [
    'export { ProductError } from "./product-error.class";',
  ],
  'dtos/notification/index.ts': [
    'export { RocketNotificationDto } from "./rocket-notification.dto";',
    'export { MessagePayloadDto } from "./message-payload.dto";',
  ],
  'dtos/users/index.ts': [
    'export { UserPayloadDto } from "./user-payload.dto";',
  ],
  'dtos/tenants/index.ts': [
    'export { TenantPayloadDto } from "./tenant-payload.dto";',
  ],
  'dtos/trials/index.ts': [
    'export { TrialPayloadDto } from "./trial-payload.dto";',
    'export { TrialBundleDto } from "./trial-bundle.dto";',
  ],
  'dtos/contracts/index.ts': [
    'export { ContractPayloadDto } from "./contract-payload.dto";',
  ],
  'dtos/index.ts': [
    'export * from "./notification";',
    'export * from "./users";',
    'export * from "./tenants";',
    'export * from "./trials";',
    'export * from "./contracts";',
  ],
  'index.ts': [
    'export * from "./enums";',
    'export * from "./classes";',
    'export * from "./dtos";',
  ],
};

// ── Build ────────────────────────────────────────────────────────────

console.log('@keus/rocket-shared - Building package...\n');

// Clean previous build artifacts
if (fs.existsSync(SRC)) fs.rmSync(SRC, { recursive: true });
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });

// Step 1: Copy source files and rewrite imports
for (const [dest, source] of Object.entries(FILE_MAP)) {
  const srcFile = path.join(CORE, source);
  const destFile = path.join(SRC, dest);

  if (!fs.existsSync(srcFile)) {
    console.warn(`  WARNING: source not found, skipping: ${source}`);
    continue;
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });

  let content = fs.readFileSync(srcFile, 'utf-8');
  for (const [from, to] of Object.entries(IMPORT_REWRITES)) {
    content = content.replaceAll(from, to);
  }

  fs.writeFileSync(destFile, content);
  console.log(`  Copied: ${source} -> ${dest}`);
}

// Step 2: Generate barrel index files
console.log('');
for (const [file, lines] of Object.entries(INDEX_FILES)) {
  const filePath = path.join(SRC, file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  console.log(`  Generated: ${file}`);
}

// Step 3: Compile TypeScript
console.log('\nCompiling TypeScript...');
try {
  execSync('npx tsc -p tsconfig.lib.json', { cwd: __dirname, stdio: 'inherit' });
  console.log('\nBuild completed successfully!');
  console.log(`Output: ${DIST}\n`);
} catch {
  console.error('\nTypeScript compilation failed.');
  process.exit(1);
}
