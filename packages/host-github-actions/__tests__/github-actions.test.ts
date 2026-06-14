// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  HOST_NAME,
  ghaSlug,
  permissionsBlock,
  workflowYaml,
  actionYaml,
  installRunbook,
  adapter,
} from '../src/index.js';
import type { HarnessSpec } from '@ruflo/kernel';

const base: HarnessSpec = { name: 'My Bot', description: 'does things' };

describe('@ruflo/host-github-actions (ADR-033)', () => {
  it('exposes host name github-actions', () => {
    expect(HOST_NAME).toBe('github-actions');
    expect(adapter.name).toBe('github-actions');
  });

  describe('ghaSlug', () => {
    it('slugifies names safely', () => {
      expect(ghaSlug('My Bot')).toBe('my-bot');
      expect(ghaSlug('  Weird__Name!! ')).toBe('weird-name');
      expect(ghaSlug('')).toBe('harness');
    });
  });

  describe('permissionsBlock — default-deny (ADR-022)', () => {
    it('defaults to contents:read only', () => {
      expect(permissionsBlock(base)).toEqual({ contents: 'read' });
    });

    it('grants pull-requests:write + contents:write when allow implies PR', () => {
      const p = permissionsBlock({ ...base, permissions: { allow: ['create-pr'] } });
      expect(p.contents).toBe('write');
      expect(p['pull-requests']).toBe('write');
    });

    it('grants issues:write for label/triage capabilities', () => {
      const p = permissionsBlock({ ...base, permissions: { allow: ['label-issue'] } });
      expect(p.issues).toBe('write');
      // unrelated scopes stay denied (omitted)
      expect(p['pull-requests']).toBeUndefined();
    });

    it('unmapped allow tokens do not widen permissions', () => {
      const p = permissionsBlock({ ...base, permissions: { allow: ['Bash(ls)', 'Read'] } });
      expect(p).toEqual({ contents: 'read' });
    });
  });

  describe('workflowYaml', () => {
    const yml = workflowYaml(base);
    it('names the workflow with the slug', () => {
      expect(yml).toContain('name: my-bot');
    });
    it('has the safe default triggers (dispatch + issue_comment)', () => {
      expect(yml).toContain('workflow_dispatch: {}');
      expect(yml).toContain('issue_comment:');
    });
    it('emits a permissions block', () => {
      expect(yml).toContain('permissions:');
      expect(yml).toContain('contents: read');
    });
    it('calls the local composite action', () => {
      expect(yml).toContain('uses: ./.github/actions/my-bot');
    });
    it('reflects elevated permissions when the policy allows PRs', () => {
      const y = workflowYaml({ ...base, permissions: { allow: ['create-pr'] } });
      expect(y).toContain('contents: write');
      expect(y).toContain('pull-requests: write');
    });
  });

  describe('actionYaml', () => {
    const yml = actionYaml(base);
    it('is a composite action with a task input + result output', () => {
      expect(yml).toContain('using: composite');
      expect(yml).toContain('task:');
      expect(yml).toContain('result:');
    });
    it('escapes the description', () => {
      expect(yml).toContain('description: "does things"');
    });
  });

  describe('installRunbook', () => {
    const md = installRunbook(base);
    it('documents both emitted files + the permissions + prod-safety', () => {
      expect(md).toContain('.github/workflows/my-bot.yml');
      expect(md).toContain('.github/actions/my-bot/action.yml');
      expect(md).toContain('default-deny');
      expect(md).toContain('Environment');
    });
  });

  describe('adapter.generateConfig', () => {
    const out = adapter.generateConfig(base);
    it('emits the workflow, the action, and install.md', () => {
      expect(Object.keys(out).sort()).toEqual([
        '.github/actions/my-bot/action.yml',
        '.github/workflows/my-bot.yml',
        'install.md',
      ]);
    });
    it('every emitted file is non-empty', () => {
      for (const v of Object.values(out)) expect(v.length).toBeGreaterThan(0);
    });
  });
});
