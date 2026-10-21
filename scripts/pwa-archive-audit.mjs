#!/usr/bin/env node
// Read-only public Vite asset inventory. Never inspect file contents, delete, or report paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HASHED_PUBLIC_ASSET = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(js|css|svg|png|webp|woff|woff2|jpg|jpeg|gif|avif|wasm)$/;
const SAFE_DIRECTORY = /^[A-Za-z0-9_-]+$/;
const MAX_DEPTH = 32;
const MAX_FILES = 1_000_000;

function checkedAdd(a, b) {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new Error('archive counters exceed safe integer range');
  return n;
}

export function auditPublicAssetArchive(root) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('an explicit archive root is required');
  const absoluteRoot = path.resolve(root);
  const rootStat = fs.lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('unsafe archive root');

  const countByExtension = new Map();
  const uniqueInodes = new Set();
  const stack = [{ absolute: absoluteRoot, relative: '', depth: 0 }];
  let fileCount = 0;
  let logicalBytes = 0;
  let uniqueInodeBytes = 0;
  let allocatedBytes = 0;
  let hasAllocationData = true;
  let directoryCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current.absolute, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('symbolic links are forbidden in a public archive');
      const relative = current.relative ? current.relative + '/' + entry.name : entry.name;
      if (stat.isDirectory()) {
        if (!SAFE_DIRECTORY.test(entry.name) || current.depth >= MAX_DEPTH) {
          throw new Error('unsafe directory name or archive nesting');
        }
        directoryCount = checkedAdd(directoryCount, 1);
        stack.push({ absolute, relative, depth: current.depth + 1 });
        continue;
      }
      const match = stat.isFile() ? HASHED_PUBLIC_ASSET.exec(relative) : null;
      if (!match) throw new Error('non-public, unhashed, or special archive entry');
      fileCount = checkedAdd(fileCount, 1);
      if (fileCount > MAX_FILES) throw new Error('archive inventory file limit exceeded');
      logicalBytes = checkedAdd(logicalBytes, stat.size);
      const ext = match[1];
      const previous = countByExtension.get(ext) || { files: 0, bytes: 0 };
      countByExtension.set(ext, {
        files: checkedAdd(previous.files, 1),
        bytes: checkedAdd(previous.bytes, stat.size),
      });
      const inodeKey = stat.ino && stat.nlink > 1 ? String(stat.dev) + ':' + String(stat.ino) : null;
      if (!inodeKey || !uniqueInodes.has(inodeKey)) {
        if (inodeKey) uniqueInodes.add(inodeKey);
        uniqueInodeBytes = checkedAdd(uniqueInodeBytes, stat.size);
        if (typeof stat.blocks === 'number' && Number.isSafeInteger(stat.blocks)) {
          allocatedBytes = checkedAdd(allocatedBytes, stat.blocks * 512);
        } else {
          hasAllocationData = false;
        }
      }
    }
  }
  return {
    schema: 'xdrive-public-asset-archive-audit-v1',
    public_hashed_assets_only: true,
    read_only: true,
    files: fileCount,
    directories: directoryCount,
    logical_bytes: logicalBytes,
    inode_unique_bytes: uniqueInodeBytes,
    allocated_bytes: hasAllocationData ? allocatedBytes : null,
    extensions: Object.fromEntries([...countByExtension.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/pwa-archive-audit.mjs ARCHIVE_DIR');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(auditPublicAssetArchive(process.argv[2])));
    } catch {
      // No paths or names in errors: the operator may have passed a private directory.
      console.error('xDrive PWA audit: unsafe or unreadable public archive; no statistics emitted');
      process.exitCode = 1;
    }
  }
}
