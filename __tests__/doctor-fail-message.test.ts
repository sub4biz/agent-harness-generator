// SPDX-License-Identifier: MIT
//
// iter 93 — when `harness doctor` reports a failure, the message must
// guide the user to the iter-90 support bundle so they can file a
// useful issue.

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(__dirname, '..');

let doctor: (args: string[]) => Promise<{ code: number; lines: string[] }>;

beforeAll(async () => {
  const distPath = resolve(REPO_ROOT, 'packages', 'create-agent-harness', 'dist', 'subcommands.js');
  if (!existsSync(distPath)) {
    throw new Error(`create-agent-harness dist missing — run npm run build first`);
  }
  const mod = await import(`file://${distPath}`);
  doctor = mod.doctor;
});

describe('doctor fail message recommends diag --bundle (iter 93)', () => {
  it('on FAIL, the message includes the diag --bundle suggestion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-doctor-fail-'));
    try {
      // Empty dir → doctor finds no package.json, no .harness, etc.
      const r = await doctor([dir]);
      expect(r.code).toBe(1);
      const out = r.lines.join('\n');
      // The "Next:" suggestion block must point at the bundle command
      expect(out).toMatch(/Next:\s*capture the full diagnostic state/);
      expect(out).toMatch(/harness diag .* --bundle > bundle\.json/);
      // ...and the GitHub issues URL
      expect(out).toContain('github.com/ruvnet/agent-harness-generator/issues');
      // ...and the sanitisation reassurance (so users don't worry about leaks)
      expect(out).toMatch(/secret_\/token_\/key_\/password_ fields are redacted/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the bundle command in the suggestion uses the user-passed path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-doctor-path-'));
    try {
      const r = await doctor([dir]);
      const out = r.lines.join('\n');
      // The suggestion must use the dir the user passed, not cwd
      expect(out).toContain(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
