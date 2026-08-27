import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPaths = [
  new URL("../.github/workflows/quality.yml", import.meta.url),
  new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url),
];

test("keeps hosted workflows manual and on standard public-repository runners", async () => {
  for (const path of workflowPaths) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /on:\n  workflow_dispatch:/);
    assert.doesNotMatch(
      workflow,
      /^\s{2}(?:push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m,
    );
    assert.match(workflow, /^\s+runs-on: ubuntu-latest$/m);
    assert.doesNotMatch(workflow, /MED250_GITHUB_(?:FREE_ACCOUNT|ACTIONS_FREE_TIER)_CONFIRMED/);
  }
});

test("keeps deployment confirmation and production environment protection", async () => {
  const workflow = await readFile(workflowPaths[1], "utf8");
  assert.match(workflow, /DEPLOY MED250 LIVE/);
  assert.match(workflow, /environment: med250-production/);
  assert.match(workflow, /npm run release:preflight:live/);
  assert.doesNotMatch(workflow, /operational activation|launch:go-live:status|continue-on-error/);
});
