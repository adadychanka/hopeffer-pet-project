import { createRequire } from 'node:module';

export interface PackageInfo {
  name: string;
  version: string;
}

// package.json sits two levels up from both src/logger and dist/logger. It is
// always deployed next to dist/, because Node reads `"type": "module"` from it.
const require = createRequire(import.meta.url);

export function packageInfo(): PackageInfo {
  const { name, version } = require('../../package.json') as PackageInfo;
  return { name, version };
}
