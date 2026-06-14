// SPDX-License-Identifier: MIT
//
// iter 102 — `harness audit --bundle` emits the full audit verdict
// as a single JSON. Same pattern as iter-90 diag --bundle.

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(__dirname, '..');

let auditCmd: (args: string[]) => Promise<{ code: number; lines: string[] }>;

beforeAll(async () => {
  const distPath = resolve(REPO_ROOT, 'packages', 'create-agent-harness', 'dist', 'audit-cmd.js');
  if (!existsSync(distPath)) throw new Error('build first');
  const mod = await import(`file://${distPath}`);
  auditCmd = mod.auditCmd;
});

describe('harness audit --bundle (iter 102)', () => {
  it('--bundle emits parseable JSON on no-package-json error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-audit-empty-'));
    try {
      const r = await auditCmd([dir, '--bundle']);
      expect(r.code).toBe(1);
      const b = JSON.parse(r.lines.join('\n'));
      expect(b.schema).toBe(1);
      expect(b.error).toBe('no-package-json');
      expect(b.dir).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--bundle emits parseable JSON on no-lockfile error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-audit-nolock-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'a', version: '0.1.0' }));
      const r = await auditCmd([dir, '--bundle']);
      expect(r.code).toBe(1);
      const b = JSON.parse(r.lines.join('\n'));
      expect(b.error).toBe('no-lockfile');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--bundle emits parseable JSON on unknown-level error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-audit-bad-level-'));
    try {
      const r = await auditCmd([dir, '--bundle', '--level=not-a-level']);
      expect(r.code).toBe(2);
      const b = JSON.parse(r.lines.join('\n'));
      expect(b.error).toBe('unknown-level');
      expect(b.level).toBe('not-a-level');
      expect(b.validLevels).toContain('high');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('non-bundle (default) mode still produces text output, not JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ahg-audit-text-'));
    try {
      const r = await auditCmd([dir]);
      const txt = r.lines.join('\n');
      expect(() => JSON.parse(txt)).toThrow();
      expect(txt).toMatch(/harness audit —/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
