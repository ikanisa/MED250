# Cross-file deduplication

- Raw candidates: 31
- Deduplicated candidates: 30
- Merged `MED250-CONTACT-002` and `MED250-CONTACT-003` into `MED250-CONTACT-IMPORT-PROVENANCE-001` because they are consecutive stages of the same privileged import trust path.
- Kept the two JSON-LD sinks separate because fixing only one leaves the other independently exploitable.
- Kept submit-time and select-time product-state checks separate because they are independently reachable transition controls.
- Kept geocode state-binding and approval-race instances separate because either defect survives a fix to only the other.
