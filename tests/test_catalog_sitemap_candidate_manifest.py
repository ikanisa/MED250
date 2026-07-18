import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "catalog_sitemap_candidate_manifest",
    SCRIPTS / "build_catalog_sitemap_candidate_manifest.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CatalogSitemapCandidateManifestTests(unittest.TestCase):
    def test_missing_gallery_selection_excludes_non_live_dataset_rows(self):
        def product(product_id):
            return MODULE.pipeline.Product(
                id=product_id,
                name=product_id,
                brand=product_id,
                generic="",
                strength="",
                form="",
                pack_size="",
                manufacturer="",
                source_url="",
                asin="",
                group="medicine",
            )

        class Publisher:
            def __init__(self, *_args):
                pass

            def live_product_ids(self):
                return {"live-missing", "live-complete"}

            def gallery_positions(self, expected):
                self.expected = expected
                return {"live-complete": {1, 2, 3}}

            def close(self):
                pass

        with (
            mock.patch.object(
                MODULE.pipeline,
                "load_dotenv",
                return_value={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "secret"},
            ),
            mock.patch.object(MODULE.pipeline, "SupabasePublisher", Publisher),
        ):
            missing = MODULE.missing_minimum_product_ids(
                [product("live-missing"), product("live-complete"), product("not-live")]
            )
        self.assertEqual(missing, {"live-missing"})

    def test_fast_url_tokenizer_decodes_and_splits_slug(self):
        self.assertEqual(
            MODULE.url_lookup_tokens(
                "https://shop.example/product/Brand%20500MG-tablets"
            ),
            {"https", "shop", "example", "product", "brand", "500mg", "tablets"},
        )

    def test_parses_nested_sitemap_and_inline_image_entries(self):
        index = """<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/product-sitemap1.xml</loc></sitemap>
        </sitemapindex>"""
        self.assertEqual(
            MODULE.sitemap_payload(index),
            (
                "sitemapindex",
                [
                    {
                        "page_url": "https://example.com/product-sitemap1.xml",
                        "images": [],
                    }
                ],
            ),
        )
        urlset = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
          <url>
            <loc>https://example.com/product/brand-500mg</loc>
            <image:image>
              <image:loc>https://example.com/images/brand-500mg.jpg</image:loc>
              <image:title>Brand 500 mg tablets</image:title>
            </image:image>
          </url>
        </urlset>"""
        self.assertEqual(
            MODULE.sitemap_payload(urlset),
            (
                "urlset",
                [
                    {
                        "page_url": "https://example.com/product/brand-500mg",
                        "images": [
                            {
                                "image_url": "https://example.com/images/brand-500mg.jpg",
                                "title": "Brand 500 mg tablets",
                            }
                        ],
                    }
                ],
            ),
        )

    def test_rejects_cross_domain_and_non_product_urls(self):
        catalogue = MODULE.Catalogue(
            "Example",
            ("https://shop.example/sitemap.xml",),
            frozenset({"shop.example"}),
            "specialist_retailer",
            90,
            r"/product/",
        )
        self.assertTrue(
            MODULE.product_page_url(
                catalogue, "https://shop.example/product/brand-500mg"
            )
        )
        self.assertFalse(
            MODULE.product_page_url(catalogue, "https://shop.example/blog/news")
        )
        self.assertFalse(
            MODULE.product_page_url(
                catalogue, "https://attacker.example/product/brand-500mg"
            )
        )

    def test_pharmeasy_catalogue_targets_prescription_sitemaps_only(self):
        catalogue = next(
            item for item in MODULE.CATALOGUES if item.name == "PharmEasy"
        )
        self.assertTrue(
            MODULE.child_sitemap_url(
                catalogue,
                "https://pharmeasy.in/sitemaps/online-medicine-order/"
                "sitemap-prescription-medicine-12.xml",
            )
        )
        self.assertTrue(
            MODULE.product_page_url(
                catalogue,
                "https://pharmeasy.in/online-medicine-order/"
                "vivian-sr-100mg-tablet-139125",
            )
        )
        self.assertFalse(
            MODULE.product_page_url(
                catalogue,
                "https://pharmeasy.in/blog/example-medicine",
            )
        )

    def test_chebu_catalogue_uses_robots_advertised_product_routes(self):
        catalogue = next(
            item
            for item in MODULE.CATALOGUES
            if item.name == "Chebu Health Products"
        )
        self.assertEqual(
            catalogue.sitemap_urls,
            ("https://hpa.chebupharma.com/sitemap.xml",),
        )
        self.assertTrue(
            MODULE.product_page_url(
                catalogue,
                "https://hpa.chebupharma.com/shop/product/"
                "ciprofloxacin-500mg-tablets-aarciflox-500-19658",
            )
        )
        self.assertFalse(
            MODULE.product_page_url(
                catalogue,
                "https://hpa.chebupharma.com/shop/category/antibiotics-1",
            )
        )


if __name__ == "__main__":
    unittest.main()
