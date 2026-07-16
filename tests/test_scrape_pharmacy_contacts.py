import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "scrape_pharmacy_contacts.py"
SPEC = importlib.util.spec_from_file_location("pharmacy_scraper", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PharmacyScraperTests(unittest.TestCase):
    def test_name_similarity_handles_legal_and_pharmacy_suffixes(self):
        self.assertEqual(MODULE.name_similarity("PRECIOUS PHARMACY LTD", "Precious Pharmacy"), 1.0)

    def test_rwanda_phone_normalization(self):
        self.assertEqual(MODULE.normalize_rwanda_phone("0788 123 456"), "+250788123456")
        self.assertEqual(MODULE.normalize_rwanda_phone("+250 788 123 456"), "+250788123456")

    def test_extracts_multiple_unique_rwanda_phones_from_listing_text(self):
        phones = MODULE.extract_rwanda_phones(
            "Phone: +250 788 123 456 | Call 0788 123 456 | Tel 0722 987 654"
        )
        self.assertEqual(phones, ["+250788123456", "+250722987654"])

    def test_preserves_printed_non_leap_day_without_losing_row(self):
        self.assertEqual(MODULE.parse_source_date("29/02/2030"), "2030-02-29")

    def test_maps_search_url_contains_name_and_location(self):
        row = {
            "name": "PRECIOUS PHARMACY LTD",
            "sector": "KIMIRONKO",
            "district": "GASABO",
            "province": "KIGALI CITY",
        }
        url = MODULE.maps_search_url(row)
        self.assertIn("PRECIOUS+PHARMACY+LTD", url)
        self.assertIn("KIMIRONKO", url)

    def test_deep_maps_search_uses_multiple_locality_variants(self):
        row = {
            "name": "PRECIOUS PHARMACY LTD",
            "cell": "BIBARE",
            "sector": "KIMIRONKO",
            "district": "GASABO",
            "province": "KIGALI CITY",
        }
        urls = MODULE.browser_maps_search_urls(row, deep=True)
        self.assertGreaterEqual(len(urls), 3)
        self.assertTrue(any("BIBARE" in url for url in urls))
        self.assertTrue(any("KIGALI%20CITY" in url for url in urls))

    def test_missing_phone_first_flag_is_available(self):
        args = MODULE.build_parser().parse_args(
            [
                "--pdf",
                "source.pdf",
                "--output",
                "output.csv",
                "--missing-phone-first",
            ]
        )
        self.assertTrue(args.missing_phone_first)

    def test_enrichment_keeps_distinct_public_and_maps_numbers(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update(
            {
                "source_serial": "1",
                "name": "TEST PHARMACY",
                "district": "GASABO",
            }
        )

        class Evidence:
            def match(self, _row):
                return {
                    "phone": "+250788111111",
                    "score": 1.0,
                    "margin": 1.0,
                    "matched_name": "TEST PHARMACY",
                    "address": "Gasabo",
                    "source_url": "https://example.gov.rw/roster.pdf",
                    "source_reference": "official roster",
                }

        class Browser:
            def scrape(self, _row):
                return {
                    "status": "matched",
                    "score": 1.0,
                    "margin": 1.0,
                    "name": "Test Pharmacy",
                    "address": "Gasabo, Rwanda",
                    "phone": "+250788111111; +250722222222",
                    "url": "https://www.google.com/maps/place/Test+Pharmacy",
                    "query": "https://www.google.com/maps/search/Test+Pharmacy",
                }

        result = MODULE.enrich_row(row, Evidence(), Browser())
        self.assertEqual(
            result["phone_number"],
            "+250788111111; +250722222222",
        )
        self.assertEqual(result["public_phone_numbers"], "+250788111111")
        self.assertEqual(
            result["google_maps_phone_numbers"],
            "+250788111111; +250722222222",
        )
        self.assertEqual(
            result["phone_source"],
            "public_evidence_csv+google_maps_browser",
        )

    def test_refresh_preserves_stronger_prior_maps_observation(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update({"source_serial": "26", "name": "DUPHAR", "district": "GASABO"})
        previous = MODULE.blank_result(row, "matched")
        previous.update(
            {
                "phone_number": "+250788513496",
                "google_maps_phone_numbers": "+250788513496",
                "phone_source": "google_maps_browser",
                "google_maps_url": "https://www.google.com/maps/place/DUPHAR",
                "maps_url_source": "google_maps_browser",
                "match_confidence": "1.000",
                "matched_name": "DUPHAR",
            }
        )
        current = MODULE.blank_result(row, "unmatched")
        current.update({"query_used": "https://www.google.com/maps/search/DUPHAR"})
        merged = MODULE.merge_observations(previous, current)
        self.assertEqual(merged["phone_number"], "+250788513496")
        self.assertEqual(merged["google_maps_url"], "https://www.google.com/maps/place/DUPHAR")
        self.assertEqual(merged["match_status"], "matched")

    def test_refresh_drops_legacy_google_phone_without_canonical_match(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update({"source_serial": "31", "name": "TEST PHARMACY", "district": "GASABO"})
        previous = MODULE.blank_result(row, "needs_review")
        previous.update(
            {
                "phone_number": "+250785133763",
                "phone_source": "google_maps_browser",
                "matched_name": "Unrelated business",
            }
        )
        current = MODULE.blank_result(row, "unmatched")
        merged = MODULE.merge_observations(previous, current)
        self.assertEqual(merged["phone_number"], "")
        self.assertEqual(merged["phone_source"], "")

    def test_trusted_phone_requires_official_or_canonical_matched_evidence(self):
        self.assertTrue(
            MODULE.has_trusted_phone(
                {
                    "phone_number": "+250788111111",
                    "phone_source": "public_evidence_csv",
                }
            )
        )
        self.assertFalse(
            MODULE.has_trusted_phone(
                {
                    "phone_number": "+250788111111",
                    "phone_source": "google_maps_browser",
                    "match_status": "needs_review",
                    "google_maps_url": "https://www.google.com/maps/search/Test",
                }
            )
        )
        self.assertTrue(
            MODULE.has_trusted_phone(
                {
                    "phone_number": "+250788111111",
                    "phone_source": "google_maps_browser",
                    "match_status": "matched",
                    "google_maps_url": "https://www.google.com/maps/place/Test",
                }
            )
        )

    def test_candidate_scoring_rewards_exact_name_and_locality(self):
        row = {
            "name": "PRECIOUS PHARMACY LTD",
            "district": "GASABO",
            "sector": "KIMIRONKO",
            "cell": "BIBARE",
        }
        place = {
            "displayName": {"text": "Precious Pharmacy"},
            "formattedAddress": "Bibare, Kimironko, Gasabo, Rwanda",
            "types": ["pharmacy"],
        }
        score, evidence = MODULE.candidate_score(
            row["name"],
            row["district"],
            row["sector"],
            row["cell"],
            place["displayName"]["text"],
            place["formattedAddress"],
        )
        self.assertEqual(score, 1.0)
        self.assertTrue(evidence["exact_name"])
        self.assertTrue(evidence["district"])

    def test_local_checkpoint_is_loaded_but_not_browser_complete(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update({"source_serial": "1", "name": "TEST PHARMACY", "district": "GASABO"})
        with tempfile.TemporaryDirectory() as directory:
            store = MODULE.CheckpointStore(Path(directory) / "checkpoint.sqlite3")
            try:
                result = MODULE.blank_result(row, "local_evidence_only")
                store.put("source", row, result)
                loaded = store.get("source", row)
                self.assertIsNotNone(loaded)
                self.assertFalse(MODULE.browser_result_complete(loaded))
                loaded["query_used"] = "https://www.google.com/maps/search/test"
                self.assertTrue(MODULE.browser_result_complete(loaded))
                self.assertFalse(MODULE.browser_result_complete(loaded, require_deep=True))
                loaded["search_mode"] = "deep"
                self.assertTrue(MODULE.browser_result_complete(loaded, require_deep=True))
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
