#!/usr/bin/env node
// Merges one signed updater bundle into a Tauri latest.json for GitHub Releases.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { githubReleaseConfig } from './github_release_config.mjs';

const { repo, tagPrefix, manifestName } = githubReleaseConfig();

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing ${name}`);
  }
  return process.argv[index + 1];
}

const version = arg('--version');
const platform = arg('--platform');
const bundle = arg('--bundle');
const signaturePath = arg('--signature');
const out = arg('--out');

let manifest = {
  version,
  notes: `KKR ERP ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {},
};

try {
  const existing = JSON.parse(readFileSync(out, 'utf8'));
  if (existing && typeof existing === 'object' && existing.platforms) {
    manifest = existing;
  }
} catch {
  // A new manifest is created when this platform is the first one written.
}

manifest.version = version;
manifest.notes = `KKR ERP ${version}`;
manifest.pub_date = new Date().toISOString();
manifest.platforms[platform] = {
  signature: readFileSync(signaturePath, 'utf8').trim(),
  url: `https://github.com/${repo}/releases/download/${tagPrefix}${version}/${encodeURIComponent(basename(bundle))}`,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updater manifest written to ${out}`);
console.log(`Publish GitHub release ${tagPrefix}${version} on ${repo} and upload ${manifestName}.`);
