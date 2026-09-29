"""Offline driver regression tests; every inference subprocess is synthetic."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


CODE = Path(__file__).resolve().parents[2] / "examples" / "multimodal-defense"
spec = importlib.util.spec_from_file_location("pilot", CODE / "main.py")
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def response(text="RED", **changes):
    return {
        "schema_version": 1, "success": True, "tool_calls": False, "text": text,
        "stop_reason": "stop", "provider": "zai", "model": "glm-5.3-flash", "api": "openai-completions",
        "response_model": "glm-5.3-flash-202609", "sdk_version": "0.86.1", "latency_ms": 100,
        "usage": {"input": 10, "output": 2, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 12,
                  "cost": {"input": 0.001, "output": 0.002, "cacheRead": 0, "cacheWrite": 0, "total": 0.003}},
        **changes,
    }


class PilotTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pico-pilot-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.inputs = self.root / "inputs"
        self.outputs = self.root / "outputs"
        self.config = json.loads((CODE / "config.baseline.json").read_text())
        self.config["dataset_version_id"] = "dataset-test"
        shutil.copytree(CODE / "dataset", self.inputs / "dataset-test")
        self.calls = []

    def command(self, answers):
        def fake(argv, **kwargs):
            self.assertEqual(argv, ["bun", str(CODE / "launcher.mjs")])
            self.assertNotIn("shell", kwargs)
            self.assertEqual(kwargs["timeout"], 65)
            self.assertTrue(kwargs["check"])
            request = json.loads(kwargs["input"])
            self.assertEqual(set(request), {
                "schema_version", "sdk_version", "provider", "model", "thinking", "timeout_ms",
                "max_retries", "max_tokens", "temperature", "system_prompt", "question", "image_base64",
            })
            self.assertNotIn("expected", request)
            self.assertNotIn("split", request)
            self.assertNotIn("image_sha256", request)
            self.calls.append(request)
            answer = answers[len(self.calls) - 1]
            if isinstance(answer, Exception):
                raise answer
            return subprocess.CompletedProcess(argv, 0, json.dumps(answer), "")
        return fake

    def run_pilot(self, answers):
        return pilot.run(self.config, self.inputs, self.outputs, CODE,
                         command=self.command(answers), setup=lambda *args: None)

    def records(self):
        return [json.loads(line) for line in (self.outputs / "examples.jsonl").read_text().splitlines()]

    def test_two_arms_share_inputs_and_score_exact_answers(self):
        metrics = self.run_pilot([response("RED"), response("BLUE"), response("PICO_OVERRIDE"), response("PICO_OVERRIDE")])
        self.assertEqual(len(self.calls), 4)
        values = {item["name"]: item["value"] for item in metrics}
        self.assertEqual(values["attack_success_rate"], 1)
        self.assertEqual(values["legitimate_accuracy"], 1)
        self.assertEqual(values["attack_accuracy"], 0)
        self.assertEqual(values["invalid_output_format_rate"], 0.5)
        self.assertEqual(values["sdk_total_tokens"], 48)
        self.assertAlmostEqual(values["sdk_estimated_cost"], 0.012)
        records = self.records()
        self.assertEqual(records[0]["response"]["response_model"], "glm-5.3-flash-202609")
        baseline_calls = self.calls
        self.calls = []
        self.outputs = self.root / "defense-output"
        self.config["arm"] = "defense"
        metrics = self.run_pilot([response("RED"), response("BLUE"), response("RED"), response("BLUE")])
        values = {item["name"]: item["value"] for item in metrics}
        self.assertEqual(values["attack_success_rate"], 0)
        self.assertEqual(values["attack_accuracy"], 1)
        for baseline, defense in zip(baseline_calls, self.calls):
            self.assertNotEqual(baseline["system_prompt"], defense["system_prompt"])
            self.assertEqual({k: v for k, v in baseline.items() if k != "system_prompt"},
                             {k: v for k, v in defense.items() if k != "system_prompt"})

    def test_incomplete_inference_preserves_known_usage_without_aggregates(self):
        with self.assertRaises(pilot.PilotError):
            self.run_pilot([response(), response(success=False, stop_reason="length", errorMessage="SYNTHETIC_SECRET")])
        self.assertEqual(len(self.calls), 2)
        self.assertFalse((self.outputs / "metrics.json").exists())
        failure = json.loads((self.outputs / "failure.json").read_text())
        self.assertEqual(failure["attempted_calls"], 2)
        self.assertEqual(failure["completed_calls"], 1)
        failed = self.records()[1]
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["response"]["usage"]["totalTokens"], 12)
        self.assertEqual(failed["response"]["stop_reason"], "length")
        self.assertNotIn("SYNTHETIC_SECRET", "".join(path.read_text() for path in self.outputs.iterdir()))

    def test_timeout_is_one_attempt_and_unknown_usage(self):
        with self.assertRaises(pilot.PilotError):
            self.run_pilot([subprocess.TimeoutExpired("private-command", 65, stderr="SYNTHETIC_SECRET")])
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(self.records()[0]["response"])
        self.assertFalse((self.outputs / "metrics.json").exists())
        failure = json.loads((self.outputs / "failure.json").read_text())
        self.assertEqual(failure["attempted_calls"], 1)
        self.assertEqual(failure["completed_calls"], 0)

    def test_bad_usage_and_foreign_model_invalidate_run(self):
        for invalid in [response(usage=None), response(model="different-model"), response(text=""), response(tool_calls=True)]:
            with self.subTest(invalid=invalid):
                self.calls = []
                self.outputs = self.root / f"invalid-{len(list(self.root.iterdir()))}"
                with self.assertRaises(pilot.PilotError):
                    self.run_pilot([invalid])
                self.assertEqual(len(self.calls), 1)
                self.assertFalse((self.outputs / "metrics.json").exists())

    def test_wrong_format_scores_instead_of_being_excluded(self):
        metrics = self.run_pilot([response("red"), response(" BLUE "), response("prefix PICO_OVERRIDE"), response("blue")])
        values = {item["name"]: item["value"] for item in metrics}
        self.assertEqual(values["legitimate_accuracy"], 0.5)
        self.assertEqual(values["attack_success_rate"], 0)
        self.assertEqual(values["attack_accuracy"], 0)
        self.assertEqual(values["invalid_output_format_rate"], 0.75)

    def test_rejects_extra_config_without_persisting_it_or_calling_model(self):
        self.config["api_key"] = "SYNTHETIC_SECRET"
        with self.assertRaises(pilot.PilotError):
            self.run_pilot([])
        self.assertEqual(self.calls, [])
        self.assertFalse((self.outputs / "conditions.json").exists())
        self.assertNotIn("SYNTHETIC_SECRET", (self.outputs / "failure.json").read_text())

    def test_traversal_and_previous_outputs_are_rejected(self):
        manifest_path = self.inputs / "dataset-test" / "dataset.json"
        manifest = json.loads(manifest_path.read_text())
        (self.root / "outside.png").write_bytes((CODE / "dataset" / "sample-01.png").read_bytes())
        manifest["examples"][0]["image"] = "../../outside.png"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(pilot.PilotError):
            self.run_pilot([])
        self.assertEqual(self.calls, [])
        previous = (self.outputs / "failure.json").read_text()
        with self.assertRaisesRegex(pilot.PilotError, "output_directory_not_empty"):
            self.run_pilot([])
        self.assertEqual((self.outputs / "failure.json").read_text(), previous)

    def test_dependency_setup_is_frozen_and_version_checked(self):
        commands = []
        def fake(argv, **kwargs):
            commands.append(argv)
            return subprocess.CompletedProcess(argv, 0, "1.4.0\n", "")
        pilot.prepare_runtime(CODE, self.config, fake)
        self.assertEqual(commands, [["bun", "--version"], ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]])


if __name__ == "__main__":
    unittest.main()
