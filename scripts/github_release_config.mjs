import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function pick(name, fileEnv, fallback = '') {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.trim()) return fromProcess.trim();
  const fromFile = fileEnv[name];
  if (fromFile && fromFile.trim()) return fromFile.trim();
  return fallback;
}

export function githubReleaseConfig() {
  const fileEnv = readEnvFile(resolve(repoRoot, '.env'));
  const repo = pick('UPDATE_GITHUB_REPO', fileEnv);
  const tagPrefix = pick('UPDATE_GITHUB_TAG_PREFIX', fileEnv, 'v');
  const manifestName = pick('UPDATE_MANIFEST_NAME', fileEnv, 'latest.json');

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('Set UPDATE_GITHUB_REPO in .env to owner/name, for example Ragworx/KKR.');
  }
  if (!/^[A-Za-z0-9._-]*$/.test(tagPrefix)) {
    throw new Error('UPDATE_GITHUB_TAG_PREFIX may only contain letters, numbers, dots, underscores, and hyphens.');
  }
  if (!manifestName || manifestName.includes('/') || manifestName.includes('\\')) {
    throw new Error('UPDATE_MANIFEST_NAME must be a file name such as latest.json.');
  }

  const endpoint = `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(manifestName)}`;
  return { repo, tagPrefix, manifestName, endpoint };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = githubReleaseConfig();
  const field = process.argv[2];
  if (field && field !== '--json') {
    const value = config[field.replace(/^--/, '')];
    if (!value) throw new Error(`Unknown field ${field}`);
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(config)}\n`);
  }
}
