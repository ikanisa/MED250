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

    def test_rwanda_landline_is_not_rewritten_as_mobile(self):
        self.assertEqual(MODULE.normalize_rwanda_phone("+250 252 572 135"), "")
        self.assertEqual(MODULE.extract_rwanda_phones("Phone: +250 252 572 135"), [])

    def test_extracts_multiple_unique_rwanda_phones_from_listing_text(self):
        phones = MODULE.extract_rwanda_phones(
            "Phone: +250 788 123 456 | Call 0788 123 456 | Tel 0722 987 654"
        )
        self.assertEqual(phones, ["+250788123456", "+250722987654"])

    def test_extracts_bare_national_number_from_maps_result_card(self):
        phones = MODULE.extract_rwanda_phones(
            "Pharmacy · Kigali · Open now · 788 123 456"
        )
        self.assertEqual(phones, ["+250788123456"])

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
                "matched_name": "DUPHAR Pharmacy",
                "matched_address": "Gasabo, Rwanda",
            }
        )
        current = MODULE.blank_result(row, "unmatched")
        current.update({"query_used": "https://www.google.com/maps/search/DUPHAR"})
        merged = MODULE.merge_observations(previous, current)
        self.assertEqual(merged["phone_number"], "+250788513496")
        self.assertEqual(merged["google_maps_url"], "https://www.google.com/maps/place/DUPHAR")
        self.assertEqual(merged["match_status"], "matched")

    def test_partition_merge_preserves_checked_coverage_over_pending_row(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update({"source_serial": "1", "name": "TEST PHARMACY"})
        checked = MODULE.blank_result(row, "unmatched")
        checked.update(
            {
                "coverage_status": "no_place_candidate",
                "query_used": "https://www.google.com/maps/search/Test",
                "query_attempts": "7",
            }
        )
        pending = MODULE.blank_result(row)
        merged = MODULE.merge_observations(checked, pending)
        self.assertEqual(merged["coverage_status"], "no_place_candidate")
        self.assertEqual(merged["match_status"], "unmatched")
        self.assertEqual(merged["query_used"], checked["query_used"])
        self.assertEqual(merged["query_attempts"], "7")

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
                    "name": "TEST PHARMACY",
                    "district": "GASABO",
                    "matched_name": "Test Pharmacy",
                    "matched_address": "Gasabo, Rwanda",
                }
            )
        )

    def test_google_phone_revalidation_preserves_only_public_numbers(self):
        result = {
            "phone_number": "+250788111111; +250722222222",
            "public_phone_numbers": "+250788111111",
            "google_maps_phone_numbers": "+250722222222",
            "phone_source": "public_evidence_csv+google_maps_browser",
        }
        stripped = MODULE.without_google_phone(result)
        self.assertEqual(stripped["phone_number"], "+250788111111")
        self.assertEqual(stripped["google_maps_phone_numbers"], "")
        self.assertEqual(stripped["phone_source"], "public_evidence_csv")

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

    def test_unrelated_business_with_one_shared_name_token_is_not_pharmacy_evidence(self):
        score, evidence = MODULE.candidate_score(
            "STREAM PHARMACY LTD",
            "GASABO",
            "KINYINYA",
            "KAGUGU",
            "Kigali streams",
            "Web hosting company, Kigali",
        )
        self.assertGreaterEqual(score, 0.80)
        self.assertFalse(
            MODULE.has_pharmacy_identity_evidence(
                "STREAM PHARMACY LTD",
                "Kigali streams",
                "Web hosting company, Kigali",
                evidence,
            )
        )

    def test_exact_brand_and_precise_locality_can_prove_pharmacy_identity(self):
        _, evidence = MODULE.candidate_score(
            "KASHA PHARMACY LTD",
            "GASABO",
            "KIMIRONKO",
            "BIBARE",
            "Kasha",
            "Bibare, Kimironko, Gasabo, Rwanda",
        )
        self.assertTrue(
            MODULE.has_pharmacy_identity_evidence(
                "KASHA PHARMACY LTD",
                "Kasha",
                "Bibare, Kimironko, Gasabo, Rwanda",
                evidence,
            )
        )

    def test_strong_maps_discovery_accepts_close_name_and_district_alias(self):
        row = {
            "name": "PHARMACIE DE BUTARE LTD",
            "district": "HUYE",
            "sector": "NGOMA",
            "cell": "BUTARE",
        }
        name = "Pharmacie de Butare (Huye)"
        address = "Butare, Rwanda"
        score, evidence = MODULE.candidate_score(
            row["name"], row["district"], row["sector"], row["cell"], name, address
        )
        self.assertTrue(
            MODULE.strong_maps_discovery(row, name, address, score, evidence)
        )

    def test_refresh_drops_prior_matched_place_without_pharmacy_identity(self):
        row = {key: "" for key in MODULE.SOURCE_COLUMNS}
        row.update(
            {
                "source_serial": "2",
                "name": "STREAM PHARMACY LTD",
                "district": "GASABO",
                "sector": "KINYINYA",
                "cell": "KAGUGU",
            }
        )
        previous = MODULE.blank_result(row, "matched")
        previous.update(
            {
                "phone_number": "+250788111111",
                "google_maps_phone_numbers": "+250788111111",
                "phone_source": "google_maps_browser",
                "google_maps_url": "https://www.google.com/maps/place/Kigali+streams",
                "matched_name": "Kigali streams",
                "matched_address": "Web hosting company, Kigali",
                "match_confidence": "0.855",
            }
        )
        current = MODULE.blank_result(row, "unmatched")
        current["query_used"] = "https://www.google.com/maps/search/Stream+Pharmacy"
        merged = MODULE.merge_observations(previous, current)
        self.assertEqual(merged["phone_number"], "")
        self.assertNotIn("/maps/place/", merged["google_maps_url"])
        self.assertEqual(merged["maps_url_source"], "generated_google_maps_search")
        self.assertEqual(merged["match_status"], "unmatched")

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
                loaded["coverage_status"] = "no_place_candidate"
                self.assertTrue(MODULE.browser_result_complete(loaded))
                self.assertFalse(MODULE.browser_result_complete(loaded, require_deep=True))
                loaded["search_mode"] = "deep"
                self.assertTrue(MODULE.browser_result_complete(loaded, require_deep=True))
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
