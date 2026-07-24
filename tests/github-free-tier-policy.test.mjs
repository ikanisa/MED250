import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validateGithubFreeOnlyPolicy,
  validateGithubFreeOnlyWorkflow,
} from "../scripts/validate-github-free-only-policy.mjs";

const QUALITY_WORKFLOW = new URL("../.github/workflows/quality.yml", import.meta.url);
const DEPLOY_WORKFLOW = new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url);
const FREE_TIER_GUARD =
  "if: ${{ vars.MED250_GITHUB_FREE_ACCOUNT_CONFIRMED == 'true' && vars.MED250_GITHUB_ACTIONS_FREE_TIER_CONFIRMED == 'true' }}";

test("keeps GitHub-hosted quality checks manual and free-tier gated", async () => {
  const workflow = await readFile(QUALITY_WORKFLOW, "utf8");

  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(
    workflow,
    /^\s{2}(?:push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m,
  );
  assert.match(workflow, new RegExp(FREE_TIER_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("skips the optional hosted deployment before allocating a runner", async () => {
  const workflow = await readFile(DEPLOY_WORKFLOW, "utf8");
  const guardIndex = workflow.indexOf(FREE_TIER_GUARD);
  const runnerIndex = workflow.indexOf("runs-on: ubuntu-latest");

  assert.ok(guardIndex > 0, "the free-tier guard must be present");
  assert.ok(
    guardIndex < runnerIndex,
    "the free-tier guard must be evaluated before the first hosted runner is allocated",
  );
});

test("validates every workflow against the permanent free-only policy", async () => {
  const result = await validateGithubFreeOnlyPolicy();
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.workflowCount, 2);
});

test("rejects automatic triggers, paid runner classes, and a missing free-account confirmation", () => {
  const automatic = validateGithubFreeOnlyWorkflow(`on:
  push:
jobs:
  check:
    if: \${{ vars.MED250_GITHUB_ACTIONS_FREE_TIER_CONFIRMED == 'true' }}
    runs-on: macos-latest
`);
  assert.equal(automatic.valid, false);
  assert.match(automatic.errors.join("\n"), /workflow_dispatch is required/);
  assert.match(automatic.errors.join("\n"), /automatic workflow triggers are prohibited/);
  assert.match(automatic.errors.join("\n"), /two free-only confirmations are required/);
  assert.match(automatic.errors.join("\n"), /only the standard ubuntu-latest/);
});

test("rejects any later hosted job that can bypass the guarded job", () => {
  const unguarded = validateGithubFreeOnlyWorkflow(`on:
  workflow_dispatch:
jobs:
  guarded:
    if: \${{ vars.MED250_GITHUB_FREE_ACCOUNT_CONFIRMED == 'true' && vars.MED250_GITHUB_ACTIONS_FREE_TIER_CONFIRMED == 'true' }}
    runs-on: ubuntu-latest
  bypass:
    runs-on: ubuntu-latest
`);
  assert.equal(unguarded.valid, false);
  assert.match(unguarded.errors.join("\n"), /job bypass can allocate a runner without a free-only guard/);
});
