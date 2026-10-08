import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { githubReleaseConfig, repoRoot } from './github_release_config.mjs';

const { endpoint, repo } = githubReleaseConfig();
const overlay = JSON.stringify({
  plugins: {
    updater: {
      endpoints: [endpoint],
    },
  },
});

console.log(`Updater endpoint: ${endpoint}`);
const result = spawnSync(
  'npx',
  ['@tauri-apps/cli', 'build', '--config', overlay, ...process.argv.slice(2)],
  {
    cwd: resolve(repoRoot, 'frontend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, UPDATE_GITHUB_REPO: repo },
  },
);

process.exit(result.status ?? 1);
