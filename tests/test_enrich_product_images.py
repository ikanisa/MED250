import importlib.util
import json
import sys
import tempfile
import types
import unittest
from unittest import mock
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "enrich_product_images.py"
sys.path.insert(0, str(SCRIPT.parent))
MONITOR_SCRIPT = Path(__file__).parents[1] / "scripts" / "monitor_product_image_pipeline.zsh"
WORKER_SCRIPT = Path(__file__).parents[1] / "scripts" / "run_product_image_worker.zsh"
TOPOLOGY_SCRIPT = Path(__file__).parents[1] / "scripts" / "product_image_worker_topology.zsh"
MEDICINE_FASTLANE_SCRIPT = (
    Path(__file__).parents[1]
    / "scripts/run_medicine_product_image_fastlane.zsh"
)
LIVE_TOPUP_SCRIPT = (
    Path(__file__).parents[1]
    / "scripts/run_live_gallery_final_topup.zsh"
)
AMAZON_FASTLANE_SCRIPT = (
    Path(__file__).parents[1]
    / "scripts/run_amazon_product_image_fastlane.zsh"
)
DEPLOY_START_SCRIPT = (
    Path(__file__).parents[1]
    / "deploy/launchd/start-product-image-pipeline.command"
)
DEPLOY_WATCHDOG_SCRIPT = (
    Path(__file__).parents[1]
    / "deploy/launchd/product-image-watchdog.zsh"
)
SPEC = importlib.util.spec_from_file_location("product_image_pipeline", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
sys.modules.setdefault("enrich_product_images", MODULE)


class ProductImagePipelineTests(unittest.TestCase):
    def test_coverage_only_cli_rejects_conflicting_final_allocation(self):
        parser = MODULE.build_parser()
        args = parser.parse_args(["--publish", "--coverage-only"])
        self.assertTrue(args.coverage_only)
        self.assertFalse(args.publish_final_allocation)

    def test_live_gallery_topup_cli_is_explicit(self):
        parser = MODULE.build_parser()
        args = parser.parse_args(
            [
                "--publish",
                "--publish-final-allocation",
                "--top-up-from-live-gallery",
            ]
        )
        self.assertTrue(args.publish_final_allocation)
        self.assertTrue(args.top_up_from_live_gallery)

    def test_live_gallery_reuse_requires_hash_verified_provenance(self):
        product = MODULE.Product(
            id="p",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="",
            asin="",
            group="consumer",
        )
        content = b"immutable-approved-webp"
        row = {
            "position": 1,
            "public_url": "https://project.supabase.co/storage/image.webp",
            "storage_path": "v1/p/hash-1.webp",
            "source_page_url": "https://manufacturer.example/product",
            "source_image_url": "https://manufacturer.example/product.jpg",
            "source_domain": "manufacturer.example",
            "source_kind": "manufacturer",
            "rights_basis": "Public manufacturer listing with source retained.",
            "rights_verified": False,
            "width": 1000,
            "height": 1000,
            "quality_score": 90,
            "content_sha256": MODULE.hashlib.sha256(content).hexdigest(),
            "perceptual_hash": "0123456789abcdef",
            "background_removed": True,
            "approved": True,
            "checked_at": "2026-07-17T00:00:00+00:00",
        }

        class Web:
            @staticmethod
            def get_image(_url):
                return content

        images = MODULE.processed_images_from_live_gallery(product, [row], Web())
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0].content_sha256, row["content_sha256"])
        self.assertEqual(images[0].candidate.source_page_url, row["source_page_url"])
        self.assertFalse(images[0].candidate.rights_verified)

        corrupted = {**row, "content_sha256": "0" * 64}
        with self.assertRaisesRegex(MODULE.PipelineError, "content hash changed"):
            MODULE.processed_images_from_live_gallery(product, [corrupted], Web())

    def test_serpapi_candidates_use_originals_and_preserve_unverified_provenance(self):
        product = MODULE.Product(
            id="AMZ-B012345678",
            name="Example 500 ml Shampoo",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="500 ml",
            manufacturer="Example Labs",
            source_url="https://www.amazon.com/dp/B012345678",
            asin="B012345678",
            group="consumer",
        )

        class Client:
            def __init__(self, directory):
                self.cache_dir = Path(directory)

            def get_json(self, url, params):
                self.url = url
                self.params = params
                return {
                    "images_results": [
                        {
                            "title": "Example 500 ml Shampoo",
                            "link": "https://www.amazon.com/dp/B012345678",
                            "original": "https://m.media-amazon.com/images/I/exact.jpg",
                            "original_width": 1600,
                            "original_height": 1600,
                            "is_product": True,
                        },
                        {
                            "title": "Excluded social result",
                            "link": "https://www.pinterest.com/pin/123",
                            "original": "https://i.pinimg.com/originals/bad.jpg",
                        },
                    ]
                }

        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory)
            candidates = MODULE.serpapi_image_candidates(
                product,
                client,
                "secret-provider-key",
            )
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(
            candidate.image_url,
            "https://m.media-amazon.com/images/I/exact.jpg",
        )
        self.assertEqual(candidate.source_page_url, product.source_url)
        self.assertEqual(candidate.source_kind, "marketplace_api")
        self.assertEqual(candidate.declared_width, 1600)
        self.assertFalse(candidate.rights_verified)
        self.assertEqual(candidate.rights_basis, MODULE.AUTOMATED_PROVENANCE)
        self.assertNotIn("secret-provider-key", str(client.cache_dir))

    def test_amazon_product_page_parser_keeps_only_selected_asin_gallery(self):
        product = MODULE.Product(
            id="AMZ-B012345678",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="https://www.amazon.com/dp/B012345678",
            asin="B012345678",
            group="consumer",
        )
        selected = [
            {
                "hiRes": "https://m.media-amazon.com/images/I/selected-1._SL1500_.jpg",
                "large": "https://m.media-amazon.com/images/I/selected-1.jpg",
            },
            {
                "hiRes": "https://m.media-amazon.com/images/I/selected-2._SL1500_.jpg",
            },
            {
                "hiRes": "https://m.media-amazon.com/images/I/selected-3._SL1500_.jpg",
            },
        ]
        other_variant = [
            {"hiRes": "https://m.media-amazon.com/images/I/wrong-variant.jpg"}
        ]
        page = (
            '<input id="ASIN" value="B012345678">'
            + "'colorImages': { 'initial': "
            + json.dumps(selected)
            + " },"
            + '"colorImages":{"different-size":'
            + json.dumps(other_variant)
            + "}"
        )

        class Response:
            headers = {"content-type": "text/html; charset=UTF-8"}
            content = page.encode("utf-8")
            text = page

        class Client:
            def __init__(self, directory):
                self.cache_dir = Path(directory)

            def robots_allowed(self, url):
                self.robots_url = url
                return True

            def request(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                return Response()

        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory)
            candidates = MODULE.amazon_product_page_candidates(product, client)
        self.assertEqual(len(candidates), 3)
        self.assertEqual(
            [candidate.image_url for candidate in candidates],
            [row["hiRes"] for row in selected],
        )
        self.assertTrue(candidates[0].page_primary_image)
        self.assertFalse(candidates[1].page_primary_image)
        self.assertTrue(all(not candidate.rights_verified for candidate in candidates))
        self.assertNotIn("wrong-variant", " ".join(c.image_url for c in candidates))

    def test_amazon_product_page_parser_rejects_identity_mismatch(self):
        product = MODULE.Product(
            id="AMZ-B012345678",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="https://www.amazon.com/dp/B012345678",
            asin="B012345678",
            group="consumer",
        )

        class Response:
            headers = {"content-type": "text/html"}
            text = (
                '"currentAsin":"B099999999",'
                "'colorImages': {'initial': "
                + json.dumps(
                    [{"hiRes": "https://m.media-amazon.com/images/I/wrong.jpg"}]
                )
                + "}"
            )
            content = text.encode("utf-8")

        class Client:
            def __init__(self, directory):
                self.cache_dir = Path(directory)

            def robots_allowed(self, url):
                return True

            def request(self, *args, **kwargs):
                return Response()

        with tempfile.TemporaryDirectory() as directory:
            candidates = MODULE.amazon_product_page_candidates(
                product, Client(directory)
            )
        self.assertEqual(candidates, [])

    def test_cached_manifest_builders_reuse_structured_serpapi_results(self):
        import build_cached_consumer_candidate_manifest as consumer_builder
        import build_cached_medicine_candidate_manifest as medicine_builder

        product = MODULE.Product(
            id="AMZ-B012345678",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="https://www.amazon.com/dp/B012345678",
            asin="B012345678",
            group="consumer",
        )
        query = MODULE.product_image_search_queries(product, 0)[0]
        filename = (
            MODULE.hashlib.sha256(
                f"serpapi-google-images:{query}".encode("utf-8")
            ).hexdigest()
            + ".json"
        )
        payload = {
            "images_results": [
                {
                    "link": "https://www.amazon.com/dp/B012345678",
                    "original": "https://m.media-amazon.com/images/I/exact.jpg",
                    "title": "Example Product B012345678",
                    "original_width": 1500,
                    "original_height": 1500,
                }
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            (cache_dir / filename).write_text(json.dumps(payload), encoding="utf-8")
            consumer_rows = consumer_builder.cached_bing_rows(cache_dir, product)
            medicine_rows = medicine_builder.cached_bing_rows(cache_dir, product)
        for rows in (consumer_rows, medicine_rows):
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["purl"], payload["images_results"][0]["link"])
            self.assertEqual(rows[0]["murl"], payload["images_results"][0]["original"])
            self.assertEqual(rows[0]["w"], 1500)

    def test_cached_manifest_builders_reuse_yandex_originals(self):
        import build_cached_consumer_candidate_manifest as consumer_builder
        import build_cached_medicine_candidate_manifest as medicine_builder

        product = MODULE.Product(
            id="AMZ-B012345678",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="https://www.amazon.com/dp/B012345678",
            asin="B012345678",
            group="consumer",
        )
        query = MODULE.product_image_search_queries(product, 0)[0]
        filename = (
            MODULE.hashlib.sha256(f"yandex:{query}".encode("utf-8")).hexdigest()
            + ".json"
        )
        payload = [
            {
                "origUrl": "https://m.media-amazon.com/images/I/exact.jpg",
                "origWidth": 1600,
                "origHeight": 1500,
                "snippet": {
                    "url": "https://www.amazon.com/dp/B012345678",
                    "title": "Example Product B012345678",
                },
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            (cache_dir / filename).write_text(json.dumps(payload), encoding="utf-8")
            consumer_rows = consumer_builder.cached_bing_rows(cache_dir, product)
            medicine_rows = medicine_builder.cached_bing_rows(cache_dir, product)
        for rows in (consumer_rows, medicine_rows):
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["purl"], payload[0]["snippet"]["url"])
            self.assertEqual(rows[0]["murl"], payload[0]["origUrl"])
            self.assertEqual(rows[0]["w"], 1600)

    def test_duckduckgo_fastlane_can_bound_query_count(self):
        source = SCRIPT.read_text(encoding="utf-8")
        function_source = source[
            source.index("def duckduckgo_image_candidates("):
            source.index("def bing_image_candidates(")
        ]
        self.assertIn("query_limit: int = 0", function_source)
        self.assertIn("queries = queries[:query_limit]", function_source)

    def test_yandex_candidates_use_originals_and_listing_provenance(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-example",
            name="Example 5 mg tablets",
            brand="Example",
            generic="example generic",
            strength="5 mg",
            form="tablet",
            pack_size="30 tablets",
            manufacturer="Example Labs",
            source_url="https://authority.example/products/example",
            asin="",
            group="medicine",
        )
        payload = {
            "initialState": {
                "serpList": {
                    "items": {
                        "entities": {
                            "one": {
                                "origUrl": "https://pharmacy-store.test/pack.jpg",
                                "origWidth": 1800,
                                "origHeight": 1400,
                                "alt": "Example 5 mg tablets",
                                "snippet": {
                                    "title": (
                                        "Example 5 mg example generic tablets - product"
                                    ),
                                    "url": "https://pharmacy-store.test/example-5mg",
                                },
                            },
                            "excluded": {
                                "origUrl": "https://i.pinimg.com/bad.jpg",
                                "snippet": {
                                    "title": "Excluded social result",
                                    "url": "https://www.pinterest.com/pin/123",
                                },
                            },
                        }
                    }
                }
            }
        }

        class Response:
            text = '<div data-state="' + MODULE.html_module.escape(
                json.dumps(payload), quote=True
            ) + '"></div>'

        class Client:
            def __init__(self, directory):
                self.cache_dir = Path(directory)

            def request(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                return Response()

        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory)
            candidates = MODULE.yandex_image_candidates(
                product, client, query_limit=1
            )
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate.image_url, "https://pharmacy-store.test/pack.jpg")
        self.assertEqual(
            candidate.source_page_url,
            "https://pharmacy-store.test/example-5mg",
        )
        self.assertEqual(candidate.declared_width, 1800)
        self.assertEqual(candidate.declared_height, 1400)
        self.assertGreaterEqual(candidate.priority, 96)
        self.assertFalse(candidate.rights_verified)
        self.assertEqual(candidate.rights_basis, MODULE.AUTOMATED_PROVENANCE)

    def test_brave_candidates_use_originals_and_listing_provenance(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-example",
            name="Example 5 mg tablets",
            brand="Example",
            generic="example generic",
            strength="5 mg",
            form="tablet",
            pack_size="30 tablets",
            manufacturer="Example Labs",
            source_url="https://authority.example/products/example",
            asin="",
            group="medicine",
        )
        page = r'''<script>response:{type:"images",query:{},results:[
        {title:"Example 5 mg example generic tablets",url:"https://pharmacy-store.test/example-5mg",family_friendly:true,thumbnail:{src:"https://thumb.test/example.jpg",original:"https://pharmacy-store.test/example-pack.jpg"},properties:{url:"https://pharmacy-store.test/example-pack.jpg",height:1400,width:1800},meta_url:{hostname:"pharmacy-store.test"},bo_serp_visible:true},
        {title:"Stock tablets",url:"https://www.shutterstock.com/search/tablets",family_friendly:true,thumbnail:{original:"https://www.shutterstock.com/generic.jpg"},properties:{height:1200,width:1200},meta_url:{hostname:"shutterstock.com"},bo_serp_visible:true}
        ]}}</script>'''

        class Response:
            text = page

        class Client:
            def __init__(self, directory):
                self.cache_dir = Path(directory)

            def request(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                return Response()

        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory)
            candidates = MODULE.brave_image_candidates(
                product, client, query_limit=1
            )
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(
            candidate.image_url,
            "https://pharmacy-store.test/example-pack.jpg",
        )
        self.assertEqual(
            candidate.source_page_url,
            "https://pharmacy-store.test/example-5mg",
        )
        self.assertEqual(candidate.declared_width, 1800)
        self.assertEqual(candidate.declared_height, 1400)
        self.assertGreaterEqual(candidate.priority, 96)
        self.assertFalse(candidate.rights_verified)
        self.assertEqual(candidate.rights_basis, MODULE.AUTOMATED_PROVENANCE)

    def test_web_client_bounds_connect_timeout_for_large_catalogue_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            client = MODULE.WebClient(Path(directory), timeout=25, delay=0)
            try:
                self.assertEqual(client.client.timeout.connect, 8.0)
                self.assertEqual(client.client.timeout.read, 25)
            finally:
                client.close()

    def test_public_image_indexes_are_queried_concurrently_in_stable_order(self):
        product = MODULE.Product(
            id="p",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example Labs",
            source_url="https://example.test/product",
            asin="",
            group="consumer",
        )
        barrier = MODULE.threading.Barrier(4)

        def provider(name):
            def run(_product, _client, _retry_count=0, query_limit=0):
                self.assertEqual(query_limit, 1)
                barrier.wait(timeout=2)
                return [
                    MODULE.Candidate(
                        product_id=product.id,
                        image_url=f"https://images.example.test/{name}.jpg",
                        source_page_url=f"https://shop.example.test/{name}",
                        source_domain="shop.example.test",
                        source_kind="specialist_retailer",
                        rights_basis=MODULE.AUTOMATED_PROVENANCE,
                        priority=80,
                        title=name,
                        rights_verified=False,
                    )
                ]

            return run

        with (
            mock.patch.object(MODULE, "bing_image_candidates", provider("bing")),
            mock.patch.object(MODULE, "yandex_image_candidates", provider("yandex")),
            mock.patch.object(MODULE, "brave_image_candidates", provider("brave")),
            mock.patch.object(
                MODULE,
                "duckduckgo_image_candidates",
                provider("duckduckgo"),
            ),
        ):
            candidates = MODULE.parallel_public_image_candidates(
                product,
                object(),
                query_limit=1,
            )
        self.assertEqual(
            [candidate.title for candidate in candidates],
            ["bing", "yandex", "brave", "duckduckgo"],
        )

    def test_worker_topology_is_contiguous_and_covers_live_catalogue(self):
        topology = TOPOLOGY_SCRIPT.read_text(encoding="utf-8")
        offsets_match = MODULE.re.search(
            r"MED250_WORKER_OFFSETS=\(([^)]*)\)", topology
        )
        limits_match = MODULE.re.search(
            r"MED250_WORKER_LIMITS=\(([^)]*)\)", topology
        )
        self.assertIsNotNone(offsets_match)
        self.assertIsNotNone(limits_match)
        offsets = [int(value) for value in offsets_match.group(1).split()]
        limits = [int(value) for value in limits_match.group(1).split()]
        self.assertEqual(len(offsets), 4)
        self.assertEqual(len(limits), 4)
        expected_offset = 0
        for offset, limit in zip(offsets, limits):
            self.assertEqual(offset, expected_offset)
            self.assertGreater(limit, 0)
            expected_offset += limit
        self.assertEqual(expected_offset, 4659)

    def test_medicine_fastlane_uses_ten_contiguous_memory_bounded_shards(self):
        source = MEDICINE_FASTLANE_SCRIPT.read_text(encoding="utf-8")
        limits_match = MODULE.re.search(r"SHARD_LIMITS=\(([^)]*)\)", source)
        self.assertIsNotNone(limits_match)
        limits = [int(value) for value in limits_match.group(1).split()]
        self.assertEqual(len(limits), 10)
        self.assertEqual(sum(limits), 2459)
        self.assertIn("index<${#SHARD_LIMITS[@]}", source)
        self.assertIn("paused_wrappers", source)
        self.assertIn('kill -TERM "$child"', source)
        self.assertIn('kill -CONT "$wrapper"', source)

    def test_live_gallery_topup_shards_cover_the_catalogue(self):
        source = LIVE_TOPUP_SCRIPT.read_text(encoding="utf-8")
        offsets_match = MODULE.re.search(r"OFFSETS=\(([^)]*)\)", source)
        limits_match = MODULE.re.search(r"LIMITS=\(([^)]*)\)", source)
        self.assertIsNotNone(offsets_match)
        self.assertIsNotNone(limits_match)
        offsets = [int(value) for value in offsets_match.group(1).split()]
        limits = [int(value) for value in limits_match.group(1).split()]
        self.assertEqual(offsets, [0, 1165, 2330, 3495])
        self.assertEqual(limits, [1165, 1165, 1165, 1164])
        self.assertEqual(sum(limits), 4659)
        self.assertIn("--top-up-from-live-gallery", source)
        self.assertIn("--publish-final-allocation", source)
        self.assertIn("--ignore-retry-cooldown", source)

    def test_amazon_fastlane_is_resumable_and_releases_generic_model_memory(self):
        source = AMAZON_FASTLANE_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("MED250_AMAZON_POLICY_SUFFIX", source)
        self.assertIn("paused_wrappers", source)
        self.assertIn('kill -TERM "$child"', source)
        self.assertIn('kill -CONT "$wrapper"', source)
        self.assertIn("--download-workers 4", source)
        self.assertIn("SHARD_COUNT * SHARD_SIZE != AMAZON_PRODUCT_COUNT", source)

    def test_persistent_launchers_use_shared_coverage_first_topology(self):
        start = DEPLOY_START_SCRIPT.read_text(encoding="utf-8")
        watchdog = DEPLOY_WATCHDOG_SCRIPT.read_text(encoding="utf-8")
        for source in (start, watchdog):
            self.assertIn("product-image-worker-topology.zsh", source)
            self.assertIn("MED250_WORKER_COUNT", source)
            self.assertNotIn("--limit 1553", source)
            self.assertIn(".approved_images == 23977", source)
            self.assertIn(".products_with_final_allocation == 4659", source)
        self.assertIn("publication_args=(--coverage-only --skip-existing-final)", start)
        self.assertIn("--publish-final-allocation", start)
        self.assertIn("--top-up-from-live-gallery", start)
        worker = WORKER_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("CONTRACT_STALE_GRACE_SECONDS=86400", worker)
        self.assertIn("contract_cache_is_usable_stale", worker)

    def test_monitor_url_audit_single_flight_is_argument_order_independent(self):
        source = MONITOR_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("'[e]nrich_product_images.py.*--verify-only'", source)
        self.assertNotIn(
            "--verify-only.*--target-images 23977",
            source,
        )
        self.assertIn("public_url_verification_is_fresh", source)
        self.assertIn("age < VERIFY_EVERY_CYCLES * 60", source)

    def test_medicine_brand_matching_ignores_flattened_trademark_marker(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1076",
            name="LEQVIOTM SOLUTION FOR INJECTION",
            brand="LEQVIOTM SOLUTION FOR INJECTION",
            generic="inclisiran",
            strength="300mg/1.5ml",
            form="Solution for injection",
            pack_size="1 pre-filled syringe",
            manufacturer="SANDOZ GmbH",
            group="medicine",
            source_url="https://rwandafda.gov.rw/register/monitoring_preview_register",
            asin="",
        )
        self.assertTrue(
            MODULE.medicine_name_evidence(
                product,
                "LEQVIO inclisiran solution for injection Novartis",
            )
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "Unrelated inclisiran product Novartis",
            )
        )

        official = MODULE.Candidate(
            product_id=product.id,
            image_url="https://dailymed.nlm.nih.gov/dailymed/image.cfm?name=leqvio.jpg",
            source_page_url="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=exact",
            source_domain="dailymed.nlm.nih.gov",
            source_kind="licensed_feed",
            rights_basis="Official label; reuse rights unverified.",
            priority=300,
            title="LEQVIO inclisiran solution for injection, Novartis",
            rights_verified=False,
            page_primary_image=True,
        )
        self.assertTrue(
            MODULE.verified_regulatory_pack_artwork(
                product,
                official,
                "LEQVIO inclisiran 284 mg per 1.5 mL equivalent to 300 mg sodium solution for injection",
            )
        )
        marketplace = MODULE.replace(
            official,
            source_kind="marketplace_api",
        )
        self.assertFalse(
            MODULE.verified_regulatory_pack_artwork(
                product,
                marketplace,
                "LEQVIO inclisiran 284 mg per 1.5 mL equivalent to 300 mg sodium solution for injection",
            )
        )

    def test_medicine_brand_matching_excludes_structured_form_metadata(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0137",
            name="GYNOZOL Vaginal Cream",
            brand="GYNOZOL Vaginal Cream",
            generic="MICONAZOLE NITRATE",
            strength="0.8 G",
            form="Vaginal Cream",
            pack_size="40g Cream",
            manufacturer="Pharco Pharmaceuticals Industries",
            source_url="https://rwandafda.gov.rw/register/monitoring_preview_register",
            asin="",
            group="medicine",
        )
        exact = (
            "https://pillintrip.com/uploads/medicines/gynozol-miconazole-nitrate/"
            "Gynozol-Miconazole-nitrate.png"
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, exact))
        self.assertTrue(MODULE.medicine_identity_evidence(product, exact))
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "Generic miconazole nitrate vaginal cream",
            )
        )
        exact = MODULE.Candidate(
            product_id=product.id,
            image_url=(
                "https://pharmacy.example/images/gynozol-miconazole-nitrate.png"
            ),
            source_page_url=(
                "https://pharmacy.example/products/gynozol-miconazole-nitrate"
            ),
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=65,
            title="GYNOZOL Miconazole Nitrate",
        )
        generic = MODULE.replace(
            exact,
            image_url="https://pharmacy.example/images/miconazole.png",
            source_page_url="https://pharmacy.example/products/miconazole",
            title="Miconazole Nitrate Vaginal Cream",
        )
        self.assertTrue(MODULE.exact_medicine_listing_seed(product, exact))
        self.assertFalse(MODULE.exact_medicine_listing_seed(product, generic))

    def test_brand_only_search_seed_requires_exact_listing_page_identity(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0137",
            name="GYNOZOL Vaginal Cream",
            brand="GYNOZOL Vaginal Cream",
            generic="MICONAZOLE NITRATE",
            strength="0.8 G",
            form="Vaginal Cream",
            pack_size="40g Cream",
            manufacturer="Pharco Pharmaceuticals Industries",
            source_url="",
            asin="",
            group="medicine",
        )
        seed = MODULE.Candidate(
            product_id=product.id,
            image_url="https://pharmacy.example/thumbs/gynozol.jpg",
            source_page_url="https://pharmacy.example/products/gynozol",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=80,
            title="GYNOZOL Vaginal Cream product",
        )
        self.assertFalse(MODULE.exact_medicine_listing_seed(product, seed))

        class ExactPage:
            @staticmethod
            def get_page(_url):
                return (
                    "https://pharmacy.example/products/gynozol",
                    """
                    <html><head>
                      <title>GYNOZOL Miconazole Nitrate 0.8 g Vaginal Cream</title>
                      <meta property="og:image"
                        content="https://pharmacy.example/images/gynozol-pack.jpg">
                    </head><body>Manufactured by Pharco Pharmaceuticals</body></html>
                    """,
                )

        self.assertEqual(
            MODULE.hydrate_exact_medicine_listing_candidates(
                product, [seed], ExactPage(), page_limit=1
            ),
            [],
        )
        hydrated = MODULE.hydrate_exact_medicine_listing_candidates(
            product,
            [seed],
            ExactPage(),
            page_limit=1,
            allow_brand_only_seed=True,
        )
        self.assertTrue(hydrated)
        self.assertIn("Miconazole Nitrate", hydrated[0].title)

        class WrongPage:
            @staticmethod
            def get_page(_url):
                return (
                    "https://pharmacy.example/products/gynozol",
                    "<html><title>GYNOZOL fashion cream</title></html>",
                )

        self.assertEqual(
            MODULE.hydrate_exact_medicine_listing_candidates(
                product,
                [seed],
                WrongPage(),
                page_limit=1,
                allow_brand_only_seed=True,
            ),
            [],
        )

    def test_public_image_verification_retries_transient_storage_response(self):
        class Response:
            def __init__(self, status, content_type=""):
                self.status_code = status
                self.headers = {"content-type": content_type}

        class Client:
            def __init__(self):
                self.calls = 0

            def head(self, _url):
                self.calls += 1
                return Response(503 if self.calls == 1 else 200, "image/webp")

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.client = Client()
        with mock.patch.object(MODULE.time, "sleep"):
            self.assertTrue(
                publisher.public_image_url_is_live(
                    "https://project.supabase.co/storage/v1/object/public/b/i.webp"
                )
            )
        self.assertEqual(publisher.client.calls, 2)

    def test_publisher_accepts_fresh_wrapper_contract_attestation(self):
        class Client:
            def post(self, *_args, **_kwargs):
                raise AssertionError("The aggregate contract RPC must not be repeated")

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.base_url = "https://project.supabase.co"
        publisher.headers = {}
        publisher.client = Client()
        with tempfile.TemporaryDirectory() as directory:
            attestation = Path(directory) / "contract.ok"
            attestation.write_text(
                MODULE.EXPECTED_BACKEND_CONTRACT_VERSION,
                encoding="utf-8",
            )
            with (
                mock.patch.object(
                    MODULE,
                    "CONTRACT_ATTESTATION_PATH",
                    attestation,
                ),
                mock.patch.dict(
                    MODULE.os.environ,
                    {
                        "MED250_BACKEND_CONTRACT_ATTESTED":
                            MODULE.EXPECTED_BACKEND_CONTRACT_VERSION
                    },
                ),
            ):
                publisher.assert_publication_backend_safe()

    def test_verification_only_checks_requested_product_rows(self):
        class Response:
            status_code = 200

            def __init__(self, payload=None):
                self._payload = payload
                self.headers = {"content-type": "image/webp"}
                self.text = ""

            def json(self):
                return self._payload

        class Client:
            def __init__(self):
                self.head_urls = []

            def get(self, _url, headers=None, params=None):
                return Response([
                    {
                        "product_id": "requested",
                        "position": 1,
                        "public_url": "https://images.example/requested.webp",
                        "approved": True,
                        "background_removed": True,
                    },
                    {
                        "product_id": "unrelated",
                        "position": 1,
                        "public_url": "https://images.example/unrelated.webp",
                        "approved": True,
                        "background_removed": True,
                    },
                ])

            def head(self, url):
                self.head_urls.append(url)
                return Response()

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.base_url = "https://project.supabase.co"
        publisher.headers = {}
        publisher.client = Client()
        result = publisher.verify({"requested": 1})
        self.assertEqual(result["published_images"], 1)
        self.assertEqual(
            publisher.client.head_urls,
            ["https://images.example/requested.webp"],
        )

    def test_monitor_derives_validation_policy_from_pipeline_source(self):
        monitor = MONITOR_SCRIPT.read_text(encoding="utf-8")
        self.assertIn(
            '"$REPO/scripts/enrich_product_images.py"',
            monitor,
        )
        self.assertNotIn(
            f'VALIDATION_POLICY_VERSION="{MODULE.IMAGE_VALIDATION_POLICY_VERSION}"',
            monitor,
        )

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

    def test_manifest_accepts_explicit_scene7_image_endpoint(self):
        image_url = (
            "https://target.scene7.com/is/image/Target/GUEST_exact-product"
            "?fmt=pjpeg&hei=1500&wid=1500"
        )
        payload = [{
            "product_id": "AMZ-B0BZTNMWZJ",
            "source_page_url": "https://www.target.com/p/-/A-91103054",
            "source_kind": "specialist_retailer",
            "images": [image_url],
        }]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "target.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertEqual(
            [candidate.image_url for candidate in result["AMZ-B0BZTNMWZJ"]],
            [image_url],
        )

    def test_manifest_accepts_dailymed_regulatory_image_endpoint(self):
        image_url = (
            "https://dailymed.nlm.nih.gov/dailymed/image.cfm?name=leqvio-05.jpg"
            "&setid=6fc0afca-4513-4c35-b594-6544aee29a44"
        )
        payload = [{
            "product_id": "rwanda-fda-hm-1076",
            "source_page_url": "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=exact",
            "source_kind": "licensed_feed",
            "images": [image_url],
        }]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dailymed.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertEqual(
            [candidate.image_url for candidate in result["rwanda-fda-hm-1076"]],
            [image_url],
        )

    def test_manifest_accepts_exact_chemist180_product_image_endpoint(self):
        image_url = (
            "https://api.chemist180.com/api/media/image-resize/"
            "?path=Product%20Images%2F&name=DOBESIL_H_30GM_CREAM_chemist180.jpg&w=1200"
        )
        payload = [{
            "product_id": "rwanda-fda-hm-0179",
            "source_page_url": (
                "https://chemist180.com/products/productdetails/dobesil-h-30gm-cream"
            ),
            "source_kind": "specialist_retailer",
            "images": [image_url],
        }]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chemist180.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertEqual(
            [candidate.image_url for candidate in result["rwanda-fda-hm-0179"]],
            [image_url],
        )

    def test_manifest_rejects_unscoped_extensionless_image_endpoint(self):
        payload = [{
            "product_id": "p1",
            "source_page_url": "https://retailer.example/products/p1",
            "source_kind": "specialist_retailer",
            "images": [
                "https://retailer.example/image-resize/?name=product.jpg&w=1200"
            ],
        }]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unscoped.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertNotIn("p1", result)

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

    def test_manifest_preserves_explicit_primary_regulatory_render(self):
        payload = [{
            "product_id": "rwanda-fda-hm-0975",
            "source_page_url": "https://regulator.example/official-label.pdf",
            "source_kind": "licensed_feed",
            "page_primary_image": True,
            "images": ["https://images.example/official-label-render.png"],
        }]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "regulatory.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = MODULE.load_candidate_manifests([path])
        self.assertTrue(result["rwanda-fda-hm-0975"][0].page_primary_image)

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

    def test_canonical_url_upgrades_http_provenance_to_https(self):
        self.assertEqual(
            MODULE.canonical_url(
                "http://eurofoodmart.com/cdn/shop/products/persil.jpg#gallery"
            ),
            "https://eurofoodmart.com/cdn/shop/products/persil.jpg",
        )
        self.assertEqual(
            MODULE.canonical_url(
                "/products/persil",
                "http://eurofoodmart.com/collections/laundry",
            ),
            "https://eurofoodmart.com/products/persil",
        )

    def test_complete_checkpoint_requires_the_allocated_gallery_size(self):
        checkpoint = {
            "status": "published",
            "payload": {
                "validation_policy_version": MODULE.IMAGE_VALIDATION_POLICY_VERSION,
                "images": [
                    {"rights_verified": False},
                    {"rights_verified": False},
                    {"rights_verified": False},
                    {"rights_verified": False},
                    {"rights_verified": False},
                ]
            },
        }
        self.assertTrue(MODULE.checkpoint_is_complete_publication(checkpoint, 5))
        self.assertFalse(MODULE.checkpoint_is_complete_publication(checkpoint, 6))
        stale = json.loads(json.dumps(checkpoint))
        stale["payload"]["validation_policy_version"] = "old-policy"
        self.assertFalse(MODULE.checkpoint_is_complete_publication(stale, 5))
        self.assertTrue(MODULE.checkpoint_publication_uses_current_policy(checkpoint))
        self.assertFalse(MODULE.checkpoint_publication_uses_current_policy(stale))

    def test_allocates_exact_23977_target_for_4659_products(self):
        targets = MODULE.allocate_image_targets(
            [f"p-{index:04d}" for index in range(4659)]
        )
        self.assertEqual(sum(targets.values()), 23_977)
        self.assertEqual(sum(value == 6 for value in targets.values()), 682)
        self.assertEqual(sum(value == 5 for value in targets.values()), 3977)
        self.assertTrue(all(3 <= value <= 6 for value in targets.values()))

    def test_missing_galleries_are_prioritized_without_changing_shard_order(self):
        def product(product_id):
            return MODULE.Product(
                id=product_id,
                name=product_id,
                brand="",
                generic="",
                strength="",
                form="",
                pack_size="",
                manufacturer="",
                source_url="",
                asin="",
                group="consumer",
            )

        products = [product("complete-a"), product("attempted-a"),
                    product("missing-a"), product("complete-b"),
                    product("attempted-b"), product("missing-b")]
        prioritized = MODULE.prioritize_missing_galleries(
            products,
            {"complete-a", "complete-b"},
            {"complete-a", "complete-b", "attempted-a", "attempted-b"},
        )
        self.assertEqual(
            [item.id for item in prioritized],
            [
                "missing-a",
                "missing-b",
                "attempted-a",
                "attempted-b",
                "complete-a",
                "complete-b",
            ],
        )
        preferred = MODULE.prioritize_missing_galleries(
            products,
            {"complete-a", "complete-b"},
            {"complete-a", "complete-b", "attempted-a", "attempted-b"},
            {"attempted-b"},
        )
        self.assertEqual(
            [item.id for item in preferred],
            [
                "attempted-b",
                "missing-a",
                "missing-b",
                "attempted-a",
                "complete-a",
                "complete-b",
            ],
        )

    def test_prefers_three_real_source_images_before_derived_views(self):
        self.assertEqual(MODULE.PREFERRED_SOURCE_IMAGES, 3)

    def test_retry_searches_add_concise_and_official_queries(self):
        product = MODULE.Product(
            id="AMZ-B0GHD98T4M",
            name=(
                "Cleancult Laundry Detergent Sheets - Resealable Box - "
                "3 Stain Fighting Enzymes - Fragrance Free - 60 Loads"
            ),
            brand="Cleancult",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0GHD98T4M",
            asin="B0GHD98T4M",
            group="consumer",
        )
        first_pass = MODULE.product_image_search_queries(product, 0)
        retry = MODULE.product_image_search_queries(product, 1)
        self.assertGreater(len(retry), len(first_pass))
        self.assertTrue(any("official product image" in query for query in retry))
        self.assertTrue(any('"B0GHD98T4M" product images' == query for query in retry))

    def test_medicine_retry_adds_exact_vietnamese_pharmacy_query(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1329",
            name="NUSAR 50",
            brand="NUSAR 50",
            generic="Losartan Potassium BP/USP 50 mg",
            strength="50 mg",
            form="Film-coated tablet",
            pack_size="3x10 Tablets",
            manufacturer="EMCURE PHARMACEUTICALS LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        first_pass = MODULE.product_image_search_queries(product, 0)
        retry = MODULE.product_image_search_queries(product, 1)
        multilingual = (
            '"NUSAR 50" "Losartan Potassium BP/USP 50 mg" thuốc'
        )
        self.assertNotIn(multilingual, first_pass)
        self.assertIn(multilingual, retry)

    def test_medicine_retry_leads_with_fresh_exact_manufacturer_query(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1329",
            name="NUSAR 50",
            brand="NUSAR 50",
            generic="Losartan Potassium BP/USP 50 mg",
            strength="50 mg",
            form="Film-coated tablet",
            pack_size="3x10 Tablets",
            manufacturer="EMCURE PHARMACEUTICALS LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        first_pass = MODULE.product_image_search_queries(product, 0)
        retry = MODULE.product_image_search_queries(product, 1)
        self.assertEqual(
            retry[0],
            '"NUSAR 50" "EMCURE PHARMACEUTICALS LIMITED" product image',
        )
        self.assertNotEqual(retry[0], first_pass[0])
        self.assertEqual(
            MODULE.product_image_search_queries(product, 2)[0],
            '"NUSAR 50" "Losartan Potassium BP/USP 50 mg" pharmacy product',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(product, 3)[0],
            '"NUSAR 50" "Losartan Potassium BP/USP 50 mg" thuốc',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(product, 4)[0],
            '"NUSAR 50" medicine',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(product, 5)[0],
            '"NUSAR 50" site:1mg.com',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(product, 6)[0],
            '"NUSAR 50" site:pharmeasy.in',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(product, 17)[0],
            '"NUSAR 50" site:afyadepot.co.tz',
        )
        self.assertEqual(
            MODULE.product_image_search_queries(
                product,
                5 + len(MODULE.MEDICINE_RETRY_SEARCH_DOMAINS),
            )[0],
            '"NUSAR 50" site:1mg.com',
        )

    def test_reputable_medicine_retailer_receives_priority_over_generic_listing(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-2199",
            name="NOVORAPID FLEXPEN",
            brand="NOVORAPID FLEXPEN",
            generic="Insulin Aspart",
            strength="100 units/ml",
            form="Solution for injection",
            pack_size="5 pens",
            manufacturer="NOVO NORDISK",
            source_url="",
            asin="",
            group="medicine",
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://medsgo.ph/prescription-medicines/novorapid/",
                product,
            ),
            ("specialist_retailer", 84),
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://www.1mg.com/drugs/novorapid-flexpen-12345",
                product,
            ),
            ("specialist_retailer", 84),
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://example-market.invalid/novorapid/",
                product,
            ),
            ("specialist_retailer", 65),
        )

    def test_non_product_listing_domains_are_rejected_from_ranked_candidates(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-2199",
            name="NOVORAPID FLEXPEN",
            brand="NOVORAPID FLEXPEN",
            generic="Insulin Aspart",
            strength="100 units/ml",
            form="Solution for injection",
            pack_size="5 pens",
            manufacturer="NOVO NORDISK",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url="https://images.example.invalid/novorapid-flexpen.jpg",
            source_page_url="https://www.youtube.com/watch?v=not-a-product-listing",
            source_domain="www.youtube.com",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=65,
            title="NOVORAPID FLEXPEN Insulin Aspart",
        )
        self.assertEqual(MODULE.ranked_candidate_variants(product, [candidate]), [])

    def test_wordpress_thumbnail_gets_original_resolution_variant(self):
        candidate = MODULE.Candidate(
            product_id="rwanda-fda-hm-2199",
            image_url=(
                "https://pharmacy.example/wp-content/uploads/2026/07/"
                "novorapid-flexpen-300x300.jpg"
            ),
            source_page_url="https://pharmacy.example/product/novorapid-flexpen/",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=65,
            title="NOVORAPID FLEXPEN Insulin Aspart",
        )
        variants = MODULE.high_resolution_candidate_variants(candidate)
        self.assertEqual(
            variants[0].image_url,
            "https://pharmacy.example/wp-content/uploads/2026/07/novorapid-flexpen.jpg",
        )
        self.assertEqual(variants[0].declared_width, 1200)
        self.assertEqual(variants[0].declared_height, 1200)

    def test_medicine_ocr_accepts_exact_spanish_soft_capsule_pack(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0138",
            name="HIDROFEROL 0.266MG SOFT CAPSULES",
            brand="HIDROFEROL 0.266MG SOFT CAPSULES",
            generic="Calcifediol",
            strength="0.266 mg",
            form="Soft gelatin capsules",
            pack_size="10 capsules",
            manufacturer="FAES FARMA",
            source_url="",
            asin="",
            group="medicine",
        )
        image_text = (
            "HIDROFEROL 0,266 mg cápsulas blandas Calcifediol "
            "10 cápsulas vía oral FAES FARMA"
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://pharmacy.example/hidroferol-0266.jpg",
            "https://pharmacy.example/hidroferol-0266-capsulas-blandas",
            "pharmacy.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            90,
            "HIDROFEROL 0.266 mg Calcifediol soft capsules",
            page_primary_image=True,
        )
        self.assertEqual(
            MODULE.medicine_form_groups(image_text),
            {"capsule"},
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, image_text))
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                image_text,
            )
        )
    def test_medicine_brand_core_stops_before_bracketed_scientific_name(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0171",
            name=(
                "MenFive [Meningococcal (A, C, Y, W, X) Polysaccharide "
                "Conjugate Vaccine (Freeze-Dried)]"
            ),
            brand="MenFive",
            generic="Meningococcal A C Y W X Polysaccharide Conjugate Vaccine",
            strength="",
            form="Powder for injection",
            pack_size="5-dose vial",
            manufacturer="Serum Institute of India",
            source_url="",
            asin="",
            group="medicine",
        )
        image_text = (
            "MenFive Meningococcal A C Y W X Polysaccharide Conjugate "
            "Vaccine Serum Institute of India"
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://www.menfive.com/images/MenFive_Vaccine.jpg",
            "https://www.menfive.com/meningococcal_vaccine.html",
            "menfive.com",
            "manufacturer",
            MODULE.AUTOMATED_PROVENANCE,
            100,
            (
                "MenFive meningococcal A C Y W X polysaccharide conjugate "
                "vaccine, Serum Institute of India"
            ),
            page_primary_image=True,
        )
        self.assertEqual(MODULE.medicine_core_name_tokens(product), ["menfive"])
        self.assertTrue(MODULE.medicine_name_evidence(product, image_text))
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                image_text,
            )
        )
        self.assertTrue(
            MODULE.manufacturer_medicine_kit_is_verified(
                product,
                candidate,
                image_text,
                [14500, 16200],
            )
        )

    def test_medicine_brand_core_stops_at_registered_grm_pack_size(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0179",
            name="DOBESIL H CREAM 30 GRM",
            brand="DOBESIL H CREAM 30 GRM",
            generic=(
                "Calcium Dobesilate, Lidocaine, Hydrocortisone Acetate, "
                "Zinc Oxide"
            ),
            strength="0.5% + 3% + 0.25% + 5%",
            form="Cream",
            pack_size="30 g tube",
            manufacturer="AUROCHEM LABORATORIES (I) PVT LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        self.assertEqual(
            MODULE.registered_medicine_brand_core(product),
            "dobesil h cream",
        )
        self.assertEqual(MODULE.medicine_core_name_tokens(product), ["dobesil"])
        self.assertTrue(
            MODULE.medicine_name_evidence(
                product,
                "Dobesil-H Cream Calcium Dobesilate Lidocaine 30 g",
            )
        )

    def test_medicine_brand_core_stops_at_matching_structured_strength(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0144",
            name=(
                "Simulect 20 mg powder and solvent for solution for infusion "
                "or injection"
            ),
            brand=(
                "Simulect 20 mg powder and solvent for solution for infusion "
                "or injection"
            ),
            generic="BASILIXIMAB",
            strength="20mg",
            form="Powder for Solution for Injection/Infusion",
            pack_size="",
            manufacturer="NOVARTIS PHARMA S.A.S.",
            source_url="",
            asin="",
            group="medicine",
        )
        image_text = (
            "NOVARTIS Simulect basiliximab for injection 20 mg single use vial"
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://trungtamthuoc.com/images/products/simulect-20mg-1.jpg",
            "https://trungtamthuoc.com/simulect-injiv-20mg",
            "trungtamthuoc.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            100,
            "Simulect 20 mg basiliximab powder and solvent for injection",
            page_primary_image=True,
        )
        self.assertEqual(MODULE.registered_medicine_brand_core(product), "simulect")
        self.assertEqual(MODULE.medicine_core_name_tokens(product), ["simulect"])
        self.assertTrue(MODULE.medicine_name_evidence(product, image_text))
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(product, candidate, image_text)
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "Unrelated basiliximab 20 mg powder for injection Novartis",
            )
        )

    def test_truncated_high_identity_listing_enters_ocr_review_band(self):
        product = MODULE.Product(
            id="AMZ-B0GHDJXKP3",
            name=(
                "Cleancult Laundry Detergent Sheets - Resealable Box - "
                "3 Stain Fighting Enzymes - Fresh Linen - 60 Loads - "
                "Free of Harsh Chemicals - No Mess - No Plastic Waste "
                "(Pack of 2)"
            ),
            brand="Cleancult",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0GHDJXKP3",
            asin="B0GHDJXKP3",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/81ISa1Bh6mL.jpg",
            (
                "https://www.desertcart.com/products/655437926-"
                "cleancult-laundry-detergent-sheets-resealable-box-"
                "3-stain-fighting-enzymes"
            ),
            "desertcart.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            (
                "Cleancult Laundry Detergent Sheets Resealable Box "
                "3 Stain Fighting Enzymes"
            ),
        )
        score = MODULE.candidate_identity_score(product, candidate)
        self.assertGreaterEqual(score, MODULE.OCR_REVIEW_IDENTITY_SCORE)
        self.assertLess(score, 0.85)
        self.assertTrue(MODULE.requires_image_ocr(product, candidate, 1500, 1500))

    def test_duckduckgo_requests_do_not_retry_slow_provider_failures(self):
        source = SCRIPT.read_text(encoding="utf-8")
        function = source[
            source.index("def duckduckgo_image_candidates("):
            source.index("def bing_image_candidates(")
        ]
        self.assertGreaterEqual(function.count("attempts=1"), 2)

    def test_high_resolution_variants_upgrade_indiamart_and_pinterest_thumbnails(self):
        product_id = "example"
        indiamart = MODULE.Candidate(
            product_id,
            (
                "https://5.imimg.com/data5/SELLER/Default/2024/5/1/A/B/C/"
                "medicine-box-500x500.jpg"
            ),
            "https://example.com/product",
            "example.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Example medicine box",
        )
        pinterest = MODULE.Candidate(
            product_id,
            "https://i.pinimg.com/736x/aa/bb/cc/image.jpg",
            "https://www.pinterest.com/pin/1",
            "pinterest.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Example product",
        )
        self.assertIn(
            (
                "https://5.imimg.com/data5/SELLER/Default/2024/5/1/A/B/C/"
                "medicine-box-1000x1000.jpg"
            ),
            {
                item.image_url
                for item in MODULE.high_resolution_candidate_variants(indiamart)
            },
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(pinterest)[0].image_url,
            "https://i.pinimg.com/originals/aa/bb/cc/image.jpg",
        )

    def test_exact_planar_cover_uses_transparent_inset_without_weakening_listing_identity(self):
        try:
            from PIL import Image
        except ImportError as error:
            self.skipTest(str(error))
        product = MODULE.Product(
            id="AMZ-B0FH1D67NR",
            name=(
                "The Myth of the Perfect Mom: From Postpartum Perfection "
                "to Everyday Joy"
            ),
            brand="The",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0FH1D67NR",
            asin="B0FH1D67NR",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/71FIg-A08BL.jpg",
            "https://www.amazon.com/dp/B0FH1D67NR",
            "amazon.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            72,
            product.name,
        )
        unrelated = MODULE.replace(
            exact,
            source_page_url="https://example.com/postpartum-books",
            title="Postpartum book collection",
        )
        cover = Image.new("RGB", (1000, 1500), (250, 210, 20))
        ocr = "The Myth of the Perfect Mom From Postpartum Perfection to Everyday Joy"
        self.assertTrue(
            MODULE.verified_planar_catalogue_artwork(product, exact, cover, ocr)
        )
        self.assertFalse(
            MODULE.verified_planar_catalogue_artwork(product, unrelated, cover, ocr)
        )
        cutout = MODULE.planar_catalogue_artwork_cutout(cover)
        self.assertGreaterEqual(MODULE.alpha_fraction(cutout), 0.03)
        self.assertEqual(cutout.getchannel("A").getbbox(), (50, 75, 950, 1425))

    def test_medicine_listing_fallback_keeps_exact_brand_and_identity_checks(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0923",
            name="TRANGEL ULTRA",
            brand="TRANGEL ULTRA",
            generic=(
                "DICLOFENAC DIETYLAMINE METHYL SALICYLATE "
                "MENTHOL CAPSICUM OLEORESIN"
            ),
            strength="10/80/60/0.15MG",
            form="GEL",
            pack_size="20mg",
            manufacturer="NEM LABORATORIES PVT. LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        exact_evidence = (
            "TRANGEL ULTRA by NEM Laboratories. Diclofenac, methyl "
            "salicylate, menthol and capsicum oleoresin gel."
        )
        unrelated_evidence = (
            "Diclofenac methyl salicylate menthol gel from another manufacturer."
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, exact_evidence))
        self.assertTrue(MODULE.medicine_identity_evidence(product, exact_evidence))
        self.assertFalse(MODULE.medicine_name_evidence(product, unrelated_evidence))
        provenance_candidate = MODULE.Candidate(
            product.id,
            "https://nemlabs.in/images/product/trangel-ultra.jpg",
            "https://nemlabs.in/creams-n-ointments/anti-inflammatory",
            "nemlabs.in",
            "manufacturer",
            MODULE.AUTOMATED_PROVENANCE,
            90,
            exact_evidence,
        )
        self.assertGreaterEqual(
            MODULE.candidate_identity_score(product, provenance_candidate),
            0.98,
        )
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("def bing_listing_page_candidates(", source)
        self.assertIn(
            "listing_candidates = bing_listing_page_candidates(product, web)",
            source,
        )
        self.assertIn(
            "yahoo_listing_page_candidates(product, web)",
            source,
        )
        fallback = source[
            source.index("if public_search:"):
            source.index("output.extend(google_cse_candidates")
        ]
        self.assertIn("medicine_name_evidence(", fallback)
        self.assertIn("medicine_identity_evidence(", fallback)
        self.assertIn("retry_count >= 1", fallback)
        self.assertIn(
            "include_duckduckgo=retry_count >= 1",
            fallback,
        )
        self.assertIn(
            "if retry_count < 1 and len(public_candidates) < 25:",
            fallback,
        )
        self.assertEqual(
            MODULE.yahoo_result_target_url(
                "https://r.search.yahoo.com/a/RU=https%3A%2F%2Fnemlabs.in%2F"
                "creams-n-ointments%2Fanti-inflammatory/RK=2/RS=x"
            ),
            "https://nemlabs.in/creams-n-ointments/anti-inflammatory",
        )
        excerpt = MODULE.medicine_page_identity_excerpt(
            product,
            """
            <html><body>
              <p>Unrelated introduction.</p>
              <section>
                TRANGEL ULTRA contains diclofenac, methyl salicylate,
                menthol and capsicum oleoresin. Manufactured by NEM Labs.
              </section>
            </body></html>
            """,
        )
        self.assertIn("TRANGEL ULTRA", excerpt)
        self.assertIn("NEM Labs", excerpt)

    def test_medicine_page_gallery_does_not_inherit_identity_for_unrelated_images(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0146",
            name="Tamsumac 0.4",
            brand="Tamsumac 0.4",
            generic="Tamsulosin Hydrochloride USP",
            strength="0.4 MG",
            form="Hard Gelatin Capsules",
            pack_size="",
            manufacturer="Macleods Pharmaceuticals Limited",
            source_url="",
            asin="",
            group="medicine",
        )
        unrelated = MODULE.Candidate(
            product.id,
            "https://pharmacy.example/assets/pregnancy-icon.jpg",
            "https://pharmacy.example/tamsumac-04",
            "pharmacy.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            75,
            "Tamsumac 0.4 Tamsulosin Macleods",
        )
        named_gallery_image = MODULE.replace(
            unrelated,
            image_url="https://pharmacy.example/images/tamsumac-04-side.jpg",
        )
        primary = MODULE.replace(unrelated, page_primary_image=True)
        self.assertFalse(MODULE.relevant_medicine_page_image(product, unrelated))
        self.assertTrue(
            MODULE.relevant_medicine_page_image(product, named_gallery_image)
        )
        self.assertTrue(MODULE.relevant_medicine_page_image(product, primary))

    def test_unbranded_regulatory_medicine_requires_composition_manufacturer_form_and_all_strengths(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1319",
            name=(
                "Amoxicillin Trihydrate USP Eq. to Anhydrous Amoxicillin "
                "500mg and diluted potassium clavulanate BP Eq. to "
                "Clavulanic acid 62.5mg"
            ),
            brand=(
                "Amoxicillin Trihydrate USP Eq. to Anhydrous Amoxicillin "
                "500mg and diluted potassium clavulanate BP Eq. to "
                "Clavulanic acid 62.5mg"
            ),
            generic=(
                "Amoxicillin Trihydrate USP Eq. to Anhydrous Amoxicillin "
                "500mg and diluted potassium clavulanate BP Eq. to "
                "Clavulanic acid 62.5mg"
            ),
            strength="500mg/62.5 mg",
            form="Film coated tablets",
            pack_size="2x8 tablets",
            manufacturer="BAROQUE PHARMACEUTICALS PVT.LTD.",
            source_url="",
            asin="",
            group="medicine",
        )
        exact = (
            "Baroque Pharmaceuticals Amoxicillin trihydrate and potassium "
            "clavulanate film coated tablets 500 mg 62.5 mg"
        )
        wrong_strength = exact.replace("62.5 mg", "125 mg")
        wrong_manufacturer = exact.replace("Baroque Pharmaceuticals", "Other Labs")
        wrong_combination = exact.replace("potassium clavulanate", "lactobacillus")
        abbreviated_page = (
            "Co-amoxiclav Tablets | Baroque Pharmaceuticals Pvt Ltd"
        )
        self.assertTrue(
            MODULE.unbranded_regulatory_listing_evidence(product, exact)
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, exact))
        self.assertFalse(
            MODULE.unbranded_regulatory_listing_evidence(product, wrong_strength)
        )
        self.assertFalse(
            MODULE.unbranded_regulatory_listing_evidence(product, wrong_manufacturer)
        )
        self.assertFalse(
            MODULE.unbranded_regulatory_listing_evidence(product, wrong_combination)
        )
        self.assertTrue(
            MODULE.unbranded_manufacturer_listing_seed(product, abbreviated_page)
        )
        self.assertFalse(
            MODULE.unbranded_manufacturer_listing_seed(
                product,
                "Co-amoxiclav Injection | Baroque Pharmaceuticals Pvt Ltd",
            )
        )
        self.assertFalse(
            MODULE.unbranded_manufacturer_listing_seed(
                product,
                "Co-amoxiclav Tablets | Other Laboratories",
            )
        )

    def test_consumer_retries_add_exact_listing_page_discovery(self):
        product = MODULE.Product(
            id="AMZ-B0FH7P9KS8",
            name=(
                "Zum by Indigo Wild Laundry and Home Cleaning Bundle "
                "Frankincense and Myrrh"
            ),
            brand="Zum by Indigo Wild",
            generic="",
            strength="",
            form="",
            pack_size="64 fl oz 2 Pack",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0FH7P9KS8",
            asin="B0FH7P9KS8",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            "",
            "https://retailer.example/products/B0FH7P9KS8",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            75,
            "Zum by Indigo Wild Frankincense and Myrrh bundle B0FH7P9KS8",
        )
        self.assertEqual(MODULE.candidate_identity_score(product, exact), 1.0)
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("def yahoo_consumer_listing_page_candidates(", source)
        consumer_fallback = source[
            source.index('elif product.group != "medicine" and retry_count >= 2'):
            source.index("output.extend(google_cse_candidates")
        ]
        self.assertIn("yahoo_consumer_listing_page_candidates", consumer_fallback)

    def test_failed_candidate_memory_is_versioned_by_retry_tier(self):
        checkpoint = {
            "status": "incomplete",
            "payload": {
                "retry_count": 1,
                "failure_policy_key": MODULE.failure_policy_key(0),
                "failed_candidate_urls": [
                    "https://example.com/low-resolution.jpg",
                ],
            },
        }
        self.assertEqual(
            MODULE.checkpoint_failed_candidate_urls(checkpoint, 1),
            {"https://example.com/low-resolution.jpg"},
        )
        self.assertEqual(
            MODULE.checkpoint_failed_candidate_urls(checkpoint, 2),
            set(),
        )

    def test_transient_failures_are_not_memorized(self):
        errors = [
            "https://example.com/low.jpg: Image resolution is too low: 300x300",
            "https://example.com/wait.jpg: timed out",
            "https://example.com/down.jpg: 503 Service Unavailable",
        ]
        self.assertEqual(
            MODULE.deterministic_failed_candidate_urls(errors),
            ["https://example.com/low.jpg"],
        )

    def test_derives_six_distinct_catalogue_views_from_one_validated_image(self):
        try:
            from PIL import Image, ImageDraw
            import imagehash
        except ImportError:
            self.skipTest("Image dependencies are not installed")
        import hashlib
        import io

        canvas = Image.new("RGBA", (1400, 1400), (255, 255, 255, 0))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle(
            (430, 180, 970, 1220),
            radius=45,
            fill=(30, 100, 190, 255),
        )
        draw.rectangle((500, 350, 900, 500), fill=(255, 255, 255, 255))
        buffer = io.BytesIO()
        canvas.save(buffer, format="WEBP", lossless=True)
        content = buffer.getvalue()
        candidate = MODULE.Candidate(
            "p",
            "https://manufacturer.example/p.jpg",
            "https://manufacturer.example/p",
            "manufacturer.example",
            "manufacturer",
            MODULE.AUTOMATED_PROVENANCE,
            100,
        )
        source = MODULE.ProcessedImage(
            candidate,
            content,
            1400,
            1400,
            95,
            hashlib.sha256(content).hexdigest(),
            str(imagehash.phash(canvas.convert("RGB"), hash_size=8)),
            True,
        )
        derived = MODULE.derive_catalogue_views([source], 6)
        selected = MODULE.select_distinct_images(derived, 6)
        self.assertEqual(len(selected), 6)
        self.assertTrue(
            all(len(image.candidate.rights_basis) <= 500 for image in selected)
        )
        repeated = MODULE.derive_catalogue_views(selected[:3], 6)
        self.assertTrue(
            all(len(image.candidate.rights_basis) <= 500 for image in repeated)
        )

    def test_reuses_one_rembg_session_per_worker(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Image dependencies are not installed")

        calls = {"new_session": 0, "remove": 0}
        session = object()

        def new_session(model):
            self.assertEqual(model, "u2net")
            calls["new_session"] += 1
            return session

        def remove(image, *, session):
            self.assertIs(session, globals_session)
            calls["remove"] += 1
            output = image.copy()
            output.putalpha(128)
            return output

        globals_session = session
        fake_rembg = types.SimpleNamespace(new_session=new_session, remove=remove)
        original_rembg = sys.modules.get("rembg")
        original_session = MODULE._REMBG_SESSION
        sys.modules["rembg"] = fake_rembg
        MODULE._REMBG_SESSION = None
        try:
            source = Image.new("RGB", (100, 100), (25, 50, 75))
            MODULE.remove_background(source, "auto")
            MODULE.remove_background(source, "auto")
        finally:
            MODULE._REMBG_SESSION = original_session
            if original_rembg is None:
                sys.modules.pop("rembg", None)
            else:
                sys.modules["rembg"] = original_rembg

        self.assertEqual(calls, {"new_session": 1, "remove": 2})

    def test_rembg_engine_forces_neural_removal_when_border_is_removable(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Image dependencies are not installed")

        calls = {"remove": 0}

        def remove(image, *, session):
            calls["remove"] += 1
            output = image.copy()
            output.putalpha(128)
            return output

        fake_rembg = types.SimpleNamespace(remove=remove)
        original_rembg = sys.modules.get("rembg")
        sys.modules["rembg"] = fake_rembg
        try:
            source = Image.new("RGB", (100, 100), "white")
            source.paste((25, 50, 75), (25, 25, 75, 75))
            with mock.patch.object(MODULE, "rembg_session", return_value=object()):
                result = MODULE.remove_background(source, "rembg")
        finally:
            if original_rembg is None:
                sys.modules.pop("rembg", None)
            else:
                sys.modules["rembg"] = original_rembg

        self.assertEqual(calls["remove"], 1)
        self.assertGreaterEqual(MODULE.alpha_fraction(result), 0.99)

    def test_published_checkpoint_candidates_can_be_force_reprocessed(self):
        product = MODULE.Product(
            id="p",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="",
            asin="",
            group="consumer",
        )
        checkpoint = {
            "status": "published",
            "payload": {
                "images": [
                    {
                        "image_url": "https://retailer.example/example.webp",
                        "source_page_url": "https://retailer.example/example",
                        "source_domain": "retailer.example",
                        "source_kind": "specialist_retailer",
                        "rights_basis": MODULE.AUTOMATED_PROVENANCE,
                        "priority": 65,
                        "rights_verified": False,
                    }
                ]
            },
        }
        self.assertEqual(len(MODULE.checkpoint_candidates(product, checkpoint)), 1)

        checkpoint["status"] = "incomplete"
        self.assertEqual(len(MODULE.checkpoint_candidates(product, checkpoint)), 1)

    def test_publisher_accepts_protected_automated_contract(self):
        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "contract_version": MODULE.EXPECTED_BACKEND_CONTRACT_VERSION,
                    "product_images": {
                        "publication_mode": "automated_provenance",
                        "rights_verified_required": False,
                        "minimum_images_per_product": 3,
                        "maximum_images_per_product": 6,
                        "target_image_count": 23_977,
                        "public_policy_requires_background_removed": True,
                        "publication_guard_trigger_exists": True,
                        "ddl_guard_event_trigger_exists": True,
                    },
                }

        class Client:
            def __init__(self):
                self.calls = []

            def post(self, url, **kwargs):
                self.calls.append((url, kwargs))
                return Response()

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.base_url = "https://project.supabase.co"
        publisher.headers = {"apikey": "redacted", "Authorization": "redacted"}
        publisher.client = Client()

        publisher.assert_publication_backend_safe()
        self.assertEqual(len(publisher.client.calls), 1)
        self.assertTrue(
            publisher.client.calls[0][0].endswith(
                "/rest/v1/rpc/dawanear_backend_contract"
            )
        )

    def test_published_gallery_requires_live_image_urls(self):
        class Response:
            def __init__(self, status_code, payload=None, content_type=""):
                self.status_code = status_code
                self._payload = payload
                self.headers = {"content-type": content_type}

            def json(self):
                return self._payload

        rows = [
            {
                "position": position,
                "public_url": f"https://project.supabase.co/image-{position}.webp",
                "approved": True,
                "background_removed": True,
            }
            for position in range(1, 6)
        ]

        class Client:
            broken_position = 0

            def get(self, url, **kwargs):
                return Response(200, rows)

            def head(self, url):
                if self.broken_position and url.endswith(
                    f"-{self.broken_position}.webp"
                ):
                    return Response(400, content_type="application/json")
                return Response(200, content_type="image/webp")

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.base_url = "https://project.supabase.co"
        publisher.headers = {"apikey": "redacted", "Authorization": "redacted"}
        publisher.client = Client()

        self.assertTrue(publisher.gallery_is_live("p", 5))
        publisher.client.broken_position = 3
        self.assertFalse(publisher.gallery_is_live("p", 5))

    def test_bulk_complete_gallery_detection_uses_exact_allocated_positions(self):
        class Response:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return [
                    *[
                        {
                            "product_id": "complete",
                            "position": position,
                            "approved": True,
                            "background_removed": True,
                        }
                        for position in range(1, 6)
                    ],
                    {
                        "product_id": "incomplete",
                        "position": 1,
                        "approved": True,
                        "background_removed": True,
                    },
                    {
                        "product_id": "unapproved",
                        "position": 1,
                        "approved": False,
                        "background_removed": True,
                    },
                ]

        class Client:
            @staticmethod
            def get(url, **kwargs):
                return Response()

        publisher = object.__new__(MODULE.SupabasePublisher)
        publisher.base_url = "https://project.supabase.co"
        publisher.headers = {"apikey": "redacted", "Authorization": "redacted"}
        publisher.client = Client()
        self.assertEqual(
            publisher.complete_gallery_ids(
                {"complete": 5, "incomplete": 5, "unapproved": 1}
            ),
            {"complete"},
        )

    def test_staged_publication_target_prioritizes_three_image_coverage(self):
        self.assertEqual(MODULE.staged_publication_target(6, 0), 3)
        self.assertEqual(MODULE.staged_publication_target(5, 2), 3)
        self.assertEqual(MODULE.staged_publication_target(5, 3), 5)
        self.assertEqual(MODULE.staged_publication_target(6, 5), 6)

    def test_incomplete_retry_cooldown_is_bounded_and_eventually_expires(self):
        now = MODULE.datetime(2026, 7, 16, 21, 30, tzinfo=MODULE.timezone.utc)
        checkpoint = {
            "status": "incomplete",
            "payload": {"retry_count": 8},
            "updated_at": "2026-07-16T21:29:30+00:00",
        }
        self.assertEqual(MODULE.retry_cooldown_seconds(8), 3600)
        self.assertTrue(MODULE.checkpoint_retry_is_deferred(checkpoint, now))
        checkpoint["updated_at"] = "2026-07-16T20:00:00+00:00"
        self.assertFalse(MODULE.checkpoint_retry_is_deferred(checkpoint, now))

    def test_broken_url_verification_report_forces_gallery_repair(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "verification.json"
            path.write_text(
                json.dumps(
                    {
                        "broken_product_ids": [
                            "AMZ-BROKEN",
                            "",
                            "AMZ-BROKEN",
                        ]
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(
                MODULE.broken_gallery_ids_from_report(path),
                {"AMZ-BROKEN"},
            )

    def test_checkpoint_candidates_upgrade_legacy_http_provenance(self):
        product = MODULE.Product(
            id="p",
            name="Persil Discs",
            brand="Persil",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="",
            asin="",
            group="consumer",
        )
        checkpoint = {
            "status": "incomplete",
            "payload": {
                "images": [
                    {
                        "image_url": "http://shop.example/persil.webp",
                        "source_page_url": "http://shop.example/persil",
                        "source_domain": "shop.example",
                        "source_kind": "specialist_retailer",
                        "rights_basis": MODULE.AUTOMATED_PROVENANCE,
                        "priority": 65,
                    }
                ]
            },
        }
        candidate = MODULE.checkpoint_candidates(product, checkpoint)[0]
        self.assertEqual(candidate.image_url, "https://shop.example/persil.webp")
        self.assertEqual(candidate.source_page_url, "https://shop.example/persil")

    def test_rejects_private_and_non_http_urls(self):
        with self.assertRaises(MODULE.PipelineError):
            MODULE.ensure_public_url("file:///etc/passwd")
        with self.assertRaises(MODULE.PipelineError):
            MODULE.ensure_public_url("http://127.0.0.1/image.png")

    def test_loads_newline_product_scope_without_shell_splitting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "product-ids.txt"
            path.write_text(
                "# focused catalogue batch\nproduct-b\n\nproduct-c\n",
                encoding="utf-8",
            )
            selected = MODULE.load_selected_product_ids(
                ["product-a", " product-b "],
                [path],
            )
        self.assertEqual(selected, {"product-a", "product-b", "product-c"})

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
        self.assertTrue(all(candidate.page_primary_image for candidate in candidates))

    def test_extracts_extensionless_odoo_product_image_endpoint(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0099",
            name="Aarciflox-500",
            brand="Aarciflox-500",
            generic="Ciprofloxacin USP",
            strength="500 mg",
            form="Film-coated tablets",
            pack_size="",
            manufacturer="AARTI DRUGS LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        html = """
        <html><head>
          <title>Ciprofloxacin 500mg Tablets (Aarciflox-500)</title>
          <meta property="og:image"
                content="/web/image/product.template/19658/image">
        </head><body></body></html>
        """
        candidates = MODULE.extract_page_candidates(
            product,
            "https://hpa.chebupharma.com/shop/product/"
            "ciprofloxacin-500mg-tablets-aarciflox-500-19658",
            html,
            {
                "kind": "specialist_retailer",
                "rights_basis": MODULE.AUTOMATED_PROVENANCE,
                "priority": 102,
            },
        )
        self.assertEqual(len(candidates), 1)
        self.assertEqual(
            candidates[0].image_url,
            "https://hpa.chebupharma.com/web/image/"
            "product.template/19658/image",
        )
        self.assertTrue(candidates[0].page_primary_image)

    def test_extracts_only_exact_nextjs_pack_variant_image(self):
        product = MODULE.Product(
            id="AMZ-B0CTB79SN1",
            name="Always Discreet Heavy Long Pads, 64ct",
            brand="Always",
            generic="",
            strength="",
            form="Pads",
            pack_size="64 count",
            manufacturer="",
            source_url="",
            asin="B0CTB79SN1",
            group="consumer",
        )
        html = """
        <html><head><title>Always Discreet Heavy Long Pads - 5 Drops</title>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"quantityPacks":[
              {"title":"20 count","featuredImage":{
                "url":"//images.example/always-heavy-long-20.png"}},
              {"title":"64 count","featuredImage":{
                "url":"//images.example/always-heavy-long-64.png"}},
              {"title":"156 count","featuredImage":{
                "url":"//images.example/always-heavy-long-156.png"}}
            ],"recommendedProducts":[
              {"title":"Other Product 64 count","image":{
                "url":"//images.example/unrelated-64.png"}}
            ]}}}
          </script>
        </head><body></body></html>
        """
        candidates = MODULE.extract_page_candidates(
            product,
            "https://always.example/products/heavy-long-pads",
            html,
            {
                "kind": "manufacturer",
                "rights_basis": MODULE.AUTOMATED_PROVENANCE,
                "priority": 100,
            },
        )
        self.assertEqual(
            [candidate.image_url for candidate in candidates],
            ["https://images.example/always-heavy-long-64.png"],
        )
        self.assertTrue(candidates[0].page_primary_image)
        self.assertEqual(candidates[0].priority, 124)

    def test_page_extraction_rejects_decorative_country_and_logo_assets(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0933",
            name="ULTRA-LEVULE 250 MG SACHETS",
            brand="ULTRA-LEVULE 250 MG SACHETS",
            generic="SACCHAROMYCES BOULARDII CNCM I-745",
            strength="250MG",
            form="Powder for oral suspension",
            pack_size="10 sachets",
            manufacturer="BIOCODEX",
            source_url="",
            asin="",
            group="medicine",
        )
        html = """
        <html><head><title>Ultra-Levure - Biocodex</title></head><body>
          <img src="/images/countries/US.png">
          <img src="/assets/site-logo.png">
          <img src="/products/ultra-levure-250mg.png">
        </body></html>
        """
        candidates = MODULE.extract_page_candidates(
            product,
            "https://biocodex.example/products/ultra-levure",
            html,
            {
                "kind": "manufacturer",
                "rights_basis": MODULE.AUTOMATED_PROVENANCE,
                "priority": 100,
            },
        )
        self.assertEqual(
            [candidate.image_url for candidate in candidates],
            ["https://biocodex.example/products/ultra-levure-250mg.png"],
        )
        self.assertTrue(
            MODULE.decorative_page_image_url(
                "https://m.media-amazon.com/images/G/01/share-icons/amazon.png"
            )
        )

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

    def test_low_entropy_exact_listing_requires_a_visible_object_footprint(self):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.skipTest("Pillow is not installed")
        blank = Image.new("RGB", (1024, 1024), "white")
        tiny_placeholder = blank.copy()
        ImageDraw.Draw(tiny_placeholder).ellipse(
            (505, 505, 518, 518),
            fill=(120, 150, 120),
        )
        pale_product = blank.copy()
        draw = ImageDraw.Draw(pale_product)
        draw.rounded_rectangle(
            (455, 80, 570, 950),
            radius=42,
            fill=(230, 239, 220),
            outline=(145, 170, 130),
            width=10,
        )
        draw.ellipse((430, 730, 595, 980), fill=(238, 238, 236), outline=(150, 150, 145), width=8)
        self.assertFalse(
            MODULE.low_entropy_exact_listing_has_visible_object(blank)
        )
        self.assertFalse(
            MODULE.low_entropy_exact_listing_has_visible_object(tiny_placeholder)
        )
        self.assertTrue(
            MODULE.low_entropy_exact_listing_has_visible_object(pale_product)
        )

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
        ezthings = MODULE.replace(product, brand="eZthings")
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://www.e-zthings.com/products/forehead-thermometer",
                ezthings,
            ),
            ("manufacturer", 100),
        )
        medicine = MODULE.replace(
            product,
            name="ULTRA-LEVULE 250 MG SACHETS",
            brand="ULTRA-LEVULE 250 MG SACHETS",
            manufacturer="BIOCODEX",
            asin="",
            group="medicine",
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://www.biocodex.ma/fr/nos-produits/ultra-levure/",
                medicine,
            ),
            ("manufacturer", 100),
        )
        article_brand = MODULE.replace(
            product,
            name="The Laundress Signature Isle Detergent",
            brand="The",
        )
        self.assertEqual(
            MODULE.effective_consumer_brand_tokens(article_brand),
            {"laundress"},
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://www.thelaundress.com/products/signature-detergent",
                article_brand,
            ),
            ("manufacturer", 100),
        )
        doctor_brand = MODULE.replace(
            product,
            name="Dr. Bronner's Pure-Castile Bar Soap",
            brand="Dr.",
        )
        initials_brand = MODULE.replace(
            product,
            name="J.L. Childress Portable Changing Pad",
            brand="J.L.",
        )
        punctuation_brand = MODULE.replace(
            product,
            name="e.l.f. Power Grip Primer",
            brand="e.l.f.",
        )
        self.assertEqual(
            MODULE.effective_consumer_brand_tokens(doctor_brand),
            {"bronner"},
        )
        self.assertEqual(
            MODULE.effective_consumer_brand_tokens(initials_brand),
            {"childress"},
        )
        self.assertEqual(
            MODULE.effective_consumer_brand_tokens(punctuation_brand),
            {"elf"},
        )
        self.assertEqual(
            MODULE.inferred_source_kind(
                "https://www.drbronner.com/products/pure-castile-bar-soap",
                doctor_brand,
            ),
            ("manufacturer", 100),
        )

    def test_expands_marketplace_thumbnails_to_original_images(self):
        amazon = MODULE.Candidate(
            "p",
            "https://m.media-amazon.com/images/I/example._AC_SL500_.jpg",
            "https://www.amazon.com/dp/example",
            "amazon.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            72,
        )
        walmart = MODULE.replace(
            amazon,
            image_url=(
                "https://i5.walmartimages.com/seo/example.jpeg"
                "?odnHeight=580&odnWidth=580&odnBg=FFFFFF"
            ),
            source_domain="walmart.com",
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(amazon)[0].image_url,
            "https://m.media-amazon.com/images/I/example._UL1500_.jpg",
        )
        amazon_default = MODULE.replace(
            amazon,
            image_url="https://m.media-amazon.com/images/I/41wfth6jvFL.jpg",
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(amazon_default)[0].image_url,
            "https://m.media-amazon.com/images/I/41wfth6jvFL._UL1500_.jpg",
        )
        ranked_amazon = MODULE.ranked_candidate_variants(
            MODULE.Product(
                id="p",
                name="Example",
                brand="Example",
                generic="",
                strength="",
                form="",
                pack_size="",
                manufacturer="",
                source_url="https://www.amazon.com/dp/example",
                asin="example",
                group="consumer",
            ),
            [
                amazon_default,
                MODULE.replace(
                    amazon_default,
                    image_url=(
                        "https://m.media-amazon.com/images/I/"
                        "41wfth6jvFL._AC_.jpg"
                    ),
                ),
            ],
        )
        self.assertEqual(
            [
                candidate.image_url
                for candidate in ranked_amazon
                if "/images/I/" in candidate.image_url
            ],
            ["https://m.media-amazon.com/images/I/41wfth6jvFL._UL1500_.jpg"],
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(walmart)[0].image_url,
            "https://i5.walmartimages.com/seo/example.jpeg",
        )

        legacy_amazon = MODULE.replace(
            amazon,
            image_url=(
                "https://images-na.ssl-images-amazon.com/images/I/"
                "example._AC_SL1000_.jpg"
            ),
        )
        ebay = MODULE.replace(
            amazon,
            image_url="https://i.ebayimg.com/images/g/example/s-l400.jpg",
            source_domain="ebay.com",
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(legacy_amazon)[0].image_url,
            (
                "https://images-na.ssl-images-amazon.com/images/I/"
                "example._UL1500_.jpg"
            ),
        )
        aplus_amazon = MODULE.replace(
            amazon,
            image_url=(
                "https://m.media-amazon.com/images/S/aplus-media-library-service-media/"
                "example.__CR0,0,362,453_PT0_SX362_V1___.jpg"
            ),
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(aplus_amazon)[0].image_url,
            (
                "https://m.media-amazon.com/images/S/aplus-media-library-service-media/"
                "example.jpg"
            ),
        )
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(ebay)[0].image_url,
            "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
        )

    def test_resolves_exact_amazon_asin_to_high_resolution_catalogue_image(self):
        product = MODULE.Product(
            id="AMZ-B07V3TR2ST",
            name="Example Product 12 Count",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="12 count",
            manufacturer="Example",
            source_url="https://www.amazon.com/dp/B07V3TR2ST",
            asin="B07V3TR2ST",
            group="consumer",
        )
        candidates = MODULE.amazon_asin_candidates(product)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(
            candidates[0].image_url,
            (
                "https://images-na.ssl-images-amazon.com/images/P/"
                "B07V3TR2ST.01._UL1500_.jpg"
            ),
        )
        self.assertEqual(candidates[0].source_kind, "marketplace_api")
        self.assertEqual(MODULE.candidate_identity_score(product, candidates[0]), 1.0)
        self.assertEqual(
            MODULE.high_resolution_candidate_variants(candidates[0])[0].image_url,
            candidates[0].image_url,
        )

    def test_rejects_invalid_amazon_asin_for_direct_resolution(self):
        product = MODULE.Product(
            id="AMZ-invalid",
            name="Example Product",
            brand="Example",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Example",
            source_url="https://www.amazon.com/dp/invalid",
            asin="invalid",
            group="consumer",
        )
        self.assertEqual(MODULE.amazon_asin_candidates(product), [])

    def test_expands_shopify_and_manufacturer_thumbnail_urls(self):
        base = MODULE.Candidate(
            "p",
            "https://e-zthings.com/cdn/shop/products/item_700x700.jpg?v=1",
            "https://e-zthings.com/products/item",
            "e-zthings.com",
            "manufacturer",
            MODULE.AUTOMATED_PROVENANCE,
            100,
        )
        path_urls = {
            item.image_url
            for item in MODULE.high_resolution_candidate_variants(base)
        }
        self.assertIn(
            "https://e-zthings.com/cdn/shop/products/item.jpg?v=1",
            path_urls,
        )

        query_candidate = MODULE.replace(
            base,
            image_url=(
                "https://manufacturer.example/cdn/shop/files/item.jpg"
                "?v=2&width=720"
            ),
        )
        query_urls = {
            item.image_url
            for item in MODULE.high_resolution_candidate_variants(query_candidate)
        }
        self.assertIn(
            "https://manufacturer.example/cdn/shop/files/item.jpg?v=2&width=1600",
            query_urls,
        )

        next_image = MODULE.replace(
            base,
            image_url=(
                "https://retailer.example/_next/image?"
                "url=https%3A%2F%2Fassets.example%2Fproducts%2Fitem.png"
                "&w=640&q=75"
            ),
        )
        next_image_urls = {
            item.image_url
            for item in MODULE.high_resolution_candidate_variants(next_image)
        }
        self.assertIn(
            "https://assets.example/products/item.png",
            next_image_urls,
        )

        demandware = MODULE.replace(
            base,
            image_url=(
                "https://retailer.example/dw/image/v2/PRD/catalog/item.jpg"
                "?sw=600&sh=720&sm=fit&sfrm=jpg"
            ),
        )
        demandware_urls = {
            item.image_url
            for item in MODULE.high_resolution_candidate_variants(demandware)
        }
        self.assertIn(
            "https://retailer.example/dw/image/v2/PRD/catalog/item.jpg"
            "?sw=2400&sh=2400&sm=fit&sfrm=jpg",
            demandware_urls,
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
        self.assertEqual(MODULE.measurements("7.15 Kg"), [("mass_mg", 7_150_000.0)])
        self.assertEqual(MODULE.measurements("E8L8R"), [])
        self.assertTrue(
            MODULE.measurements_conflict(
                MODULE.measurements("15 g tube"),
                MODULE.measurements("15 g listing 20 g product image"),
            )
        )

    def test_measurement_conflict_ignores_ocr_dropped_milli_prefix(self):
        expected = MODULE.measurements("15 ml")
        observed = MODULE.measurements("15l Mycodeal 15ml")
        self.assertTrue(MODULE.measurements_match(expected, observed))
        self.assertFalse(MODULE.measurements_conflict(expected, observed))
        self.assertTrue(
            MODULE.measurements_conflict(
                expected,
                MODULE.measurements("15ml listing 30ml product image"),
            )
        )

        bundle = MODULE.Product(
            id="AMZ-B0FH7P9KS8",
            name="Zum Laundry Soap 64 fl oz, 2 Pack + Cleaner 16 fl oz Bundle",
            brand="Zum",
            generic="",
            strength="",
            form="",
            pack_size="64 fl oz; 16 fl oz",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0FH7P9KS8",
            asin="B0FH7P9KS8",
            group="consumer",
        )
        bundle_expected = MODULE.expected_product_measurements(bundle)
        bundle_observed = MODULE.measurements(
            "Zum Laundry Soap 64 fl oz 2 Pack Cleaner 16 fl oz"
        )
        self.assertIn(("count", 2.0), bundle_expected)
        self.assertFalse(
            MODULE.measurements_conflict(bundle_expected, bundle_observed)
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

    def test_multilingual_consumer_pack_uses_variant_and_count_corroboration(self):
        product = MODULE.Product(
            id="AMZ-B0H2B59LHM",
            name=(
                "Persil Professional Line Color Laundry Detergent Powder "
                "(130 Loads | 15.76 lbs | 7.15 Kg)"
            ),
            brand="Persil",
            generic="",
            strength="",
            form="",
            pack_size="7.15 Kg",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0H2B59LHM",
            asin="B0H2B59LHM",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/exact.jpg",
            "https://retailer.example/persil-professional-color-130-loads",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            70,
            "Persil Professional Color Laundry Powder 130 Loads",
        )
        exact_ocr = (
            "Persil PROFESSIONAL COLOR PULVER TIEFENREIN "
            "Faserpflege 130 Colorwaschmittel"
        )
        wrong_variant = MODULE.Candidate(
            product.id,
            "https://retailer.example/universal.jpg",
            "https://retailer.example/persil-professional-universal-130",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            70,
            "Persil Professional Universal Gel 130 Loads",
        )
        self.assertTrue(
            MODULE.consumer_visual_identity_evidence(product, exact, exact_ocr)
        )
        self.assertFalse(
            MODULE.consumer_visual_identity_evidence(
                product,
                wrong_variant,
                "Persil PROFESSIONAL UNIVERSAL GEL 130",
            )
        )
        self.assertFalse(
            MODULE.consumer_visual_identity_evidence(
                product,
                exact,
                "Persil PROFESSIONAL UNIVERSAL GEL 130",
            )
        )

    def test_horizontal_band_heuristic_preserves_real_multi_item_bundle(self):
        row_widths = [100] * 20 + [800]
        self.assertTrue(
            MODULE.row_widths_indicate_horizontal_band(row_widths, 1000, False)
        )
        self.assertFalse(
            MODULE.row_widths_indicate_horizontal_band(row_widths, 1000, True)
        )

    def test_exact_branded_marketplace_bundle_can_span_the_frame(self):
        product = MODULE.Product(
            id="AMZ-B091BC1LF8",
            name=(
                "Innovo Medical iP900BP-B Bluetooth Finger Pulse Oximeter "
                "with Digital Ear Thermometer Bundle"
            ),
            brand="Innovo",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="Innovo Medical",
            source_url="https://www.amazon.com/dp/B091BC1LF8",
            asin="B091BC1LF8",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/61UFna7qGrL.jpg",
            "https://www.amazon.com/dp/B091BC1LF8",
            "www.amazon.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            80,
            title=product.name,
        )
        self.assertTrue(
            MODULE.marketplace_bundle_cutout_is_verified(
                product,
                candidate,
                "INNOVO SpO2 PRbpm INNOVO",
                [1_659_224, 579_709],
            )
        )
        self.assertTrue(
            MODULE.marketplace_bundle_cutout_is_verified(
                product,
                candidate,
                "",
                [1_659_224, 579_709],
            )
        )
        repeated_label_text = (
            "INNOVO " + "device monitor natural essential product " * 8
        )
        self.assertGreater(len(repeated_label_text.split()), 35)
        self.assertTrue(
            MODULE.marketplace_bundle_cutout_is_verified(
                product,
                candidate,
                repeated_label_text,
                [1_659_224, 579_709],
            )
        )
        self.assertFalse(
            MODULE.marketplace_bundle_cutout_is_verified(
                product,
                candidate,
                "SpO2 PRbpm thermometer",
                [1_659_224, 579_709],
            )
        )

    def test_exact_branded_bulk_count_composition_can_span_the_frame(self):
        product = MODULE.Product(
            id="AMZ-B0DCHPP188",
            name=(
                "The Honest Company Hypoallergenic Multi-Use Baby Wipes "
                "for Sensitive Skin, Sunburst, 864 Count"
            ),
            brand="The",
            generic="",
            strength="",
            form="",
            pack_size="864 Count",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0DCHPP188",
            asin="B0DCHPP188",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/81KBbxG6ccL.jpg",
            product.source_url,
            "www.amazon.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            80,
            title=product.name,
        )
        self.assertTrue(
            MODULE.marketplace_bulk_count_cutout_is_verified(
                product,
                candidate,
                "HONEST sensitive VALUE SIZE 864 WIPES 72 WIPES",
                [4_627_555],
            )
        )
        self.assertFalse(
            MODULE.marketplace_bulk_count_cutout_is_verified(
                product,
                candidate,
                "HONEST sensitive 72 WIPES",
                [4_627_555],
            )
        )
        self.assertFalse(
            MODULE.marketplace_bulk_count_cutout_is_verified(
                product,
                candidate,
                "Sensitive VALUE SIZE 864 WIPES",
                [4_627_555],
            )
        )

    def test_strongly_identified_tall_bottle_can_fill_the_frame(self):
        product = MODULE.Product(
            id="AMZ-B0FTWW1VT2",
            name="Nordic Sleep Probiotic Colour Laundry Liquid 500 ml",
            brand="Nordic",
            generic="",
            strength="",
            form="",
            pack_size="500 ml",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0FTWW1VT2",
            asin="B0FTWW1VT2",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://www.magasin.dk/dw/image/v2/PRD/nordic.jpg?sw=2400&sh=2400",
            "https://www.magasin.dk/nordic-sleep-probiotic-colour-laundry-liquid-500-ml",
            "www.magasin.dk",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            title="Nordic Sleep Probiotic Colour Laundry Liquid - 500 ml",
        )
        label = (
            "NORDIC SLEEP BY FOSSFLAKES COLOUR LAUNDRY LIQUID "
            "Extra protection of colours CONTAINS PROBIOTICS"
        )
        self.assertTrue(
            MODULE.tall_consumer_catalogue_cutout_is_verified(
                product,
                candidate,
                label,
                [1_611_563],
                765,
                2400,
            )
        )
        self.assertFalse(
            MODULE.tall_consumer_catalogue_cutout_is_verified(
                product,
                candidate,
                "Generic laundry liquid 500 ml",
                [1_611_563],
                765,
                2400,
            )
        )

    def test_exact_asin_consumer_main_image_skips_ocr(self):
        product = MODULE.Product(
            id="AMZ-B00BH0OSWI",
            name="Aveeno Baby Daily Care Gift Set, 2 Count",
            brand="Aveeno",
            generic="",
            strength="",
            form="",
            pack_size="2 Count",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B00BH0OSWI",
            asin="B00BH0OSWI",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://m.media-amazon.com/images/I/71q+qzd71rL.jpg",
            "https://www.amazon.com/dp/B00BH0OSWI",
            "amazon.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            72,
            "Aveeno Baby Daily Care Gift Set with Oat Extract, 2 Count",
        )
        self.assertFalse(MODULE.requires_image_ocr(product, candidate, 1500, 1500))

    def test_ambiguous_or_marketing_consumer_image_keeps_ocr(self):
        product = MODULE.Product(
            id="p",
            name="Aveeno Baby Daily Care Gift Set, 2 Count",
            brand="Aveeno",
            generic="",
            strength="",
            form="",
            pack_size="2 Count",
            manufacturer="",
            source_url="",
            asin="B00BH0OSWI",
            group="consumer",
        )
        ambiguous = MODULE.Candidate(
            product.id,
            "https://retailer.example/images/baby-care.jpg",
            "https://retailer.example/baby-care",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Aveeno Baby Care",
        )
        marketing = MODULE.replace(
            ambiguous,
            image_url=(
                "https://m.media-amazon.com/images/S/"
                "aplus-media-library-service-media/example.png"
            ),
            source_page_url="https://www.amazon.com/dp/B00BH0OSWI",
            title="Aveeno Baby Daily Care Gift Set, 2 Count",
        )
        self.assertTrue(MODULE.requires_image_ocr(product, ambiguous, 1500, 1500))
        self.assertTrue(MODULE.requires_image_ocr(product, marketing, 1500, 1500))
        self.assertTrue(MODULE.requires_image_ocr(product, ambiguous, 1600, 800))

    def test_retries_relax_resolution_only_for_exact_identity_sources(self):
        medicine = MODULE.Product(
            id="rwanda-fda-hm-0913",
            name="TACROVATE FORTE OINTMENT",
            brand="TACROVATE FORTE OINTMENT",
            generic="Tacrolimus Ointment",
            strength="0.1% w/w",
            form="Ointment",
            pack_size="10 grams",
            manufacturer="AUROCHEM LABORATORIES",
            source_url="",
            asin="",
            group="medicine",
        )
        medicine_candidate = MODULE.Candidate(
            medicine.id,
            "https://pharmacy.example/tacrovate-forte.jpg",
            "https://pharmacy.example/tacrovate-forte-ointment",
            "pharmacy.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Tacrovate Forte Tacrolimus Ointment 0.1% 10 grams",
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(
                medicine, medicine_candidate, 600, 900, 0
            ),
            (500, 500, 450),
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(
                medicine, medicine_candidate, 600, 900, 2
            ),
            (350, 400, 350),
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(
                medicine,
                MODULE.replace(medicine_candidate, page_primary_image=True),
                600,
                900,
                4,
            ),
            (300, 350, 250),
        )

        consumer = MODULE.replace(
            medicine,
            id="AMZ-B00BH0OSWI",
            name="Aveeno Baby Daily Care Gift Set",
            brand="Aveeno",
            generic="",
            strength="",
            pack_size="2 Count",
            manufacturer="",
            asin="B00BH0OSWI",
            group="consumer",
        )
        exact_asin = MODULE.replace(
            medicine_candidate,
            product_id=consumer.id,
            image_url="https://m.media-amazon.com/images/I/example.jpg",
            source_page_url="https://www.amazon.com/dp/B00BH0OSWI",
            source_domain="amazon.com",
            source_kind="marketplace_api",
        )
        ambiguous = MODULE.replace(
            exact_asin,
            source_page_url="https://retailer.example/aveeno-gift-set",
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(
                consumer, exact_asin, 600, 900, 2
            ),
            (500, 600, 550),
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(
                consumer, ambiguous, 600, 900, 4
            ),
            (600, 900, 700),
        )

    def test_textless_durable_item_requires_strong_exact_listing_evidence(self):
        product = MODULE.Product(
            id="AMZ-B07TZTFN9R",
            name=(
                "J.L. Childress Full Body Portable Changing Pad for Babies - "
                "Diaper Changing Mat for Travel, Wipeable Water-Resistant, "
                "Foldable Extra Large - Black Stripe"
            ),
            brand="J.L.",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B07TZTFN9R",
            asin="B07TZTFN9R",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            (
                "https://i5.walmartimages.com/seo/"
                "J-L-Childress-Full-Body-Portable-and-Padded-Diaper-"
                "Changing-Pad-Black-Stripe.jpeg"
            ),
            "https://www.walmart.com/browse/baby/portable-changing-pads",
            "walmart.com",
            "marketplace_api",
            MODULE.AUTOMATED_PROVENANCE,
            78,
            (
                "J.L. Childress Full Body Portable Changing Pad for Babies "
                "Wipeable Water Resistant Foldable Extra Large Black Stripe"
            ),
        )
        wrong_variant = MODULE.replace(
            exact,
            title="J.L. Childress Portable Changing Pad Grey Chevron",
            image_url="https://i5.walmartimages.com/grey-chevron.jpeg",
        )
        self.assertTrue(
            MODULE.strong_textless_consumer_listing_evidence(product, exact)
        )
        self.assertFalse(
            MODULE.strong_textless_consumer_listing_evidence(product, wrong_variant)
        )
        self.assertEqual(
            MODULE.source_resolution_thresholds(product, exact, 600, 900, 1),
            (600, 800, 550),
        )

    def test_textless_listing_must_confirm_declared_multipack_count(self):
        product = MODULE.Product(
            id="AMZ-B09NGJ3JBF",
            name=(
                "4-Pack Hospital Medical Grade Non Contact Digital Infrared "
                "Forehead Thermometer for Babies Kids and Adults"
            ),
            brand="Hospital",
            generic="",
            strength="",
            form="",
            pack_size="4 Pack",
            manufacturer="",
            source_url="",
            asin="B09NGJ3JBF",
            group="consumer",
        )
        single = MODULE.Candidate(
            product.id,
            "https://images.example/hospital-thermometer.jpg",
            "https://retailer.example/hospital-medical-thermometer",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            73,
            (
                "Hospital Medical Grade Non Contact Digital Infrared Forehead "
                "Thermometer for Babies Kids and Adults"
            ),
        )
        self.assertFalse(
            MODULE.strong_textless_consumer_listing_evidence(product, single)
        )

    def test_textless_exact_listing_allows_a_truncated_search_title(self):
        product = MODULE.Product(
            id="AMZ-B005Y7CCPU",
            name=(
                "J.L. Childress Pockets 'N Pad Car Diaper Changing Station "
                "for Baby - Portable Diaper Changing Pad for Travel, "
                "Wipeable & Water-Resistant - Black"
            ),
            brand="J.L.",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B005Y7CCPU",
            asin="B005Y7CCPU",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            (
                "https://www.luggageonline.com/cdn/shop/files/"
                "1109BLK_MAIN.jpg?height=1600&width=1600"
            ),
            (
                "https://www.luggageonline.com/products/"
                "j-l-childress-pockets-n-pad-car-diaper-changing-station-for-baby"
            ),
            "luggageonline.com",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "J.L. Childress Pockets 'N Pad Car Diaper Changing Station for Baby ...",
        )
        wrong_variant = MODULE.replace(
            exact,
            title="J.L. Childress Portable Changing Pad Grey Chevron",
            image_url="https://retailer.example/grey-chevron.jpeg",
        )
        self.assertLess(MODULE.candidate_identity_score(product, exact), 0.68)
        self.assertGreaterEqual(
            MODULE.critical_identity_coverage(
                product,
                " ".join(
                    [exact.title, exact.source_page_url, exact.image_url]
                ),
            ),
            0.75,
        )
        self.assertTrue(
            MODULE.strong_textless_consumer_listing_evidence(product, exact)
        )
        self.assertFalse(
            MODULE.strong_textless_consumer_listing_evidence(product, wrong_variant)
        )

    def test_compact_official_listing_matches_long_marketplace_title(self):
        product = MODULE.Product(
            id="AMZ-B0G4DR476L",
            name=(
                "TWICE Soft Stadium Bristle Toothbrush – Innovative 3-Tier "
                "Soft Bristles that Helps Remove Plaque by Hugging to Teeth & "
                "Gums for a Deep Clean, 2 Count, Pack of 2"
            ),
            brand="TWICE",
            generic="",
            strength="",
            form="",
            pack_size="2 Count",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0G4DR476L",
            asin="B0G4DR476L",
            group="consumer",
        )
        official = MODULE.Candidate(
            product.id,
            "https://smiletwice.com/cdn/shop/files/Image_01_Main_Image.jpg",
            (
                "https://smiletwice.com/products/"
                "soft-stadium-toothbrushes-deep-clean-gum-friendly-2-pack"
            ),
            "smiletwice.com",
            "manufacturer",
            MODULE.AUTOMATED_PROVENANCE,
            100,
            "Soft Stadium Toothbrushes, Deep Clean, Gum Friendly, 2 Pack – Twice",
        )
        self.assertLess(MODULE.candidate_identity_score(product, official), 0.80)
        self.assertLess(
            MODULE.critical_identity_coverage(
                product,
                " ".join(
                    [official.title, official.source_page_url, official.image_url]
                ),
            ),
            0.50,
        )
        self.assertTrue(
            MODULE.compact_official_consumer_listing_evidence(product, official)
        )
        self.assertTrue(
            MODULE.strong_textless_consumer_listing_evidence(product, official)
        )

        wrong_variant = MODULE.replace(
            official,
            title="TWICE 3D Triple-Head Toothbrush, 2 Pack",
            source_page_url=(
                "https://smiletwice.com/products/3d-triple-head-toothbrush-2-pack"
            ),
        )
        wrong_count = MODULE.replace(
            official,
            title="Soft Stadium Toothbrushes, Deep Clean, 4 Pack – Twice",
            source_page_url=(
                "https://smiletwice.com/products/soft-stadium-toothbrushes-4-pack"
            ),
        )
        wrong_source_kind = MODULE.replace(
            official,
            source_kind="marketplace_api",
        )
        self.assertFalse(
            MODULE.compact_official_consumer_listing_evidence(product, wrong_variant)
        )
        self.assertFalse(
            MODULE.compact_official_consumer_listing_evidence(product, wrong_count)
        )
        self.assertFalse(
            MODULE.compact_official_consumer_listing_evidence(product, wrong_source_kind)
        )

    def test_textless_model_listing_requires_matching_product_type(self):
        product = MODULE.Product(
            id="AMZ-B0D92RY9QG",
            name=(
                "Osprey Poco Portable Changing Pad - Washable Travel Baby "
                "Diaper Mat with Pockets"
            ),
            brand="Osprey",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="https://www.amazon.com/dp/B0D92RY9QG",
            asin="B0D92RY9QG",
            group="consumer",
        )
        exact = MODULE.Candidate(
            product.id,
            (
                "https://www.bfgcdn.com/1500_1500_90/507-0101-0211/"
                "osprey-poco-changing-pad-changing-mat.jpg"
            ),
            (
                "https://retailer.example/Osprey-Poco-Changing-Pad-"
                "On-the-Go-Diaper-Changing-Solution-1005407/"
            ),
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "Diaper Changing Pad Osprey Poco Changing Pad - On-the-Go Diaper",
        )
        wrong_type = MODULE.replace(
            exact,
            image_url="https://retailer.example/osprey-poco-child-carrier.jpg",
            source_page_url="https://retailer.example/osprey-poco-child-carrier",
            title="Osprey Poco Child Carrier Backpack",
        )
        self.assertLess(MODULE.candidate_identity_score(product, exact), 0.65)
        self.assertTrue(
            MODULE.strong_textless_consumer_listing_evidence(
                product,
                exact,
                "OSPREY",
            )
        )
        self.assertFalse(
            MODULE.strong_textless_consumer_listing_evidence(
                product,
                wrong_type,
                "OSPREY",
            )
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
        self.assertTrue(MODULE.requires_image_ocr(product, exact, 1000, 1000))

    def test_medicine_identity_uses_exact_brand_when_register_omits_generic(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1093",
            name="ALVEOFACT-108",
            brand="ALVEOFACT-108",
            generic="",
            strength="108 mg/ml",
            form="Powder and solvent for suspension",
            pack_size="1 glass vial",
            manufacturer="BAG HEALTH CARE GmbH",
            source_url="",
            asin="",
            group="medicine",
        )
        self.assertTrue(
            MODULE.medicine_identity_evidence(
                product,
                "ALVEOFACT-108 powder and solvent for suspension",
            )
        )
        self.assertFalse(
            MODULE.medicine_identity_evidence(
                product,
                "Unrelated bovine lung surfactant product",
            )
        )

    def test_ambiguous_one_token_brand_rejects_retailer_variant_collision(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0953",
            name="Wellness",
            brand="Wellness",
            generic="Paracetamol Pseudoephedrine HCl Dextromethorphan HBr",
            strength="325 mg/30 mg/4.5 mg",
            form="Film Coated Tablets",
            pack_size="10x10 Tablets",
            manufacturer=(
                "LIPTIS FOR PHARMACEUTICALS & MEDICAL PRODUCTS (S.A.E)."
            ),
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url=(
                "https://cdn01.pharmeasy.in/dam/products/I11230/"
                "wellness-24-tab-10s.jpg"
            ),
            source_page_url=(
                "https://pharmeasy.in/health-care/products/"
                "wellness-24-tab-10-s-190486"
            ),
            source_domain="pharmeasy.in",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=100,
            title=(
                "Wellness 24 multivitamin tablets; recommended Paracetamol "
                "products"
            ),
            page_primary_image=True,
        )
        visual_text = "Multivitamin and Multimineral Tablets WELLNESS-24"
        self.assertTrue(MODULE.medicine_name_evidence(product, visual_text))
        self.assertFalse(
            MODULE.medicine_identity_evidence(
                product,
                candidate.image_url + " " + visual_text,
            )
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                visual_text,
            )
        )

    def test_one_token_medicine_rejects_suspension_tablet_collision(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1394",
            name="EFLARON 250MG TABLETS",
            brand="EFLARON 250MG TABLETS",
            generic="Metronidazole 250mg",
            strength="250mg",
            form="Tablets",
            pack_size="1000 tablets",
            manufacturer="DAWA LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url=(
                "https://dawalifesciences.com/wp-content/uploads/2021/05/"
                "Eflaron-plus-suspension-100ml.png"
            ),
            source_page_url=(
                "https://dawalifesciences.com/product/"
                "eflaron-plus-suspension/"
            ),
            source_domain="dawalifesciences.com",
            source_kind="manufacturer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=122,
            title="Eflaron Plus Suspension",
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                "Eflaron Plus Suspension Metronidazole 200mg/5ml 100ml",
            )
        )

    def test_medicine_brand_matching_ignores_form_and_strength_suffixes(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0912",
            name="T-Sar Tablet 40mg",
            brand="T-Sar Tablet 40mg",
            generic="Telmisartan BP",
            strength="40mg",
            form="Tablets",
            pack_size="3x10 Tablets",
            manufacturer="CCL Pharmaceuticals",
            source_url="",
            asin="",
            group="medicine",
        )
        evidence = (
            "T-SAR telmisartan CCL "
            "https://pharmacy.example/images/T-SAR-H10x10.jpg"
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, evidence))
        self.assertTrue(MODULE.medicine_identity_evidence(product, evidence))
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "Telmisartan 40 mg tablets from another manufacturer",
            )
        )

    def test_medicine_brand_matching_tolerates_one_regulatory_typo(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0933",
            name="ULTRA-LEVULE 250 MG SACHETS",
            brand="ULTRA-LEVULE 250 MG SACHETS",
            generic="SACCHAROMYCES BOULARDII CNCM I-745",
            strength="250MG",
            form="Powder for oral suspension",
            pack_size="10 sachets",
            manufacturer="BIOCODEX",
            source_url="",
            asin="",
            group="medicine",
        )
        official_evidence = (
            "ULTRA-LEVURE 250 mg, 10 sachets, Saccharomyces boulardii "
            "CNCM I-745, BIOCODEX"
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, official_evidence))
        self.assertTrue(MODULE.medicine_identity_evidence(product, official_evidence))
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "ULTRA-LEVULIN 250 mg Saccharomyces boulardii BIOCODEX",
            )
        )

    def test_medicine_brand_matching_rejects_competing_one_edit_brand(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1295",
            name="CIPROREN TABLETS",
            brand="CIPROREN TABLETS",
            generic="Ciprofloxacin",
            strength="500mg",
            form="Tablets",
            pack_size="10 Tablets",
            manufacturer="RENE INDUSTRIES LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        competing_listing = (
            "Cipropen-500 Mg Tablets at ₹120/box | Ciprofloxacin Tablets "
            "from an independent marketplace seller"
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(product, competing_listing)
        )
        self.assertTrue(
            MODULE.medicine_name_evidence(
                product,
                "Cipropen 500 mg tablets by Rene Industries",
            )
        )

    def test_unbranded_combination_allows_one_bounded_regulatory_typo(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0975",
            name="ABACAVIR,DOLUTEGRAVIR AND LAMUVIDINE",
            brand="ABACAVIR,DOLUTEGRAVIR AND LAMUVIDINE",
            generic="ABACAVIR,DOLUTEGRAVIR AND LAMUVIDINE",
            strength="600MG/50MG/300MG",
            form="Film Coated Tablets",
            pack_size="30 Tablets",
            manufacturer="LAURUS LABS LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        official = (
            "Abacavir, Dolutegravir and Lamivudine Tablets "
            "600 mg/50 mg/300 mg, 30 Tablets, manufactured by Laurus Labs Limited"
        )
        self.assertTrue(MODULE.medicine_name_evidence(product, official))
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                official.replace("Laurus Labs Limited", "Emcure Pharmaceuticals"),
            )
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                official.replace("600 mg/50 mg/300 mg", "400 mg/50 mg/300 mg"),
            )
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                official.replace("Lamivudine", "Tenofovir"),
            )
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://regulator.example/source-render.png",
            "https://regulator.example/official-label.pdf",
            "regulator.example",
            "licensed_feed",
            MODULE.AUTOMATED_PROVENANCE,
            110,
            official,
            page_primary_image=True,
        )
        visual_ocr = (
            "Abacavir Dolutegravir and Lamivudine Tablets "
            "600 mg 50 mg 300 mg 30 Tablets"
        )
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                visual_ocr,
            )
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                MODULE.replace(
                    candidate,
                    title=official.replace(
                        "Laurus Labs Limited",
                        "Emcure Pharmaceuticals",
                    ),
                ),
                visual_ocr,
            )
        )

    def test_medicine_name_matches_spelled_out_prolonged_release(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0944",
            name="VASTAREL OD 80MG PRL",
            brand="VASTAREL OD 80MG PRL",
            generic="TRIMETAZIDINE HYDROCHLORIDE",
            strength="80MG",
            form="HARD CAPSULE",
            pack_size="30 hard capsules",
            manufacturer="Egis Pharmaceuticals Private Limited",
            source_url="",
            asin="",
            group="medicine",
        )
        self.assertTrue(
            MODULE.medicine_name_evidence(
                product,
                "VASTAREL OD 80 mg prolonged-release hard capsules",
            )
        )
        self.assertTrue(
            MODULE.medicine_name_evidence(
                product,
                "VASTARELOD 80 mg prolonged-release hard capsules",
            )
        )
        self.assertFalse(
            MODULE.medicine_name_evidence(
                product,
                "VASTAREL OD 80 mg immediate-release hard capsules",
            )
        )

    def test_medicine_visual_evidence_rejects_cross_sell_and_wrong_form(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0932",
            name="ULPAN-40 ER",
            brand="ULPAN-40 ER",
            generic="Pantoprazole",
            strength="40 mg",
            form="Capsules",
            pack_size="3 x 10 Capsules",
            manufacturer="CORONA REMEDIES PVT LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product.id,
            "https://pharmacy.example/images/pantoride-40-tab.webp",
            "https://pharmacy.example/products/ulpan-tablet",
            "pharmacy.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            "ULPAN 40 Pantoprazole Tablet",
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                candidate,
                "PANTORIDE 40 Pantoprazole Tablet",
            )
        )
        wrong_form = MODULE.replace(
            candidate,
            image_url="https://pharmacy.example/images/ulpan-40-tablet.webp",
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                wrong_form,
                "ULPAN 40 Pantoprazole Tablet",
            )
        )
        wrong_variant = MODULE.replace(
            candidate,
            image_url="https://pharmacy.example/images/ulpan-dsr-capsules.webp",
            source_page_url="https://pharmacy.example/products/ulpan-dsr-capsules",
            title="ULPAN DSR Pantoprazole Domperidone Capsules",
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                wrong_variant,
                "ULPAN DSR Pantoprazole Domperidone Capsules",
            )
        )
        exact = MODULE.replace(
            candidate,
            image_url="https://pharmacy.example/images/ulpan-40-er-capsules.webp",
            source_page_url="https://pharmacy.example/products/ulpan-40-er-capsules",
            title="ULPAN-40 ER Pantoprazole Capsules",
        )
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(
                product,
                exact,
                "ULPAN-40 ER Pantoprazole Capsules",
            )
        )
        self.assertTrue(
            MODULE.medicine_component_text_matches(
                product,
                exact,
                "ULPAN-40 ER Pantoprazole 40 mg Capsules",
            )
        )
        self.assertFalse(
            MODULE.medicine_component_text_matches(
                product,
                exact,
                "ULPAN-40 ER Pantoprazole 20 mg Capsules",
            )
        )
        self.assertFalse(
            MODULE.medicine_component_text_matches(
                product,
                wrong_form,
                "ULPAN 40 Pantoprazole 40 mg Tablets",
            )
        )

    def test_primary_product_image_can_use_exact_page_identity(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0934",
            name="UNSIATEM",
            brand="UNSIATEM",
            generic="FEBUXOSTAT",
            strength="80MG",
            form="Film Coated Tablets",
            pack_size="10x10 Tablets",
            manufacturer="Liptis Pharmaceuticals",
            source_url="",
            asin="",
            group="medicine",
        )
        primary = MODULE.Candidate(
            product.id,
            "https://pharmacy.example/images/108262.png",
            "https://pharmacy.example/products/unsiatem-80-mg-30-tab",
            "pharmacy.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            85,
            "UNSIATEM 80 MG Film Coated Tablets Febuxostat Liptis",
            page_primary_image=True,
        )
        self.assertTrue(
            MODULE.medicine_visual_evidence_matches(
                product,
                primary,
                "Unsiatem 80mg 30",
            )
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                MODULE.replace(primary, page_primary_image=False),
                "Unsiatem 80mg 30",
            )
        )
        self.assertFalse(
            MODULE.medicine_visual_evidence_matches(
                product,
                primary,
                "Unsiatem 40mg 30",
            )
        )

    def test_reads_text_from_current_and_legacy_rapidocr_results(self):
        modern = type("RapidOutput", (), {"txts": ("PARACETAMOL", "500 MG")})()
        modern_empty = type("RapidOutput", (), {"txts": None})()
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
        self.assertEqual(MODULE.rapidocr_text_items(modern_empty), [])
        self.assertEqual(
            MODULE.rapidocr_text_items(legacy),
            ["PARACETAMOL", "500 MG"],
        )

    def test_small_false_face_boxes_do_not_reject_product_packaging(self):
        # This is the relative box size produced by the detector on the clean
        # Baby Dove two-bottle catalogue image inspected in production.
        self.assertFalse(
            MODULE.face_boxes_indicate_lifestyle(
                [(647, 514, 123, 123)],
                1001,
                1001,
            )
        )
        self.assertTrue(
            MODULE.face_boxes_indicate_lifestyle(
                [(250, 150, 220, 220)],
                1000,
                1000,
            )
        )
        self.assertTrue(
            MODULE.face_boxes_indicate_lifestyle(
                [(100, 100, 150, 150), (700, 100, 150, 150)],
                1000,
                1000,
            )
        )

    def test_exact_textile_flatlay_can_ignore_print_face_false_positive(self):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.skipTest("Pillow is not installed")
        product = MODULE.Product(
            id="AMZ-B08Q4GPCVG",
            name="Lulujo Baby Swaddle Blankets Mudcloth Blackbirds 2 Count",
            brand="Lulujo",
            generic="",
            strength="",
            form="",
            pack_size="2 Count",
            manufacturer="Lulujo",
            source_url="",
            asin="B08Q4GPCVG",
            group="consumer",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url="https://m.media-amazon.com/images/I/81osKX7+DKL.jpg",
            source_page_url="https://www.amazon.com/dp/B08Q4GPCVG",
            source_domain="amazon.com",
            source_kind="marketplace_api",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=300,
            title="Lulujo Swaddle Blankets Mudcloth Blackbirds 2 Count ASIN B08Q4GPCVG",
            page_primary_image=True,
        )
        flatlay = Image.new("RGB", (1000, 1000), "white")
        ImageDraw.Draw(flatlay).rectangle((220, 120, 780, 880), fill=(155, 100, 65))
        self.assertTrue(
            MODULE.exact_textile_flatlay_can_ignore_face_false_positive(
                product,
                candidate,
                flatlay,
                "",
            )
        )
        lifestyle = flatlay.copy()
        ImageDraw.Draw(lifestyle).rectangle((0, 0, 999, 999), outline=(60, 70, 80), width=30)
        self.assertFalse(
            MODULE.exact_textile_flatlay_can_ignore_face_false_positive(
                product,
                candidate,
                lifestyle,
                "",
            )
        )
        non_primary = MODULE.replace(candidate, page_primary_image=False)
        self.assertFalse(
            MODULE.exact_textile_flatlay_can_ignore_face_false_positive(
                product,
                non_primary,
                flatlay,
                "",
            )
        )

    def test_exact_asin_primary_packshot_can_fill_white_catalogue_frame(self):
        from PIL import Image, ImageDraw

        product = MODULE.Product(
            id="AMZ-B00011JWNO",
            name="MD-Tweeze Hair Styling Wax",
            brand="MD-Tweeze",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="MD-Tweeze",
            source_url="https://www.amazon.com/dp/B00011JWNO",
            asin="B00011JWNO",
            group="consumer",
        )
        candidate = MODULE.amazon_asin_candidates(product)[0]
        packshot = Image.new("RGB", (1200, 1200), "white")
        ImageDraw.Draw(packshot).ellipse(
            (20, 20, 1180, 1180),
            fill=(210, 198, 165),
            outline=(60, 55, 45),
            width=10,
        )
        self.assertTrue(
            MODULE.exact_asin_primary_packshot_can_fill_frame(
                product,
                candidate,
                packshot,
                "",
            )
        )
        self.assertFalse(
            MODULE.exact_asin_primary_packshot_can_fill_frame(
                product,
                MODULE.replace(candidate, page_primary_image=False),
                packshot,
                "",
            )
        )
        lifestyle = packshot.copy()
        ImageDraw.Draw(lifestyle).rectangle(
            (0, 0, 1199, 1199),
            outline=(20, 90, 160),
            width=30,
        )
        self.assertFalse(
            MODULE.exact_asin_primary_packshot_can_fill_frame(
                product,
                candidate,
                lifestyle,
                "",
            )
        )

    def test_bundle_cutouts_allow_several_real_product_components(self):
        dove_component_areas = [80353, 8346, 31583]
        self.assertTrue(
            MODULE.component_areas_are_fragmented(
                dove_component_areas,
                allows_multiple_items=False,
            )
        )
        self.assertFalse(
            MODULE.component_areas_are_fragmented(
                dove_component_areas,
                allows_multiple_items=True,
            )
        )
        self.assertTrue(
            MODULE.component_areas_are_fragmented(
                [10_000] * 7,
                allows_multiple_items=True,
            )
        )
        repeated_two_pack = [4_320_841, 4_320_557, 2_472_983]
        self.assertEqual(
            MODULE.repeated_pack_component_count(repeated_two_pack),
            2,
        )
        self.assertFalse(
            MODULE.component_areas_are_fragmented(
                repeated_two_pack,
                allows_multiple_items=True,
            )
        )
        self.assertTrue(
            MODULE.component_areas_are_fragmented(
                repeated_two_pack,
                allows_multiple_items=False,
            )
        )

    def test_branded_consumer_images_require_brand_or_exact_asin_evidence(self):
        product = MODULE.Product(
            id="AMZ-B08BYXHWCH",
            name="eZthings Forehead Thermometer Medical Non Touch Infrared",
            brand="eZthings",
            generic="",
            strength="",
            form="",
            pack_size="",
            manufacturer="",
            source_url="",
            asin="B08BYXHWCH",
            group="consumer",
        )
        generic = MODULE.Candidate(
            product.id,
            "https://retailer.example/generic-thermometer.jpg",
            "https://retailer.example/generic-forehead-thermometer",
            "retailer.example",
            "specialist_retailer",
            MODULE.AUTOMATED_PROVENANCE,
            65,
            title="Medical infrared forehead thermometer",
        )
        official = MODULE.replace(
            generic,
            image_url="https://e-zthings.com/cdn/shop/products/thermometer.jpg",
            source_page_url="https://e-zthings.com/products/ezthings-thermometer",
            source_domain="e-zthings.com",
            source_kind="manufacturer",
            title="eZthings Forehead Thermometer",
        )
        exact_asin = MODULE.replace(
            generic,
            source_page_url="https://market.example/dp/B08BYXHWCH",
        )
        self.assertFalse(MODULE.consumer_brand_evidence(product, generic))
        self.assertTrue(MODULE.consumer_brand_evidence(product, official))
        self.assertTrue(MODULE.consumer_brand_evidence(product, exact_asin))

        article_brand = MODULE.replace(
            product,
            name="The Honest Company Baby Shampoo and Body Wash",
            brand="The",
            asin="",
        )
        article_official = MODULE.replace(
            generic,
            image_url=(
                "https://www.thehonestcompany.com/cdn/shop/products/baby-wash.jpg"
            ),
            source_page_url=(
                "https://www.thehonestcompany.com/products/baby-shampoo-body-wash"
            ),
            source_domain="thehonestcompany.com",
            title="Baby Shampoo and Body Wash",
        )
        self.assertTrue(
            MODULE.consumer_brand_evidence(article_brand, article_official)
        )

    def test_official_medicine_catalogue_slugs_remove_form_and_pack_suffixes(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0195",
            name="KOF OFF SYRUP 100ML",
            brand="KOF OFF SYRUP 100ML",
            generic="Chlorpheniramine Maleate and Pseudoephedrine HCl",
            strength="2mg/30mg",
            form="Syrup",
            pack_size="100ML Bottle",
            manufacturer="RENE INDUSTRIES LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        self.assertEqual(
            MODULE.official_medicine_catalogue_slugs(product),
            ["kof-off"],
        )
        self.assertEqual(
            MODULE.official_medicine_catalogue_slugs(
                MODULE.replace(
                    product,
                    name="RENETRIM DS TABLETS",
                    brand="RENETRIM DS TABLETS",
                )
            ),
            ["renetrim-ds"],
        )

    def test_medicine_pack_measurements_multiply_dosage_unit_presentations(self):
        self.assertIn(
            ("count", 100.0),
            MODULE.measurements("250 mg 10x10 Capsules"),
        )
        self.assertIn(
            ("count", 30.0),
            MODULE.measurements("3 x 10 tablets"),
        )
        self.assertIn(
            ("count", 6.0),
            MODULE.measurements("6*1 BLISTER"),
        )
        self.assertIn(
            ("count", 10.0),
            MODULE.measurements("10 capsules"),
        )
        shared_unit_alternatives = MODULE.measurements(
            "10x10 or 1000 tablets"
        )
        self.assertIn(("count", 100.0), shared_unit_alternatives)
        self.assertIn(("count", 1000.0), shared_unit_alternatives)
        expected = MODULE.measurements("250 mg 10 capsules")
        wrong_outer_pack = MODULE.measurements("250 mg 10x10 capsules")
        self.assertTrue(
            MODULE.measurements_conflict(expected, wrong_outer_pack)
        )

        unspecified_pack = MODULE.Product(
            id="rwanda-fda-hm-0428",
            name="ASTHAREN TABLETS",
            brand="ASTHAREN TABLETS",
            generic="Salbutamol Sulphate",
            strength="4mg",
            form="Tablets",
            pack_size="",
            manufacturer="RENE INDUSTRIES LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        expected_unspecified = MODULE.expected_product_measurements(
            unspecified_pack
        )
        observed_carton = MODULE.measurements("4mg 10x10 tablets")
        self.assertIn(("count_any", 0.0), expected_unspecified)
        self.assertTrue(
            MODULE.measurements_match(expected_unspecified, observed_carton)
        )
        self.assertFalse(
            MODULE.measurements_conflict(expected_unspecified, observed_carton)
        )

    def test_official_medicine_catalogue_resolver_requires_exact_same_domain_page(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-1010",
            name="INDOREN CAPSULES",
            brand="INDOREN CAPSULES",
            generic="INDOMETHACIN BP",
            strength="25 mg",
            form="Capsules",
            pack_size="10x10 Capsules",
            manufacturer="RENE INDUSTRIES LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        html = """
        <html><head><title>Indoren - Rene Industries Limited</title>
        <script type="application/ld+json">
        {"@type":"Product","image":"https://www.rene.co.ug/uploads/indoren.jpg"}
        </script></head><body>
        INDOREN CAPSULES. Indomethacin BP 25 mg. 10 x 10 capsules.
        Manufactured by Rene Industries Limited.
        </body></html>
        """

        class Web:
            def get_page(self, url):
                self.url = url
                return url, html

        web = Web()
        candidates = MODULE.official_medicine_catalogue_candidates(product, web)
        self.assertEqual(
            web.url,
            "https://www.rene.co.ug/products/indoren/",
        )
        self.assertTrue(candidates)
        self.assertTrue(all(item.source_kind == "manufacturer" for item in candidates))
        self.assertTrue(all(item.page_primary_image for item in candidates))
        self.assertIn("Indomethacin BP 25 mg", candidates[0].title)

        class RedirectedWeb:
            def get_page(self, _url):
                return "https://retailer.example/indoren", html

        self.assertEqual(
            MODULE.official_medicine_catalogue_candidates(
                product,
                RedirectedWeb(),
            ),
            [],
        )

        class WrongProductRedirectWeb:
            def get_page(self, _url):
                return "https://www.rene.co.ug/products/mycoren/", html

        self.assertEqual(
            MODULE.official_medicine_catalogue_candidates(
                product,
                WrongProductRedirectWeb(),
            ),
            [],
        )

    def test_official_medicine_index_selects_only_exact_brand_artwork(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-0278",
            name="LASTMOL TABLETS",
            brand="LASTMOL TABLETS",
            generic="SALBUTAMOL",
            strength="4 mg",
            form="TABLETS",
            pack_size="",
            manufacturer="LABORATORY & ALLIED LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        html = """
        <html><head><title>Laboratory and Allied - Products</title></head>
        <body>
          <img src="https://cdn.example/Laboratory-Allied-Logo.png">
          <img src="https://cdn.example/Lastmol-1920w.png">
          <img src="https://cdn.example/Paratal-1920w.png">
        </body></html>
        """

        class Web:
            def get_page(self, url):
                self.url = url
                return url, html

        web = Web()
        candidates = MODULE.official_medicine_index_candidates(product, web)
        self.assertEqual(web.url, "https://www.laballied.com/products")
        self.assertEqual(len(candidates), 1)
        self.assertIn("Lastmol-1920w.png", candidates[0].image_url)
        self.assertEqual(candidates[0].source_kind, "manufacturer")

        class WrongPathWeb:
            def get_page(self, _url):
                return "https://www.laballied.com/about-us", html

        self.assertEqual(
            MODULE.official_medicine_index_candidates(
                product,
                WrongPathWeb(),
            ),
            [],
        )

    def test_exact_official_medicine_pack_can_ignore_face_detector_geometry(self):
        from PIL import Image, ImageDraw

        product = MODULE.Product(
            id="rwanda-fda-hm-0278",
            name="LASTMOL TABLETS",
            brand="LASTMOL TABLETS",
            generic="SALBUTAMOL",
            strength="4 mg",
            form="TABLETS",
            pack_size="",
            manufacturer="LABORATORY & ALLIED LTD",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url="https://cdn.example/Lastmol-1920w.png",
            source_page_url="https://www.laballied.com/products",
            source_domain="www.laballied.com",
            source_kind="manufacturer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=118,
            title="Laboratory and Allied - Products",
        )
        catalogue = Image.new("RGB", (1200, 800), (82, 111, 118))
        ImageDraw.Draw(catalogue).rectangle(
            (430, 150, 780, 700),
            fill=(250, 225, 15),
        )
        exact_ocr = (
            "LASTMOL TABLETS Salbutamol 4 mg 10 x 10 tablets "
            "Laboratory & Allied Ltd"
        )
        self.assertTrue(
            MODULE.exact_medicine_pack_can_ignore_face_false_positive(
                product,
                candidate,
                catalogue,
                exact_ocr,
            )
        )
        full_bleed_scene = catalogue.copy()
        draw = ImageDraw.Draw(full_bleed_scene)
        draw.rectangle((0, 0, 1200, 80), fill=(10, 180, 40))
        draw.rectangle((0, 720, 1200, 800), fill=(180, 20, 120))
        self.assertFalse(
            MODULE.exact_medicine_pack_can_ignore_face_false_positive(
                product,
                candidate,
                full_bleed_scene,
                exact_ocr,
            )
        )
        sparse_pack = Image.new("RGB", (1200, 800), "white")
        ImageDraw.Draw(sparse_pack).rectangle(
            (350, 500, 850, 700),
            fill=(215, 20, 40),
        )
        self.assertTrue(
            MODULE.low_entropy_exact_medicine_pack_has_visible_object(
                product,
                candidate,
                sparse_pack,
                exact_ocr,
            )
        )

        self.assertTrue(
            MODULE.measurements_match(
                [("count_any", 0.0)],
                [("mass_mg", 10_000.0)],
            )
        )
        self.assertFalse(
            MODULE.measurements_match(
                [("mass_mg", 4.0), ("count_any", 0.0)],
                [("volume_ml", 100.0)],
            )
        )

    def test_exact_medicine_carton_and_blister_can_ignore_band_geometry(self):
        from PIL import Image, ImageDraw

        product = MODULE.Product(
            id="rwanda-fda-hm-0078",
            name="BREATHEZY-L (10/5) TABLETS",
            brand="BREATHEZY-L (10/5) TABLETS",
            generic="MONTELUKAST SODIUM AND LEVOCETIRIZINE DIHYDROCHLORIDE",
            strength="10 mg/5 mg",
            form="TABLETS",
            pack_size="3 x 10 tablets",
            manufacturer="MSN Laboratories",
            source_url="",
            asin="",
            group="medicine",
        )
        candidate = MODULE.Candidate(
            product_id=product.id,
            image_url="https://pharmacy.example/breathezy-l-10-5.png",
            source_page_url="https://pharmacy.example/breathezy-l-10-5-tablets",
            source_domain="pharmacy.example",
            source_kind="specialist_retailer",
            rights_basis=MODULE.AUTOMATED_PROVENANCE,
            priority=84,
            title="BREATHEZY-L 10/5 tablets",
        )
        packshot = Image.new("RGB", (600, 800), "white")
        draw = ImageDraw.Draw(packshot)
        draw.rectangle((45, 390, 405, 570), fill=(245, 238, 235))
        draw.rectangle((400, 220, 560, 590), fill=(220, 220, 215))
        exact_text = (
            "BREATHEZY-L 10/5 Montelukast sodium 10 mg and "
            "Levocetirizine dihydrochloride 5 mg tablets 3 x 10"
        )
        self.assertTrue(
            MODULE.exact_medicine_catalogue_packshot_can_ignore_band(
                product,
                candidate,
                packshot,
                exact_text,
            )
        )
        self.assertFalse(
            MODULE.exact_medicine_catalogue_packshot_can_ignore_band(
                product,
                candidate,
                packshot,
                "Unrelated medicine banner",
            )
        )

    def test_official_medicine_image_sitemap_selects_exact_product_entry(self):
        product = MODULE.Product(
            id="rwanda-fda-hm-test-doloact-plus",
            name="DOLOACT PLUS TABLETS",
            brand="DOLOACT PLUS TABLETS",
            generic="Aceclofenac and Paracetamol",
            strength="100mg/500mg",
            form="Tablets",
            pack_size="10 Tablets",
            manufacturer="DAWA LIMITED",
            source_url="",
            asin="",
            group="medicine",
        )
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
          xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
          <url>
            <loc>https://dawalifesciences.com/product/doloact-gel/</loc>
            <image:image><image:loc>https://dawalifesciences.com/uploads/Doloact-Gel.png</image:loc></image:image>
          </url>
          <url>
            <loc>https://dawalifesciences.com/product/doloact-plus-tablets/</loc>
            <image:image><image:loc>https://dawalifesciences.com/uploads/Doloact-Plus.png</image:loc></image:image>
          </url>
        </urlset>
        """

        class Web:
            def get_xml(self, url):
                self.url = url
                return url, xml

        web = Web()
        candidates = MODULE.official_medicine_image_sitemap_candidates(
            product,
            web,
        )
        self.assertEqual(
            web.url,
            "https://dawalifesciences.com/product-sitemap.xml",
        )
        self.assertEqual(len(candidates), 1)
        self.assertIn("Doloact-Plus.png", candidates[0].image_url)
        self.assertTrue(candidates[0].page_primary_image)
        self.assertEqual(candidates[0].source_kind, "manufacturer")


if __name__ == "__main__":
    unittest.main()
