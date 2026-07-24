import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const QUALITY_WORKFLOW = new URL("../.github/workflows/quality.yml", import.meta.url);
const DEPLOY_WORKFLOW = new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url);
const FREE_TIER_GUARD =
  "if: ${{ vars.MED250_GITHUB_ACTIONS_FREE_TIER_CONFIRMED == 'true' }}";

test("keeps GitHub-hosted quality checks manual and free-tier gated", async () => {
  const workflow = await readFile(QUALITY_WORKFLOW, "utf8");

  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):/m);
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
