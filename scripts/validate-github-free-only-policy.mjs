import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIRECTORY = new URL("../.github/workflows/", import.meta.url);
const REQUIRED_GUARD =
  "if: ${{ vars.MED250_GITHUB_FREE_ACCOUNT_CONFIRMED == 'true' && vars.MED250_GITHUB_ACTIONS_FREE_TIER_CONFIRMED == 'true' }}";
const AUTOMATIC_TRIGGER =
  /^\s{2}(?:push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m;
const RUNNER = /^\s+runs-on:\s*(.+)\s*$/gm;

function workflowJobBlocks(source) {
  const jobsIndex = source.search(/^jobs:\s*$/m);
  if (jobsIndex < 0) return [];
  const jobsSource = source.slice(jobsIndex);
  const headers = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
  return headers.map((header, index) => ({
    id: header[1],
    source: jobsSource.slice(
      header.index,
      headers[index + 1]?.index ?? jobsSource.length,
    ),
  }));
}

export function validateGithubFreeOnlyWorkflow(source, { reference = "workflow" } = {}) {
  const errors = [];
  const dispatchIndex = source.search(/^\s{2}workflow_dispatch:/m);
  const guardIndex = source.indexOf(REQUIRED_GUARD);
  const firstRunnerIndex = source.search(/^\s+runs-on:/m);
  const jobs = workflowJobBlocks(source);
  const guardedJobIds = new Set(
    jobs.filter((job) => job.source.includes(REQUIRED_GUARD)).map((job) => job.id),
  );

  if (dispatchIndex < 0) {
    errors.push(`${reference}: workflow_dispatch is required`);
  }
  if (AUTOMATIC_TRIGGER.test(source)) {
    errors.push(`${reference}: automatic workflow triggers are prohibited`);
  }
  if (guardIndex < 0) {
    errors.push(`${reference}: the two free-only confirmations are required`);
  }
  if (firstRunnerIndex >= 0 && (guardIndex < 0 || guardIndex > firstRunnerIndex)) {
    errors.push(`${reference}: free-only confirmation must run before the first hosted runner is allocated`);
  }

  for (const job of jobs) {
    const runnerMatches = [...job.source.matchAll(RUNNER)];
    if (runnerMatches.length === 0) continue;
    const dependency = job.source.match(/^\s{4}needs:\s*(.+)\s*$/m)?.[1] ?? "";
    const dependsOnGuardedJob = [...guardedJobIds].some((guardedId) =>
      new RegExp(`(?:^|[\\s,[\"'])${guardedId}(?:$|[\\s,\\]\"'])`).test(dependency)
    );
    if (!guardedJobIds.has(job.id) && !dependsOnGuardedJob) {
      errors.push(`${reference}: job ${job.id} can allocate a runner without a free-only guard`);
    }
    for (const match of runnerMatches) {
      if (match[1].trim() !== "ubuntu-latest") {
        errors.push(`${reference}: only the standard ubuntu-latest hosted runner is allowed`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function validateGithubFreeOnlyPolicy({
  workflowsDirectory = WORKFLOWS_DIRECTORY,
} = {}) {
  const directoryPath = fileURLToPath(workflowsDirectory);
  const entries = (await readdir(directoryPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const workflowResults = [];

  for (const entry of entries) {
    const source = await readFile(new URL(entry.name, workflowsDirectory), "utf8");
    workflowResults.push({
      reference: `.github/workflows/${entry.name}`,
      ...validateGithubFreeOnlyWorkflow(source, {
        reference: `.github/workflows/${entry.name}`,
      }),
    });
  }

  const errors = workflowResults.flatMap((result) => result.errors);
  return {
    valid: entries.length > 0 && errors.length === 0,
    workflowCount: entries.length,
    workflowResults,
    errors: entries.length > 0 ? errors : [".github/workflows: no workflows found"],
  };
}

async function main() {
  const result = await validateGithubFreeOnlyPolicy();
  if (!result.valid) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `GitHub free-only policy verified for ${result.workflowCount} manual workflow(s).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
