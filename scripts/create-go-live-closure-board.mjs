import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createLaunchEvidenceHandoff,
  discoverPreparedLaunchEvidence,
} from "./create-launch-evidence-template.mjs";
import { buildGoLiveReadinessReport } from "./report-go-live-readiness.mjs";

const CLOSURE_ORDER = [
  "MED250_GATE_DUPLICATE_REGISTER_REVIEWED",
  "MED250_GATE_GPS_READY",
  "MED250_GATE_WHATSAPP_READY",
  "MED250_GATE_SECURITY_HARDENING_DEPLOYED",
  "MED250_GATE_EDGE_FUNCTIONS_DEPLOYED",
  "MED250_GATE_TURNSTILE_SERVER_VERIFIED",
  "MED250_GATE_AUTH_RATE_LIMITS_APPROVED",
  "MED250_GATE_PRESCRIPTION_RETENTION_APPROVED",
  "MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED",
  "MED250_GATE_DOMAIN_DNS_VERIFIED",
  "MED250_GATE_PHYSICAL_UAT_PASSED",
];

const GATE_GUIDANCE = {
  MED250_GATE_GPS_READY: {
    workstream: "operations",
    closure_focus: "Approve only authoritative pharmacy premises coordinates for the intended responder scope.",
    next_actions: [
      "Regenerate the GPS and WhatsApp operations review index.",
      "Complete the controlled private GPS row-level review ledger for every active pharmacy record.",
      "Reconcile the approved GPS scope with actual routing and dispatch eligibility.",
      "Run strict operational health, then build and record the redacted aggregate review-ledger artifact with accountable operations approval.",
    ],
    commands: [
      "npm run ops:readiness:packet",
      "npm run ops:health:strict",
      "npm run ops:readiness:evidence:build -- --input desktop-output/goal-progress-YYYY-MM-DD/gps-readiness-review-result.json --date YYYY-MM-DD",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/gps-readiness-review-ledger-YYYY-MM-DD.json --replace --confirm --approved-by \"Named operations owner\" --approved-role \"Operations owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_WHATSAPP_READY: {
    workstream: "operations",
    closure_focus: "Approve only pharmacy-authorised WhatsApp identities for the intended responder scope.",
    next_actions: [
      "Regenerate the GPS and WhatsApp operations review index.",
      "Complete the controlled private WhatsApp row-level review ledger for every active pharmacy record.",
      "Reconcile the approved WhatsApp responder scope with login-enabled portal access and routing.",
      "Run strict operational health, then build and record the redacted aggregate review-ledger artifact with accountable operations approval.",
    ],
    commands: [
      "npm run ops:readiness:packet",
      "npm run ops:health:strict",
      "npm run ops:readiness:evidence:build -- --input desktop-output/goal-progress-YYYY-MM-DD/whatsapp-readiness-review-result.json --date YYYY-MM-DD",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/whatsapp-readiness-review-ledger-YYYY-MM-DD.json --replace --confirm --approved-by \"Named operations owner\" --approved-role \"Operations owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_DUPLICATE_REGISTER_REVIEWED: {
    workstream: "register-data",
    closure_focus: "Resolve every synchronized duplicate official identifier without deleting or rewriting source rows to force a pass.",
    next_actions: [
      "Regenerate the duplicate source-comparison packet.",
      "Have a named register data reviewer decide all 51 duplicate groups in the controlled CSV ledger.",
      "Run the strict duplicate verifier and build the redacted review-ledger artifact only after it passes.",
      "Record the artifact and gate approval through the guarded registry helper.",
    ],
    commands: [
      "npm run data:duplicates:packet",
      "npm run data:duplicates:verify -- --strict",
      "npm run data:duplicates:evidence:build -- --date YYYY-MM-DD --reviewed-by \"Named register data reviewer\" --reviewer-role \"Register data reviewer\" --reviewed-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/duplicate-register-review-ledger-YYYY-MM-DD.json --replace --confirm --approved-by \"Named register data reviewer\" --approved-role \"Register data reviewer\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_SECURITY_HARDENING_DEPLOYED: {
    workstream: "backend",
    closure_focus: "Review the complete backend hardening evidence and record real backend-owner approval.",
    next_actions: [
      "Regenerate the approval packet and inspect every referenced deployment/test artifact.",
      "Confirm the evidence still satisfies the backend contract and hardening acceptance criterion.",
      "Record named backend-owner approval without changing evidence facts.",
    ],
    commands: [
      "npm run launch:approval:packet",
      "npm run backend:verify",
      "npm run launch:gate:approve -- --gate MED250_GATE_SECURITY_HARDENING_DEPLOYED --approved-by \"Named backend owner\" --approved-role \"Backend owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_EDGE_FUNCTIONS_DEPLOYED: {
    workstream: "backend",
    closure_focus: "Review the complete Edge Function deployment evidence and record real backend-owner approval.",
    next_actions: [
      "Regenerate the approval packet and inspect every referenced Edge Function deployment/test artifact.",
      "Confirm the active function versions and protected-access boundaries still match the intended release.",
      "Record named backend-owner approval without changing evidence facts.",
    ],
    commands: [
      "npm run launch:approval:packet",
      "npm run backend:verify:description-reviewer -- --product-id \"$MED250_DESCRIPTION_REVIEWER_PROBE_PRODUCT_ID\" --expected-updated-at \"$MED250_DESCRIPTION_REVIEWER_PROBE_EXPECTED_UPDATED_AT\"",
      "npm run launch:gate:approve -- --gate MED250_GATE_EDGE_FUNCTIONS_DEPLOYED --approved-by \"Named backend owner\" --approved-role \"Backend owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_TURNSTILE_SERVER_VERIFIED: {
    workstream: "security",
    closure_focus: "Prove the production widget positive path while keeping invalid/missing-token rejection intact.",
    next_actions: [
      "Run the real production Turnstile widget positive-path test with one disposable anonymous identity.",
      "Delete or revoke the disposable identity and verify aggregate user count returns to the approved baseline.",
      "Build the redacted test artifact from the retained verifier result and record security-owner approval.",
    ],
    commands: [
      "npm run security:turnstile:verify -- --require-valid",
      "npm run security:turnstile:evidence:build -- --input desktop-output/goal-progress-YYYY-MM-DD/turnstile-verifier-result.json --date YYYY-MM-DD --executed-by \"Named security tester\" --executor-role \"Security owner\" --started-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --completed-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --no-marketplace-side-effect-confirmed",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/turnstile-positive-path-test-YYYY-MM-DD.json --replace --confirm --approved-by \"Named security owner\" --approved-role \"Security owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_AUTH_RATE_LIMITS_APPROVED: {
    workstream: "security",
    closure_focus: "Approve the shared Supabase anonymous-auth limits only after impact testing intended access and excess-attempt rejection.",
    next_actions: [
      "Complete the controlled rate-limit test with fresh real widget responses.",
      "Confirm excess anonymous identity creation is rejected and intended customers still complete ordering.",
      "Remove disposable identities and record the project-wide security-owner approval.",
    ],
    commands: [
      "npm run security:turnstile:verify -- --require-valid",
      "npm run security:auth-rate-limit:evidence:build -- --input desktop-output/goal-progress-YYYY-MM-DD/auth-rate-limit-result.json --date YYYY-MM-DD --executed-by \"Named security tester\" --executor-role \"Security owner\" --started-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --completed-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --approved-by \"Named security owner\" --approved-role \"Security owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --next-review-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --change-authority \"Named security owner with shared-project owner notice\" --rollback-criteria \"Restore the prior project setting if aggregate Auth health or legitimate customer access regresses\" --legitimate-peak-profile \"Privacy-safe expected anonymous customer session demand for the launch window\" --abuse-risk-decision \"Selected limit balances launch demand with automated abuse resistance\" --monitoring-decision \"Aggregate Auth and Worker health monitoring remains active through launch and first review\"",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/auth-rate-limit-test-YYYY-MM-DD.json --replace",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/auth-rate-limit-approval-YYYY-MM-DD.json --replace --confirm --approved-by \"Named security owner\" --approved-role \"Security owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_PRESCRIPTION_RETENTION_APPROVED: {
    workstream: "privacy",
    closure_focus: "Approve the implemented prescription retention periods and cleanup schedule against privacy-owner criteria.",
    next_actions: [
      "Review the retention policy and existing controlled cleanup test record.",
      "Build the signed approval artifact with the privacy owner decisions.",
      "Record approval only after the owner accepts the retention periods, cleanup cadence, monitoring and incident conditions.",
    ],
    commands: [
      "npm run privacy:prescription-retention:evidence:build -- --date YYYY-MM-DD --approved-by \"Named privacy owner\" --approved-role \"Privacy owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --next-review-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --legal-basis-decision \"Privacy-safe legal basis decision\" --controller-processor-decision \"Privacy-safe controller and processor decision\" --transfer-decision \"Privacy-safe transfer and evidence-storage decision\" --notification-decision \"Privacy-safe notification assessment decision\" --incident-contacts-decision \"Controlled staff register contains accountable privacy and security incident roles\" --retention-decision \"The implemented 24-hour and 30-day prescription retention periods are accepted\" --pharmacy-handling-decision \"Selected pharmacy staff handling requirements are accepted\" --review-conditions \"Review is required after material workflow, storage, retention, incident or legal-obligation changes\"",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/prescription-retention-approval-YYYY-MM-DD.json --replace --confirm --approved-by \"Named privacy owner\" --approved-role \"Privacy owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED: {
    workstream: "infrastructure",
    closure_focus: "Prove the intended Cloudflare account, route ownership, protected environments and least-privilege deployment credential.",
    next_actions: [
      "Replace any broad release-path access with a credential scoped to the MED+250 Worker, route, assets and read-only zone inspection.",
      "Build the redacted account-verification artifact without exposing account identifiers or tokens.",
      "Build the infrastructure approval artifact and record the gate only after least privilege is true.",
    ],
    commands: [
      "wrangler whoami",
      "npm run infra:cloudflare-account:evidence:build -- --input desktop-output/goal-progress-YYYY-MM-DD/cloudflare-account-result.json --date YYYY-MM-DD --verified-by \"Named infrastructure verifier\" --verifier-role \"Infrastructure owner\" --verified-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --approved-by \"Named infrastructure owner\" --approved-role \"Infrastructure owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --next-review-at \"YYYY-MM-DDTHH:mm:ss+02:00\" --account-ownership-decision \"Redacted account, production Worker and preview Worker are intended MED+250 release assets\" --credential-scope-decision \"Replacement release credential is limited to MED+250 deployment needs and read-only zone inspection\" --release-path-decision \"Broad interactive access is removed from the release path and cannot deploy production\" --environment-ownership-decision \"Protected production and preview environments have named ownership, approval rules, secrets and variables\" --routing-boundary-decision \"The direct production Worker route is the sole active owner of the production hostname\" --rollback-decision \"Rollback authority and emergency release access are assigned to the infrastructure owner group\"",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/cloudflare-account-verification-YYYY-MM-DD.json --replace",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/cloudflare-account-approval-YYYY-MM-DD.json --replace --confirm --approved-by \"Named infrastructure owner\" --approved-role \"Infrastructure owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_DOMAIN_DNS_VERIFIED: {
    workstream: "infrastructure",
    closure_focus: "Review the fresh live domain evidence and record infrastructure-owner approval.",
    next_actions: [
      "Rerun DNS and live deployment verification if any Worker, route, DNS or repository revision changed.",
      "Confirm med-250.com is attached only to the intended Cloudflare Worker route.",
      "Record named infrastructure-owner approval against the current domain and deployment evidence.",
    ],
    commands: [
      "npm run domain:dns:verify",
      "npm run deployment:verify -- --url https://med-250.com --mode live --expected-revision <exact-lowercase-40-character-git-sha> --evidence-output desktop-output/goal-progress-YYYY-MM-DD/domain-deployment-receipt.json",
      "npm run domain:evidence:refresh -- --deployment-evidence desktop-output/goal-progress-YYYY-MM-DD/domain-deployment-receipt.json --expected-revision git --date YYYY-MM-DD",
      "npm run launch:gate:approve -- --gate MED250_GATE_DOMAIN_DNS_VERIFIED --approved-by \"Named infrastructure owner\" --approved-role \"Infrastructure owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
  MED250_GATE_PHYSICAL_UAT_PASSED: {
    workstream: "qa",
    closure_focus: "Execute all physical-device UAT scenarios with opaque approved identities and no unintended pharmacy contact.",
    next_actions: [
      "Regenerate the physical-device UAT packet.",
      "Execute all 12 scenarios on approved physical devices with redacted evidence references.",
      "Update the governed UAT ledger, then build the paired test/approval artifacts from the strict ledger.",
      "Run strict UAT verification, then record QA-owner approval.",
    ],
    commands: [
      "npm run uat:packet",
      "npm run uat:verify:live",
      "npm run uat:evidence:build -- --date YYYY-MM-DD",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/physical-device-uat-test-YYYY-MM-DD.json --replace",
      "npm run launch:evidence:record -- --artifact docs/launch/evidence/physical-device-uat-approval-YYYY-MM-DD.json --replace --confirm --approved-by \"Named QA owner\" --approved-role \"QA owner\" --approved-at \"YYYY-MM-DDTHH:mm:ss+02:00\"",
    ],
  },
};

const COMMON_SAFETY_RULES = [
  "Do not mark a gate confirmed until every required evidence type is recorded and the accountable owner has approved it.",
  "Do not store credentials, tokens, phone numbers, OTPs, customer identifiers, email addresses, prescription contents, exact customer coordinates, or unredacted account identifiers.",
  "Use pending artifacts only as completion workbooks; do not add them to data/launch-evidence.json until they are complete and pass validation.",
  "Keep prepared-evidence and approval work separate; an automated result cannot sign for an accountable owner.",
];

function approvalComplete(gate) {
  return Boolean(
    typeof gate?.approved_by === "string" && gate.approved_by.trim()
    && typeof gate?.approved_role === "string" && gate.approved_role.trim()
    && typeof gate?.approved_at === "string" && gate.approved_at.trim(),
  );
}

function gateSortIndex(gateName) {
  const index = CLOSURE_ORDER.indexOf(gateName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function byGateOrder(left, right) {
  return gateSortIndex(left.gate) - gateSortIndex(right.gate) || left.gate.localeCompare(right.gate);
}

function evidenceState(gateName, gate, handoffGate) {
  const supplied = (gate.evidence ?? []).map((entry) => ({
    type: entry.type,
    reference: entry.reference,
    recorded_at: entry.recorded_at,
    sha256: entry.sha256,
  }));
  const prepared = Object.entries(handoffGate?.prepared_pending_evidence ?? {}).map(([type, artifact]) => ({
    type,
    reference: artifact.reference,
    sha256: artifact.sha256,
    byte_length: artifact.byte_length,
    template_valid: artifact.template_valid,
    unresolved_check_count: artifact.unresolved_checks.length,
    completion_instruction_count: artifact.completion_instructions.length,
  }));
  const suppliedTypes = new Set(supplied.map((entry) => entry.type));
  return {
    required_types: gate.required_evidence_types ?? [],
    supplied,
    missing_types: (gate.required_evidence_types ?? []).filter((type) => !suppliedTypes.has(type)),
    prepared_pending: prepared,
    unprepared_types: handoffGate?.unprepared_evidence_types ?? [],
    ci_launch_gate_variable: gateName,
  };
}

function blockerSummary(gateName, gate, readinessGate, evidence, report) {
  const blockers = [];
  if (evidence.missing_types.length) blockers.push(`Missing required evidence type(s): ${evidence.missing_types.join(", ")}.`);
  if (!approvalComplete(gate)) blockers.push("Missing named accountable-owner approval metadata.");
  if (gateName === "MED250_GATE_DUPLICATE_REGISTER_REVIEWED") {
    blockers.push(`${report.duplicateRegister.decisionCounts.pending} duplicate-register group(s) remain pending in data/imports/duplicate-register-review.csv.`);
  }
  if (gateName === "MED250_GATE_PHYSICAL_UAT_PASSED") {
    blockers.push(`${report.physicalUat.statusCounts.pending} physical-device UAT scenario(s) remain pending in data/physical-device-uat.json.`);
  }
  if (readinessGate?.readiness === "approval_pending") {
    blockers.push("Machine evidence is present; owner review and approval remain deliberately separate.");
  }
  if (readinessGate?.staleReleaseEvidence) {
    blockers.push("Release-bound evidence is stale against the current repository checkout; rerun the exact-revision live verifier before approval.");
  }
  return [...new Set(blockers)];
}

export function buildGoLiveClosureBoard({ manifest, handoff, readinessReport }) {
  const handoffByGate = new Map((handoff.gates ?? []).map((gate) => [gate.gate, gate]));
  const readinessByGate = new Map((readinessReport.gates ?? []).map((gate) => [gate.name, gate]));
  const gates = Object.entries(manifest.gates ?? {})
    .map(([gateName, gate]) => {
      const guidance = GATE_GUIDANCE[gateName] ?? {
        workstream: "unclassified",
        closure_focus: "Complete the missing launch evidence and accountable-owner approval.",
        next_actions: ["Complete the required evidence, validate it, record it, and rerun strict launch evidence verification."],
        commands: ["npm run launch:evidence:verify:live"],
      };
      const handoffGate = handoffByGate.get(gateName);
      const readinessGate = readinessByGate.get(gateName);
      const evidence = evidenceState(gateName, gate, handoffGate);
      return {
        gate: gateName,
        title: gate.title,
        owner: gate.owner,
        workstream: guidance.workstream,
        current_status: gate.status,
        readiness: readinessGate?.readiness ?? "unknown",
        closure_focus: guidance.closure_focus,
        acceptance: gate.acceptance,
        evidence,
        approval: {
          required: true,
          complete: approvalComplete(gate),
          approved_by: gate.approved_by,
          approved_role: gate.approved_role,
          approved_at: gate.approved_at,
        },
        blockers: blockerSummary(gateName, gate, readinessGate, evidence, readinessReport),
        next_actions: guidance.next_actions,
        commands: guidance.commands,
        safety_rules: COMMON_SAFETY_RULES,
      };
    })
    .sort(byGateOrder);

  const ownerWorkstreams = gates.reduce((workstreams, gate) => {
    workstreams[gate.workstream] ??= { owners: [], gates: [], blocker_count: 0 };
    if (!workstreams[gate.workstream].owners.includes(gate.owner)) workstreams[gate.workstream].owners.push(gate.owner);
    workstreams[gate.workstream].gates.push(gate.gate);
    workstreams[gate.workstream].blocker_count += gate.blockers.length;
    return workstreams;
  }, {});

  return {
    schema_version: "1",
    release: manifest.release ?? "med250-production",
    classification: "go-live closure board; execution aid only, not evidence or approval",
    production_ready: readinessReport.productionReady,
    summary: {
      gate_count: readinessReport.launchEvidence.gateCount,
      confirmed_gates: readinessReport.gateReadiness.confirmed,
      approval_pending_gates: readinessReport.gateReadiness.approvalPending,
      prepared_evidence_pending_gates: readinessReport.gateReadiness.preparedEvidencePending,
      missing_evidence_gates: readinessReport.gateReadiness.missingEvidence,
      stale_release_evidence_gates: readinessReport.gateReadiness.staleReleaseEvidence,
      duplicate_register_pending_groups: readinessReport.duplicateRegister.decisionCounts.pending,
      physical_uat_pending_scenarios: readinessReport.physicalUat.statusCounts.pending,
      prepared_handoff_artifacts: readinessReport.handoff.preparedPendingArtifactCount,
      required_handoff_artifacts: readinessReport.handoff.missingEvidenceArtifactCount,
    },
    closure_order: CLOSURE_ORDER,
    owner_workstreams: ownerWorkstreams,
    instructions: [
      "Work through gates in closure_order unless an accountable owner explicitly changes the sequence.",
      "Complete row-level reviews and physical UAT before attempting final live release approval.",
      "After every completed artifact, run npm run launch:evidence:verify and npm run launch:go-live:status.",
      "Run npm run launch:evidence:verify:live only when every gate is ready for strict release.",
    ],
    gates,
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const known = new Set(outputIndex >= 0 ? ["--output", outputPath] : []);
  const unknown = process.argv.slice(2).filter((argument) => !known.has(argument));
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const [manifest, prepared, readinessReport] = await Promise.all([
    readFile("data/launch-evidence.json", "utf8").then(JSON.parse),
    discoverPreparedLaunchEvidence(),
    buildGoLiveReadinessReport(),
  ]);
  const board = buildGoLiveClosureBoard({
    manifest,
    handoff: createLaunchEvidenceHandoff(manifest, prepared),
    readinessReport,
  });
  const serialized = `${JSON.stringify(board, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, serialized, "utf8");
    console.log(JSON.stringify({
      status: "written",
      output: outputPath,
      gate_count: board.summary.gate_count,
      production_ready: board.production_ready,
      blocker_count: board.gates.reduce((total, gate) => total + gate.blockers.length, 0),
    }, null, 2));
  } else {
    process.stdout.write(serialized);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
