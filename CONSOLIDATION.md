# MED250 consolidation record

This folder is the sole authoritative source for the MED250 pharmacy marketplace.

Consolidated on: 2026-07-12

## Source tasks

- `019f55f4-431a-79c1-a9d5-11f423156d74` — Build pharmacy marketplace
- `019f564e-c56b-7663-97f0-0106e086f434` — Build Rwanda pharmacy marketplace

## Folder layout

- The repository root is the runnable, sanitized MED250 launch candidate.
- `archive/task-1-full-source/` preserves the complete useful working source, regulatory evidence, generated release packs, and task artifacts from the first build, excluding reproducible dependency/build caches.
- `archive/task-1-full-source/source-history.bundle` preserves the original Git history.
- `archive/task-2-launch-candidate/` preserves the exact sanitized ZIP produced by the second build.

The old `dawanear_*` Supabase relations, functions, storage names, and the `dawanear-client.ts` filename are retained as legacy internal identifiers for compatibility with the audited database migration. The public website brand is MED250.

The two original Codex work folders were removed after consolidation and verification at the user's explicit request.
