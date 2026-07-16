import importlib.util
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).parents[1]
    / "scripts"
    / "import-data"
    / "merge-pharmacy-contact-audits.py"
)
SPEC = importlib.util.spec_from_file_location("merge_pharmacy_audits", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def row(serial: int, **overrides):
    value = {column: "" for column in MODULE.POLICY.AUDIT_COLUMNS}
    value.update(
        {
            "source_serial": str(serial),
            "name": f"EXAMPLE {serial} PHARMACY LTD",
            "district": "GASABO",
            "sector": "KINYINYA",
            "cell": "KAGUGU",
            "google_maps_url": MODULE.POLICY.maps_search_url(
                {
                    "name": f"EXAMPLE {serial} PHARMACY LTD",
                    "district": "GASABO",
                    "sector": "KINYINYA",
                    "cell": "KAGUGU",
                    "province": "KIGALI CITY",
                }
            ),
        }
    )
    value.update(overrides)
    return value


class PharmacyAuditMergeTests(unittest.TestCase):
    def test_sanitizer_drops_unrelated_resolved_business_and_maps_phone(self):
        unsafe = row(
            1,
            name="STREAM PHARMACY LTD",
            match_status="matched+public_phone",
            matched_name="Kigali streams",
            matched_address="Web hosting company, Kigali",
            google_maps_url="https://www.google.com/maps/place/Kigali+streams",
            maps_url_source="google_maps_browser",
            public_phone_numbers="+250782504529",
            google_maps_phone_numbers="+250787852414",
            phone_number="+250782504529; +250787852414",
            phone_source="public_evidence_csv+google_maps_browser",
        )
        sanitized = MODULE.POLICY.sanitize_observation(unsafe)
        self.assertNotIn("/maps/place/", sanitized["google_maps_url"])
        self.assertEqual(sanitized["google_maps_phone_numbers"], "")
        self.assertEqual(sanitized["phone_number"], "+250782504529")
        self.assertEqual(sanitized["phone_source"], "public_evidence_csv")
        self.assertEqual(sanitized["match_status"], "phone_from_public_evidence")

    def test_sanitizer_preserves_identity_valid_pharmacy_listing(self):
        safe = row(
            1,
            match_status="matched",
            matched_name="Example 1 Pharmacy",
            matched_address="Kinyinya, Gasabo, Rwanda",
            google_maps_url="https://www.google.com/maps/place/Example+1+Pharmacy",
            maps_url_source="google_maps_browser",
            google_maps_phone_numbers="+250788123456",
            phone_number="+250788123456",
            phone_source="google_maps_browser",
        )
        self.assertEqual(
            MODULE.POLICY.sanitize_observation(safe)["google_maps_url"],
            safe["google_maps_url"],
        )

    def test_merge_reapplies_current_safety_policy(self):
        first = [row(serial) for serial in range(1, 726)]
        second = [dict(value) for value in first]
        first[0] = row(
            1,
            name="STREAM PHARMACY LTD",
            match_status="matched",
            matched_name="Kigali streams",
            matched_address="Web hosting company, Kigali",
            google_maps_url="https://www.google.com/maps/place/Kigali+streams",
            google_maps_phone_numbers="+250787852414",
            phone_number="+250787852414",
            phone_source="google_maps_browser",
        )
        second[0] = dict(first[0])
        merged = MODULE.merge_audits([first, second])
        self.assertEqual(len(merged), 725)
        self.assertNotIn("/maps/place/", merged[0]["google_maps_url"])
        self.assertEqual(merged[0]["phone_number"], "")

    def test_merge_rejects_source_registry_disagreement(self):
        first = [row(serial) for serial in range(1, 726)]
        second = [dict(value) for value in first]
        second[0]["name"] = "DIFFERENT PHARMACY"
        with self.assertRaises(MODULE.MergeError):
            MODULE.merge_audits([first, second])


if __name__ == "__main__":
    unittest.main()
