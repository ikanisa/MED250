import importlib.util
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).parents[1]
    / "scripts"
    / "import-data"
    / "build-december-2025-pharmacy-enrichment.py"
)
SPEC = importlib.util.spec_from_file_location("december_enrichment", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DecemberEnrichmentTests(unittest.TestCase):
    def test_exact_name_and_locality_beats_professional_change(self):
        old = {
            "name": "STREAM PHARMACY LTD",
            "district": "GASABO",
            "sector": "KINYINYA",
            "cell": "KAGUGU",
            "council_registration_number": "NPC/A1341",
        }
        current = [
            {
                "source_serial": "2",
                "name": "STREAM PHARMACY LTD",
                "district": "GASABO",
                "sector_cell_raw": "KINYINYA KAGUGU",
                "council_registration_number": "NPC/A1408",
            },
            {
                "source_serial": "154",
                "name": "ACCESS PHARMACY Ltd",
                "district": "GICUMBI",
                "sector_cell_raw": "BYUMBA GACURABWENGE",
                "council_registration_number": "NPC/A1341",
            },
        ]
        ranked = MODULE.rank_candidates(old, current)
        self.assertEqual(ranked[0].row["source_serial"], "2")
        self.assertTrue(MODULE.accepted(ranked[0], ranked[1].score))

    def test_browser_phone_is_never_verified_or_whatsapp(self):
        row = {
            "december_source_serial": "1",
            "phone_number": "+250788123456",
            "phone_source": "google_maps_browser",
            "phone_evidence_url": "https://www.google.com/maps/place/example",
            "google_maps_url": "https://www.google.com/maps/place/example",
        }
        metadata = MODULE.phone_metadata(row)
        self.assertEqual(metadata["verification_status"], "candidate")
        self.assertEqual(metadata["source_type"], "google_places")
        self.assertFalse(metadata["verified"])

    def test_public_directory_phone_is_source_verified(self):
        row = {
            "december_source_serial": "2",
            "phone_number": "+250788123456",
            "phone_source": "public_evidence_csv",
            "phone_evidence_url": "https://www.mmi.gov.rw/partners/pharmacies",
            "phone_evidence_reference": "MMI pharmacy partner directory",
        }
        metadata = MODULE.phone_metadata(row)
        self.assertEqual(metadata["verification_status"], "source_verified")
        self.assertEqual(metadata["source_type"], "admin")
        self.assertEqual(metadata["source_name"], "MMI public pharmacy partner directory")
        self.assertTrue(metadata["verified"])

    def test_multiple_phone_sources_create_distinct_contact_metadata(self):
        row = {
            "phone_number": "+250788111111; +250722222222",
            "public_phone_numbers": "+250788111111",
            "google_maps_phone_numbers": "+250788111111; +250722222222",
            "phone_source": "public_evidence_csv+google_maps_browser",
            "phone_evidence_url": (
                "https://monitoring.rwandafda.gov.rw/roster.pdf; "
                "https://www.google.com/maps/place/Test+Pharmacy"
            ),
            "phone_evidence_reference": "official roster; Google Maps public business listing",
            "google_maps_url": "https://www.google.com/maps/place/Test+Pharmacy",
        }
        metadata = MODULE.phone_metadata_rows(row)
        self.assertEqual([item["e164"] for item in metadata], ["250788111111", "250722222222"])
        self.assertEqual(metadata[0]["verification_status"], "source_verified")
        self.assertEqual(metadata[1]["verification_status"], "candidate")
        self.assertEqual(metadata[1]["source_type"], "google_places")

    def test_rejects_non_pharmacy_google_business(self):
        old = {
            "name": "LEGEND PHARMACY LTD",
            "match_status": "matched+public_phone",
            "match_confidence": "0.910",
            "matched_name": "Legend Kigali Beauty Art",
            "google_maps_url": "https://www.google.com/maps/place/Legend+Kigali+Beauty+Art",
        }
        self.assertFalse(MODULE.browser_evidence_accepted(old))

    def test_accepts_strong_canonical_pharmacy_listing(self):
        old = {
            "name": "PRECIOUS PHARMACY LTD",
            "match_status": "matched+public_phone",
            "match_confidence": "0.910",
            "matched_name": "Precious Pharmacy",
            "google_maps_url": "https://www.google.com/maps/place/Precious+Pharmacy",
        }
        self.assertTrue(MODULE.browser_evidence_accepted(old))

    def test_migration_preserves_verified_geocodes_and_creates_phone_only(self):
        sql = MODULE.build_sql([], "a", "b", "c")
        self.assertIn("contact_type, e164", sql)
        self.assertIn("'phone'", sql)
        self.assertNotIn("'whatsapp'", sql.lower())
        self.assertIn("pharmacy.google_maps_url is null", sql)
        self.assertIn("pharmacy.google_maps_url like 'https://www.google.com/maps/search/%'", sql)
        self.assertIn("pharmacy.geocode_status <> 'verified'", sql)


if __name__ == "__main__":
    unittest.main()
