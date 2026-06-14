# @ruflo/host-github-actions

The **9th host adapter** for [agent-harness-generator](https://github.com/ruvnet/agent-harness-generator) — GitHub Actions (ADR-033).

The eight other hosts are interactive: a human starts a session and sees the
result. GitHub Actions is different in kind — a CI/CD runtime with **no human
at the keyboard**. Execution is triggered by a webhook (push, PR, issue
comment, schedule); the harness must complete a task autonomously, emit
structured output, and exit cleanly.

## What it emits

`adapter.generateConfig(spec)` returns:

| File | Purpose |
|---|---|
| `.github/workflows/<name>.yml` | the trigger workflow (default: manual dispatch + issue-comment) |
| `.github/actions/<name>/action.yml` | a reusable composite action the workflow calls |
| `install.md` | wiring + permissions runbook |

## Default-deny → least-privilege token

ADR-022's default-deny posture is preserved, but enforcement shifts from the
in-process `mcp-policy.json` gate to the workflow's own `permissions:` block.
The adapter starts from `contents: read` and grants **only** the scopes the
harness policy's allow-list implies:

| allow token (regex) | GitHub scope granted |
|---|---|
| `create-pr`, `push-branch`, `pull-request` | `contents: write`, `pull-requests: write` |
| `issue`, `label`, `triage` | `issues: write` |
| `checks`, `status` | `checks: write` |

Anything unmapped stays denied (omitted). For production-touching jobs, gate
behind a GitHub Environment with required reviewers — the `permissions:` block
scopes the token; the Environment adds the human review it cannot.

## Usage

```ts
import adapter from '@ruflo/host-github-actions';

const files = adapter.generateConfig({
  name: 'release-bot',
  description: 'cuts releases on tag push',
  permissions: { allow: ['create-pr', 'label-issue'] },
});
// → { '.github/workflows/release-bot.yml', '.github/actions/release-bot/action.yml', 'install.md' }
```

Or scaffold a full harness:

```bash
npx metaharness my-bot --template minimal --host github-actions
```

## License

MIT.
