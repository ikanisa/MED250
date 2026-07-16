# Completed production evidence

Place only completed, redacted JSON evidence artifacts in this directory. Generate the correct shape with:

```sh
npm run launch:evidence:template -- --gate MED250_GATE_NAME --type required_evidence_type
```

Generate one owner-ready JSON handoff containing every currently missing artifact template, suggested filename, acceptance criterion, and approval field with:

```sh
npm run --silent launch:evidence:handoff
```

The handoff is a completion aid, not evidence. Its pending templates must not be referenced by the launch registry.

Before referencing a local artifact in `data/launch-evidence.json`:

1. Replace every pending/null template field with the real redacted result.
2. Set every verification check to `passed` only after it actually passed.
3. Set `status` to `complete`.
4. Validate the artifact with `npm run launch:evidence:artifact:verify -- --file <path> --gate <gate-name> --type <evidence-type>`.
5. Record the artifact's lowercase SHA-256 digest in the registry evidence entry.
6. Validate the registry with `npm run launch:evidence:verify`.

Local evidence references outside this directory, non-JSON evidence, mismatched gate/type metadata, incomplete checks, secrets, phone numbers, OTPs, email addresses and precise coordinates are rejected. Do not add empty templates to the launch registry.
