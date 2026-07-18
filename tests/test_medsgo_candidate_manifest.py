import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "medsgo_candidate_manifest",
    SCRIPTS / "build_medsgo_sitemap_candidate_manifest.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class MedsGoCandidateManifestTests(unittest.TestCase):
    def test_parses_namespaced_page_images_and_titles(self):
        xml_text = """<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
          xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
          <url>
            <loc>https://medsgo.ph/prescription-medicines/example/</loc>
            <image:image>
              <image:loc>https://medsgo.ph/images/example-pack.png</image:loc>
              <image:title>EXAMPLE 50mg Tablet</image:title>
              <image:caption>Example active ingredient 50mg</image:caption>
            </image:image>
          </url>
        </urlset>"""
        self.assertEqual(
            MODULE.sitemap_entries(xml_text),
            [
                {
                    "page_url": (
                        "https://medsgo.ph/prescription-medicines/example/"
                    ),
                    "images": [
                        {
                            "image_url": (
                                "https://medsgo.ph/images/example-pack.png"
                            ),
                            "title": (
                                "EXAMPLE 50mg Tablet "
                                "Example active ingredient 50mg"
                            ),
                        }
                    ],
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
