import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "enrich_product_images.py"
SPEC = importlib.util.spec_from_file_location("product_image_pipeline", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ProductImagePipelineTests(unittest.TestCase):
    def test_catalogue_contains_all_4680_source_products(self):
        products = MODULE.load_products(MODULE.DEFAULT_DATASET)
        self.assertEqual(len(products), 4680)
        self.assertEqual(len({product.id for product in products}), 4680)

    def test_manifest_maps_asin_and_defaults_provenance(self):
        payload = [
            {
                "asin": "B004L5JCZ4",
                "source_page_url": "https://affiliate-program.amazon.com/item/B004L5JCZ4",
                "source_kind": "amazon_creators_api",
                "images": [
                    "https://m.media-amazon.com/images/I/example-one.jpg",
                    "https://m.media-amazon.com/images/I/example-two.jpg",
                    "https://m.media-amazon.com/images/I/example-three.jpg"
                ]
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "creators.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertEqual(len(result["AMZ-B004L5JCZ4"]), 3)
        self.assertTrue(
            all(item.source_kind == "amazon_creators_api" for item in result["AMZ-B004L5JCZ4"])
        )
        self.assertTrue(
            all(item.rights_basis == MODULE.AUTOMATED_PROVENANCE for item in result["AMZ-B004L5JCZ4"])
        )
        self.assertTrue(
            all(not item.rights_verified for item in result["AMZ-B004L5JCZ4"])
        )

    def test_manifest_requires_explicit_true_for_reuse_rights(self):
        payload = [
            {
                "product_id": "p1",
                "source_page_url": "https://manufacturer.example/products/p1",
                "source_kind": "manufacturer",
                "rights_basis": "Signed manufacturer catalogue licence.",
                "rights_verified": True,
                "images": ["https://manufacturer.example/images/p1.jpg"],
            },
            {
                "product_id": "p2",
                "source_page_url": "https://manufacturer.example/products/p2",
                "source_kind": "manufacturer",
                "rights_basis": "Unreviewed manufacturer page.",
                "rights_verified": "yes",
                "images": ["https://manufacturer.example/images/p2.jpg"],
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rights.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertTrue(result["p1"][0].rights_verified)
        self.assertFalse(result["p2"][0].rights_verified)

    def test_publication_payload_carries_explicit_rights_decision(self):
        candidate = MODULE.Candidate(
            "p",
            "https://manufacturer.example/i.jpg",
            "https://manufacturer.example/p",
            "manufacturer.example",
            "manufacturer",
            "Signed manufacturer catalogue licence.",
            100,
            rights_verified=True,
        )
        image = MODULE.ProcessedImage(
            candidate, b"a", 1400, 1400, 99, "a" * 64, "0" * 16, True
        )
        self.assertIs(image.publication_payload()["rights_verified"], True)

    def test_publication_gate_rejects_unverified_gallery_and_old_checkpoint(self):
        verified = MODULE.Candidate(
            "p",
            "https://manufacturer.example/i.jpg",
            "https://manufacturer.example/p",
            "manufacturer.example",
            "manufacturer",
            "Signed manufacturer catalogue licence.",
            100,
            rights_verified=True,
        )
        unverified = MODULE.Candidate(
            "p",
            "https://retailer.example/i.jpg",
            "https://retailer.example/p",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            60,
        )
        images = [
            MODULE.ProcessedImage(verified, b"a", 1400, 1400, 99, "a" * 64, "0" * 16, True),
            MODULE.ProcessedImage(verified, b"b", 1400, 1400, 98, "b" * 64, "1" * 16, True),
            MODULE.ProcessedImage(unverified, b"c", 1400, 1400, 97, "c" * 64, "2" * 16, True),
        ]
        self.assertFalse(MODULE.images_have_verified_rights(images))
        self.assertFalse(
            MODULE.checkpoint_is_rights_verified_publication(
                {"status": "published", "payload": {"images": [{}, {}, {}]}}
            )
        )

    def test_rejects_private_and_non_http_urls(self):
        with self.assertRaises(MODULE.PipelineError):
            MODULE.ensure_public_url("file:///etc/passwd")
        with self.assertRaises(MODULE.PipelineError):
            MODULE.ensure_public_url("http://127.0.0.1/image.png")

    def test_extracts_json_ld_and_open_graph_images(self):
        product = MODULE.Product(
            id="test-product",
            name="Example Lotion",
            brand="Example",
            generic="",
            strength="",
            form="Lotion",
            pack_size="250 ml",
            manufacturer="Example Labs",
            source_url="",
            asin="",
            group="consumer",
        )
        html = """
        <html><head>
          <title>Example Lotion 250 ml</title>
          <meta property="og:image" content="/front.jpg">
          <script type="application/ld+json">
            {"@type":"Product","image":["https://manufacturer.example/side.jpg","/back.jpg"]}
          </script>
        </head><body></body></html>
        """
        rule = {
            "kind": "manufacturer",
            "rights_basis": "Manufacturer product page approved for catalogue use.",
            "priority": 100,
        }
        candidates = MODULE.extract_page_candidates(
            product,
            "https://manufacturer.example/products/example-lotion",
            html,
            rule,
        )
        self.assertEqual(len(candidates), 3)

    def test_uniform_white_background_becomes_transparent(self):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.skipTest("Pillow is not installed")
        image = Image.new("RGB", (1000, 1000), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((300, 200, 700, 800), fill=(40, 90, 180))
        result = MODULE.remove_uniform_background(image)
        self.assertGreater(MODULE.alpha_fraction(result), 0.4)
        self.assertEqual(result.getpixel((500, 500))[3], 255)

    def test_distinct_selection_rejects_near_duplicate_phash(self):
        candidate = MODULE.Candidate(
            "p",
            "https://example.com/i.jpg",
            "https://example.com/p",
            "example.com",
            "manufacturer",
            "Approved manufacturer page.",
            100,
        )
        candidates = [
            MODULE.replace(candidate, image_url=f"https://example.com/{name}.jpg")
            for name in ("a", "b", "c", "d")
        ]
        images = [
            MODULE.ProcessedImage(candidates[0], b"a", 1400, 1400, 99, "a" * 64, "0000000000000000", True),
            MODULE.ProcessedImage(candidates[1], b"b", 1400, 1400, 98, "b" * 64, "0000000000000001", True),
            MODULE.ProcessedImage(candidates[2], b"c", 1400, 1400, 97, "c" * 64, "ffffffffffffffff", True),
            MODULE.ProcessedImage(candidates[3], b"d", 1400, 1400, 96, "d" * 64, "0f0f0f0f0f0f0f0f", True),
        ]
        selected = MODULE.select_distinct_images(images)
        self.assertEqual(
            [image.content_sha256 for image in selected],
            ["a" * 64, "c" * 64, "d" * 64],
        )

    def test_infers_manufacturer_and_marketplace_sources(self):
        product = MODULE.Product(
            id="p",
            name="Aveeno Baby Wash",
            brand="Aveeno",
            generic="",
            strength="",
            form="",
            pack_size="18 oz",
            manufacturer="",
            source_url="",
            asin="B004L5JCZ4",
            group="consumer",
        )
        self.assertEqual(
            MODULE.inferred_source_kind("https://www.aveeno.com/products/baby-wash", product),
            ("manufacturer", 100),
        )
        self.assertEqual(
            MODULE.inferred_source_kind("https://www.amazon.com/dp/B004L5JCZ4", product),
            ("marketplace_api", 72),
        )

    def test_measurements_match_equivalent_pack_sizes(self):
        expected = MODULE.measurements("18 fl oz")
        observed = MODULE.measurements("532 ml")
        wrong = MODULE.measurements("12 fl oz")
        self.assertTrue(MODULE.measurements_match(expected, observed))
        self.assertFalse(MODULE.measurements_match(expected, wrong))
        self.assertFalse(MODULE.measurements_conflict(expected, observed))
        self.assertTrue(
            MODULE.measurements_conflict(expected, MODULE.measurements("18 fl oz 2 pk"))
        )
        self.assertTrue(
            MODULE.measurements_conflict(expected, MODULE.measurements("2-pk18-fl-oz"))
        )

    def test_critical_identity_rejects_related_same_brand_product(self):
        product = MODULE.Product(
            id="p",
            name="Aveeno Baby Daily Moisture Body Wash and Shampoo with Oat Extract",
            brand="Aveeno",
            generic="",
            strength="",
            form="",
            pack_size="18 fl oz",
            manufacturer="",
            source_url="",
            asin="",
            group="consumer",
        )
        self.assertGreaterEqual(
            MODULE.critical_identity_coverage(
                product,
                "Aveeno Baby Daily Moisture Wash Shampoo Natural Oat",
            ),
            0.5,
        )
        self.assertLess(
            MODULE.critical_identity_coverage(
                product,
                "Aveeno Daily Moisturizing Cocoa Butter Body Wash 18 oz",
            ),
            0.5,
        )

    def test_medicine_identity_rejects_unrelated_spectrum_supplement(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0907",
            name="SPECTRUM-250",
            brand="SPECTRUM-250",
            generic="Ciprofloxacin",
            strength="250 mg",
            form="Tablets",
            pack_size="Box/10",
            manufacturer="LABORATOIRES COOPER PHARMA",
            source_url="",
            asin="",
            group="medicine",
        )
        unrelated = MODULE.Candidate(
            product.id,
            "https://example.com/antler-velvet-full-spectrum-250-mg.jpg",
            "https://example.com/antler-velvet-full-spectrum-250-mg",
            "example.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Antler Velvet Full Spectrum 250 Mg by Planetary Herbals",
        )
        exact = MODULE.Candidate(
            product.id,
            "https://example.com/spectrum-250.jpg",
            "https://example.com/spectrum-250",
            "example.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "SPECTRUM-250 ciprofloxacine 250 mg",
        )
        self.assertFalse(
            MODULE.medicine_identity_evidence(
                product,
                "Antler Velvet Full Spectrum 250 Mg Planetary Herbals",
            )
        )
        self.assertTrue(
            MODULE.medicine_identity_evidence(
                product,
                "Spectrum ciprofloxacine 250 mg Cooper",
            )
        )
        self.assertLess(MODULE.candidate_identity_score(product, unrelated), 0.85)
        self.assertGreaterEqual(MODULE.candidate_identity_score(product, exact), 0.95)

    def test_reads_text_from_current_and_legacy_rapidocr_results(self):
        modern = type("RapidOutput", (), {"txts": ("PARACETAMOL", "500 MG")})()
        legacy = (
            [
                ([[0, 0], [1, 0], [1, 1], [0, 1]], "PARACETAMOL", 0.99),
                ([[0, 0], [1, 0], [1, 1], [0, 1]], "500 MG", 0.98),
            ],
            [0.01, 0.01, 0.01],
        )
        self.assertEqual(
            MODULE.rapidocr_text_items(modern),
            ["PARACETAMOL", "500 MG"],
        )
        self.assertEqual(
            MODULE.rapidocr_text_items(legacy),
            ["PARACETAMOL", "500 MG"],
        )


if __name__ == "__main__":
    unittest.main()
