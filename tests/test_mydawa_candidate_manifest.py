import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "mydawa_candidate_manifest",
    SCRIPTS / "build_mydawa_sitemap_candidate_manifest.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class MyDawaCandidateManifestTests(unittest.TestCase):
    def test_keeps_only_unique_canonical_product_urls(self):
        xml_text = """<?xml version="1.0" encoding="utf-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://mydawa.com/products/abz-400mg-tablets-1s</loc></url>
          <url><loc>https://mydawa.com/products/abz-400mg-tablets-1s</loc></url>
          <url><loc>https://mydawa.com/help-center/faq</loc></url>
          <url><loc>https://example.com/products/not-mydawa</loc></url>
        </urlset>"""
        self.assertEqual(
            MODULE.sitemap_product_urls(xml_text),
            ["https://mydawa.com/products/abz-400mg-tablets-1s"],
        )


if __name__ == "__main__":
    unittest.main()
