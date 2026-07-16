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
        images = [
            MODULE.ProcessedImage(candidate, b"a", 1400, 1400, 99, "a" * 64, "0000000000000000", True),
            MODULE.ProcessedImage(candidate, b"b", 1400, 1400, 98, "b" * 64, "0000000000000001", True),
            MODULE.ProcessedImage(candidate, b"c", 1400, 1400, 97, "c" * 64, "ffffffffffffffff", True),
            MODULE.ProcessedImage(candidate, b"d", 1400, 1400, 96, "d" * 64, "0f0f0f0f0f0f0f0f", True),
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


if __name__ == "__main__":
    unittest.main()
