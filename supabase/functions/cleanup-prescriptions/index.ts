import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function secretMatches(received: string, expected: string) {
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function elevatedSupabaseKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const values = Object.values(parsed);
      if (values[0]) return values[0];
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("DAWANEAR_CRON_TOKEN") ?? "";
  const suppliedSecret = request.headers.get("X-DawaNear-Cron-Token") ?? "";
  if (!expectedSecret || !secretMatches(suppliedSecret, expectedSecret)) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = elevatedSupabaseKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: "Supabase service configuration is missing" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const batchLimit = Math.min(Math.max(Number(body.batch_limit ?? 50), 1), 200);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const abandonedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: timedOutTransitions, error: transitionError } = await supabase.rpc(
    "dawanear_expire_timed_out_selected_orders",
    { p_limit: batchLimit },
  );
  if (transitionError) {
    return Response.json({ error: transitionError.message }, { status: 500 });
  }

  type CleanupClaim = {
    prescription_path: string;
    claim_token: string;
    reference_count: number;
  };
  type CleanupResult = {
    prescription_path: string;
    reference_count: number;
    source: "recovered" | "due";
    cleared_reference_count?: number;
    outcome: string;
    error?: string;
  };

  // Keep independent forward progress for interrupted claims and newly due
  // paths. For a one-item batch each side receives one slot; larger batches
  // are split without increasing the configured total.
  const recoveryLimit = Math.max(1, Math.floor(batchLimit / 2));
  const dueLimit = Math.max(1, batchLimit - recoveryLimit);

  const { data: recoveredRows, error: recoveryError } = await supabase.rpc(
    "dawanear_recover_expired_prescription_cleanup_claims",
    { p_limit: recoveryLimit },
  );
  if (recoveryError) {
    return Response.json({ error: recoveryError.message }, { status: 500 });
  }
  const recoveredClaims = (recoveredRows ?? []) as CleanupClaim[];
  const recoveredTokens = new Set(recoveredClaims.map((claim) => claim.claim_token));

  const { data: dueRows, error: claimError } = await supabase.rpc(
    "dawanear_claim_prescription_cleanup",
    { p_limit: dueLimit },
  );
  if (claimError) {
    return Response.json({ error: claimError.message }, { status: 500 });
  }
  const dueClaims = (dueRows ?? []) as CleanupClaim[];
  const cleanupClaims = [...recoveredClaims, ...dueClaims];

  const results: CleanupResult[] = [];
  for (const claim of cleanupClaims) {
    const resultBase = {
      prescription_path: claim.prescription_path,
      reference_count: Number(claim.reference_count ?? 0),
      source: recoveredTokens.has(claim.claim_token) ? "recovered" as const : "due" as const,
    };
    const { error: storageError } = await supabase.storage
      .from("dawanear-prescriptions")
      .remove([claim.prescription_path]);
    if (storageError) {
      // Keep the durable claim after any ambiguous Storage failure. A later
      // invocation can reclaim the expired lease and retry idempotently.
      results.push({ ...resultBase, outcome: "storage_error", error: storageError.message });
      continue;
    }

    const { data: finalizedRows, error: finalizeError } = await supabase.rpc(
      "dawanear_finalize_prescription_cleanup",
      {
        p_prescription_path: claim.prescription_path,
        p_claim_token: claim.claim_token,
      },
    );
    if (finalizeError) {
      results.push({ ...resultBase, outcome: "database_error", error: finalizeError.message });
      continue;
    }

    results.push({
      ...resultBase,
      cleared_reference_count: Number(finalizedRows?.[0]?.cleared_reference_count ?? 0),
      outcome: "deleted",
    });
  }

  // Sweep uploads that never became attached to an order (for example after
  // a network response was lost). create_order accepts uploads for 24 hours,
  // so only older, still-unreferenced objects are eligible here.
  const bucket = supabase.storage.from("dawanear-prescriptions");
  const listPageSize = 200;
  const perFolderLimit = Math.max(1, Math.min(25, Math.ceil(batchLimit / 4)));
  const maintenanceTaskKey = "prescription_orphan_sweep";
  const orphanPaths: string[] = [];
  const orphanPathSet = new Set<string>();
  let orphanSweepError: string | null = null;
  let orphanEntriesScanned = 0;
  let orphanOldObjectsScanned = 0;
  let orphanScanPages = 0;
  let orphanEnumerationPages = 0;
  let orphanScanComplete = false;
  let folderContributionCapped = false;
  let foldersProcessed = 0;
  let lastProcessedFolder: string | null = null;

  const { data: maintenanceState, error: maintenanceReadError } = await supabase
    .from("dawanear_maintenance_state")
    .select("folder_cursor")
    .eq("task_key", maintenanceTaskKey)
    .maybeSingle();
  if (maintenanceReadError) orphanSweepError = maintenanceReadError.message;
  const savedFolderCursor = typeof maintenanceState?.folder_cursor === "string"
    ? maintenanceState.folder_cursor
    : null;

  // First enumerate every folder with offset pagination. The resulting sorted
  // folder set lets the persisted cursor rotate work deterministically, while
  // still supporting nested paths rather than assuming one user-folder level.
  const discoveredFolders = new Set<string>([""]);
  const folderQueue = [""];
  while (folderQueue.length > 0 && !orphanSweepError) {
    const folder = folderQueue.shift() ?? "";
    let offset = 0;
    while (!orphanSweepError) {
      const { data: entries, error: listError } = await bucket.list(folder, {
        limit: listPageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      orphanEnumerationPages += 1;
      if (listError) {
        orphanSweepError = listError.message;
        break;
      }
      const pageEntries = entries ?? [];
      for (const entry of pageEntries) {
        if (entry.id) continue;
        const child = folder ? `${folder}/${entry.name}` : entry.name;
        if (!discoveredFolders.has(child)) {
          discoveredFolders.add(child);
          folderQueue.push(child);
        }
      }
      offset += pageEntries.length;
      if (pageEntries.length < listPageSize) break;
    }
  }

  const folders = [...discoveredFolders].sort();
  let rotationStart = 0;
  if (savedFolderCursor !== null && folders.length > 0) {
    const exactIndex = folders.indexOf(savedFolderCursor);
    if (exactIndex >= 0) {
      rotationStart = (exactIndex + 1) % folders.length;
    } else {
      const nextIndex = folders.findIndex((folder) => folder > savedFolderCursor);
      rotationStart = nextIndex >= 0 ? nextIndex : 0;
    }
  }
  const rotatedFolders = [
    ...folders.slice(rotationStart),
    ...folders.slice(0, rotationStart),
  ];

  for (const folder of rotatedFolders) {
    if (orphanSweepError || orphanPaths.length >= batchLimit) break;
    lastProcessedFolder = folder;
    foldersProcessed += 1;
    let folderAdded = 0;
    let offset = 0;

    while (
      !orphanSweepError
      && orphanPaths.length < batchLimit
      && folderAdded < perFolderLimit
    ) {
      const { data: entries, error: listError } = await bucket.list(folder, {
        limit: listPageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      orphanScanPages += 1;
      if (listError) {
        orphanSweepError = listError.message;
        break;
      }

      const pageEntries = entries ?? [];
      if (pageEntries.length === 0) break;
      orphanEntriesScanned += pageEntries.length;
      const oldPathsOnPage: string[] = [];
      for (const entry of pageEntries) {
        if (!entry.id || !entry.created_at || entry.created_at >= abandonedBefore) continue;
        orphanOldObjectsScanned += 1;
        oldPathsOnPage.push(folder ? `${folder}/${entry.name}` : entry.name);
      }

      if (oldPathsOnPage.length > 0) {
        const { data: references, error: referenceError } = await supabase
          .from("dawanear_orders")
          .select("prescription_path")
          .in("prescription_path", oldPathsOnPage);
        if (referenceError) {
          orphanSweepError = referenceError.message;
          break;
        }

        const referencedPaths = new Set((references ?? []).map((row) => row.prescription_path));
        for (const path of oldPathsOnPage) {
          if (referencedPaths.has(path) || orphanPathSet.has(path)) continue;
          orphanPathSet.add(path);
          orphanPaths.push(path);
          folderAdded += 1;
          if (orphanPaths.length >= batchLimit || folderAdded >= perFolderLimit) break;
        }
      }

      offset += pageEntries.length;
      if (pageEntries.length < listPageSize) break;
    }

    if (folderAdded >= perFolderLimit) folderContributionCapped = true;
  }

  orphanScanComplete = !orphanSweepError
    && foldersProcessed === rotatedFolders.length
    && orphanPaths.length < batchLimit
    && !folderContributionCapped;

  // Persist even when the deletion batch fills. The next invocation begins
  // after this folder and wraps lexicographically, so an early large or fully
  // referenced folder cannot permanently starve later folders.
  if (lastProcessedFolder !== null) {
    const { error: maintenanceWriteError } = await supabase
      .from("dawanear_maintenance_state")
      .upsert({
        task_key: maintenanceTaskKey,
        folder_cursor: lastProcessedFolder,
        updated_at: new Date().toISOString(),
      }, { onConflict: "task_key" });
    if (maintenanceWriteError) {
      orphanSweepError = orphanSweepError
        ? `${orphanSweepError}; cursor: ${maintenanceWriteError.message}`
        : maintenanceWriteError.message;
      orphanScanComplete = false;
    }
  }

  let orphanClaimed = 0;
  let orphanDeleted = 0;
  let orphanFinalized = 0;
  const appendOrphanError = (message: string) => {
    orphanSweepError = orphanSweepError
      ? `${orphanSweepError}; ${message}`
      : message;
    orphanScanComplete = false;
  };
  if (orphanPaths.length > 0) {
    const { data: orphanClaimRows, error: orphanClaimError } = await supabase.rpc(
      "dawanear_claim_orphan_prescription_cleanup",
      { p_prescription_paths: orphanPaths, p_limit: batchLimit },
    );
    if (orphanClaimError) {
      appendOrphanError(`claim: ${orphanClaimError.message}`);
    } else {
      const orphanClaims = (orphanClaimRows ?? []) as CleanupClaim[];
      orphanClaimed = orphanClaims.length;
      for (const claim of orphanClaims) {
        const { error: orphanDeleteError } = await bucket.remove([claim.prescription_path]);
        if (orphanDeleteError) {
          // Keep the claim after an ambiguous Storage result. If the object
          // still exists, a later scan can reclaim the expired lease and retry.
          appendOrphanError(`delete ${claim.prescription_path}: ${orphanDeleteError.message}`);
          continue;
        }
        orphanDeleted += 1;

        const { error: orphanFinalizeError } = await supabase.rpc(
          "dawanear_finalize_prescription_cleanup",
          {
            p_prescription_path: claim.prescription_path,
            p_claim_token: claim.claim_token,
          },
        );
        if (orphanFinalizeError) {
          appendOrphanError(`finalize ${claim.prescription_path}: ${orphanFinalizeError.message}`);
          continue;
        }
        orphanFinalized += 1;
      }
    }
  }

  return Response.json({
    processed: results.length,
    deleted: results.filter((result) => result.outcome === "deleted").length,
    references_cleared: results.reduce(
      (total, result) => total + (result.cleared_reference_count ?? 0),
      0,
    ),
    recovered_claims: recoveredClaims.length,
    due_claims: dueClaims.length,
    claimed_paths: cleanupClaims.length,
    recovery_limit: recoveryLimit,
    due_limit: dueLimit,
    timed_out_selected: (timedOutTransitions ?? []).length,
    orphan_candidates: orphanPaths.length,
    orphan_claimed: orphanClaimed,
    orphan_deferred: orphanPaths.length - orphanClaimed,
    orphan_deleted: orphanDeleted,
    orphan_finalized: orphanFinalized,
    orphan_entries_scanned: orphanEntriesScanned,
    orphan_old_objects_scanned: orphanOldObjectsScanned,
    orphan_enumeration_pages: orphanEnumerationPages,
    orphan_scan_pages: orphanScanPages,
    orphan_scan_complete: orphanScanComplete,
    orphan_folders_discovered: folders.length,
    orphan_folders_processed: foldersProcessed,
    orphan_per_folder_limit: perFolderLimit,
    orphan_cursor_before: savedFolderCursor,
    orphan_cursor_after: lastProcessedFolder,
    orphan_sweep_error: orphanSweepError,
    retention: {
      abandoned_hours: 24,
      selected_access_hours: 24,
      completed_days: 30,
      cleanup_claim_minutes: 15,
    },
    results,
  });
});
