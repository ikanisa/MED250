import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "prefetch_missing_medicine_search_candidates",
    SCRIPTS / "prefetch_missing_medicine_search_candidates.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class PrefetchMissingMedicineSearchCandidatesTests(unittest.TestCase):
    def test_serializes_candidate_without_claiming_verified_rights(self):
        candidate = MODULE.pipeline.Candidate(
            product_id="rwanda-fda-hm-1",
            image_url="https://images.example/exact-pack.jpg",
            source_page_url="https://pharmacy.example/product/exact-pack",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.pipeline.AUTOMATED_PROVENANCE,
            priority=90,
            title="Exact Pack 500 mg",
            declared_width=1200,
            declared_height=1200,
            rights_verified=False,
            page_primary_image=True,
        )
        row = MODULE.candidate_manifest_row(candidate)
        self.assertEqual(row["images"], [candidate.image_url])
        self.assertEqual(row["source_page_url"], candidate.source_page_url)
        self.assertFalse(row["rights_verified"])
        self.assertNotIn("source_domain", row)

    def test_brave_only_prefetch_does_not_repeat_other_search_providers(self):
        product = MODULE.pipeline.Product(
            id="rwanda-fda-hm-1",
            name="NUSAR 50",
            brand="NUSAR 50",
            generic="Losartan Potassium",
            strength="50 mg",
            form="tablet",
            pack_size="30 tablets",
            manufacturer="Emcure Pharmaceuticals",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.pipeline.Candidate(
            product_id=product.id,
            image_url="https://images.1mg.com/nusar-50.jpg",
            source_page_url="https://www.1mg.com/drugs/nusar-50-123",
            source_domain="1mg.com",
            source_kind="specialist_retailer",
            rights_basis=MODULE.pipeline.AUTOMATED_PROVENANCE,
            priority=96,
            title="NUSAR 50 Losartan Potassium 50 mg tablet",
            declared_width=1200,
            declared_height=1200,
            rights_verified=False,
        )
        with (
            mock.patch.object(
                MODULE.pipeline,
                "brave_image_candidates",
                return_value=[candidate],
            ) as brave,
            mock.patch.object(
                MODULE.pipeline,
                "parallel_public_image_candidates",
            ) as parallel,
            mock.patch.object(
                MODULE.pipeline,
                "hydrate_exact_medicine_listing_candidates",
                return_value=[],
            ),
        ):
            result = MODULE.discover_product_candidates(
                product,
                object(),
                retry_tier=5,
                max_candidates=10,
                provider="brave",
            )
        self.assertEqual([item.image_url for item in result], [candidate.image_url])
        brave.assert_called_once()
        parallel.assert_not_called()

    def test_measurement_filter_does_not_read_retailer_hostname_as_strength(self):
        product = MODULE.pipeline.Product(
            id="rwanda-fda-hm-1",
            name="NUSAR 50",
            brand="NUSAR 50",
            generic="Losartan Potassium",
            strength="50 mg",
            form="tablet",
            pack_size="30 tablets",
            manufacturer="Emcure Pharmaceuticals",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.pipeline.Candidate(
            product_id=product.id,
            image_url="https://images.1mg.com/nusar-50.jpg",
            source_page_url="https://www.1mg.com/drugs/nusar-50-123",
            source_domain="1mg.com",
            source_kind="specialist_retailer",
            rights_basis=MODULE.pipeline.AUTOMATED_PROVENANCE,
            priority=96,
            title="NUSAR 50 Losartan Potassium 50 mg tablet",
            declared_width=1200,
            declared_height=1200,
            rights_verified=False,
        )

        self.assertTrue(MODULE.useful_direct_seed(product, candidate))

    def test_manifest_checkpoint_is_atomic_and_sorted(self):
        first = MODULE.pipeline.Candidate(
            product_id="b",
            image_url="https://images.example/b.jpg",
            source_page_url="https://pharmacy.example/b",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.pipeline.AUTOMATED_PROVENANCE,
            priority=80,
            title="B",
            rights_verified=False,
        )
        second = MODULE.pipeline.Candidate(
            product_id="a",
            image_url="https://images.example/a.jpg",
            source_page_url="https://pharmacy.example/a",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.pipeline.AUTOMATED_PROVENANCE,
            priority=80,
            title="A",
            rights_verified=False,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            count = MODULE.write_candidate_manifest(
                path,
                {"b": [first], "a": [second]},
            )
            rows = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(path.with_name(path.name + ".tmp").exists())
        self.assertEqual(count, 2)
        self.assertEqual([row["product_id"] for row in rows], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
