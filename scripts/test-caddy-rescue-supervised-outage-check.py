#!/usr/bin/env python3
"""Pure offline C1 supervisory contract tests; no host services or SSH calls."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name("caddy-rescue-supervised-outage-check.py")
spec = importlib.util.spec_from_file_location("caddy_supervisor", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def render(records):
    return [json.dumps(x, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n" for x in records]


def utc(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def docker(value):
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def example():
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(seconds=10)
    started = now - dt.timedelta(hours=2)
    ended = now + dt.timedelta(seconds=3)
    resumed = now + dt.timedelta(seconds=7)
    common = {
        "protocol": mod.PROTOCOL,
        "project_sha256": "a" * 64,
        "primary_id_sha256": "b" * 64,
        "server_generation_sha256": "c" * 64,
        "rescue_generation_sha256": "d" * 64,
        "apply_supported": False,
    }
    rows = []
    for index, stage in enumerate(mod.PHASES):
        row = dict(common)
        row.update(phase=stage,
                   observed_at_utc=utc(now + dt.timedelta(seconds=(0, 4, 5, 9)[index])),
                   primary_started_at=docker(resumed if index == 3 else started),
                   primary_finished_at=docker(ended) if 0 < index < 3 else "")
        rows.append(row)
    return rows


class Tests(unittest.TestCase):
    def decode(self, rows):
        return [mod.decode_phase(raw, stage, now=dt.datetime.now(dt.timezone.utc))
                for raw, stage in zip(render(rows), mod.PHASES)]

    def test_genuine_ordered_cross_phase_fixture(self):
        rows = self.decode(example())
        mod.validate_sequence(rows)
        self.assertTrue(all(r["apply_supported"] is False for r in rows))

    def test_bad_receipt_schema_duplicates_and_apply_claim(self):
        row = example()[1]
        raw = render([row])[0]
        for candidate in (raw[:-1], raw + b"\n", raw + b"not-json",
                          raw.replace(b'"apply_supported":false', b'"apply_supported":true'),
                          raw.replace(b'"primary-down"', b'"restored"'),
                          raw.replace(b'"project_sha256"', b'"new_unknown_key"'),
                          raw.replace(b'"a' + b'a' * 63 + b'"', b'"invalid"')):
            with self.assertRaises(mod.Blocked):
                mod.decode_phase(candidate, "primary-down")
        obj = raw.decode().rstrip()[:-1] + ',"protocol":"duplicate"}\n'
        with self.assertRaises(mod.Blocked):
            mod.decode_phase(obj.encode(), "primary-down")

    def test_invalid_phase_chronology_and_identity(self):
        mutations = [
            lambda r: r[1].update(server_generation_sha256="e" * 64),
            lambda r: r[2].update(rescue_generation_sha256="e" * 64),
            lambda r: r[3].update(primary_id_sha256="e" * 64),
            lambda r: r[2].update(project_sha256="e" * 64),
            lambda r: r[2].update(primary_finished_at=docker(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))),
            lambda r: r[2].update(primary_started_at=docker(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))),
            lambda r: r[3].update(primary_started_at=r[0]["primary_started_at"]),
            lambda r: r[1].update(observed_at_utc=r[0]["observed_at_utc"][:-1].replace("T", "X") + "Z"),
            lambda r: r[2].update(phase="before"),
            lambda r: r[3].update(observed_at_utc=r[0]["observed_at_utc"]),
        ]
        for index, mutate in enumerate(mutations):
            rows = example()
            mutate(rows)
            with self.subTest(index=index), self.assertRaises(mod.Blocked):
                try:
                    mod.validate_sequence(self.decode(rows))
                except (mod.Blocked, ValueError):
                    raise mod.Blocked("expected rejection") from None

    def test_stale_replay_unknown_fields_and_untrusted_clock(self):
        base = example()[1]
        invalid = copy.deepcopy(base)
        invalid["server_generation_sha256"] = 0
        with self.assertRaises(mod.Blocked):
            mod.decode_phase(render([invalid])[0], "primary-down")
        stale = copy.deepcopy(base)
        stale["observed_at_utc"] = "2020-01-01T00:00:00Z"
        with self.assertRaises(mod.Blocked):
            mod.decode_phase(render([stale])[0], "primary-down")
        unknown = copy.deepcopy(base)
        unknown["operator_token"] = "never-print-this"
        with self.assertRaises(mod.Blocked):
            mod.decode_phase(render([unknown])[0], "primary-down")

    def test_pinned_ssh_command_and_path_validation(self):
        witness = "/home/operator/xdrive/scripts/caddy-rescue-primary-state-witness.py"
        env = "/home/operator/.xd/config/.env"
        compose = "/home/operator/.xd/config/docker-compose.yml"
        args = ("user@trusted-host", "/tmp/known_hosts", "3080", "2222",
                witness, env, compose, "a" * 64, "b" * 64)
        result = mod.validate_options(*args)
        self.assertEqual(result[-1], witness.rsplit("/", 1)[0] + "/caddy-rescue-operator-check.py")
        command = mod.build_ssh("user@trusted-host", "/private/known_hosts", 2222,
                                ["python3", "-I", witness, "--json", "primary-down", env, compose])
        self.assertEqual(command[0], "ssh")
        self.assertIn("/dev/null", command)
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("ProxyCommand=none", command)
        self.assertIn("ControlMaster=no", command)
        self.assertIn("ForwardAgent=no", command)
        self.assertNotIn("-W", command)
        self.assertNotIn("-R", command)
        self.assertNotIn("docker stop", " ".join(command))
        for invalid in ("../../etc/passwd", "/home/u/../bad.py", "/home/u/file;rm", "/home/u/ space", "-witness"):
            with self.assertRaises(mod.Blocked):
                mod.validate_options("user@trusted-host", "/tmp/known_hosts", "3080",
                                     "2222", invalid, env, compose, "a" * 64, "b" * 64)
        with self.assertRaises(mod.Blocked):
            mod.validate_options("-oProxyCommand=evil", "/tmp/known_hosts", "3080",
                                 "2222", witness, env, compose, "a" * 64, "b" * 64)
        with self.assertRaises(mod.Blocked):
            mod.validate_options(*args[:-1], "0" * 63)

    def test_readonly_pinned_probes_hide_subprocess_diagnostics(self):
        import subprocess as sp
        seen = []
        def fake_run(command, **kwargs):
            seen.append((command, kwargs))
            if command[-1] == 'sha256sum -- /home/operator/test.py':
                return sp.CompletedProcess(command, 0, stdout=("e" * 64 + "  /home/operator/test.py\n").encode(), stderr=b"")
            return sp.CompletedProcess(command, 7, stdout=b"NEVER_PRINT_THIS_PASSWORD", stderr=b"credential leaked")
        with mock.patch.object(mod.subprocess, "run", side_effect=fake_run):
            mod.check_remote_pin("user@trusted-host", "/tmp/hosts", 22,
                                 "/home/operator/test.py", "e" * 64)
            with self.assertRaises(mod.Blocked) as err:
                mod.remote_observe("user@trusted-host", "/tmp/hosts", 22,
                                   "/home/operator/test.py", "/home/u/.env", "/home/u/compose", "before")
            self.assertNotIn("PASSWORD", str(err.exception))
        self.assertEqual(seen[0][1]["stderr"], sp.DEVNULL)
        self.assertEqual(seen[0][1]["stdin"], sp.DEVNULL)

    def test_supervised_orchestration_checks_down_both_sides_of_login(self):
        decoded = self.decode(example())
        calls = []
        def observe(stage):
            calls.append(stage)
            return decoded[len([c for c in calls if c in mod.PHASES]) - 1]
        def authenticate():
            calls.append("real-off-host-login")
        def confirm(question):
            self.assertTrue(question)
            calls.append("external-manual-confirm")
        result = mod.supervised_sequence(observe, authenticate, confirm)
        self.assertEqual(len(result), 4)
        self.assertEqual(calls, ["before", "external-manual-confirm", "primary-down",
                                 "real-off-host-login", "primary-down",
                                 "external-manual-confirm", "restored"])
        interrupted_calls = []
        def stopped_first(stage):
            interrupted_calls.append(stage)
            return decoded[len(interrupted_calls) - 1]
        def interrupted_login():
            raise mod.Blocked("Not authenticated")
        with self.assertRaises(mod.Blocked):
            mod.supervised_sequence(stopped_first, interrupted_login, confirm)
        self.assertEqual(interrupted_calls, ["before", "primary-down"])


    def test_optional_signed_rescue_mode_validates_all_pins_and_private_paths(self):
        witness = "/home/operator/xdrive/scripts/caddy-rescue-primary-state-witness.py"
        args = (
            "--require-approved-runtime", "a" * 64, "b" * 64,
            "/home/operator/.xd/state/approval.json",
            "/home/operator/.xd/state/approval.sig",
            "/home/operator/.xd/state/public.pem",
            "c" * 64,
            "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "d" * 64,
        )
        validated = mod.validate_approved_runtime(args, witness)
        self.assertEqual(validated["runtime"], witness.replace(
            "caddy-rescue-primary-state-witness.py",
            "caddy-rescue-approved-runtime-check.py"))
        self.assertEqual(validated["image_checker"], witness.replace(
            "caddy-rescue-primary-state-witness.py",
            "caddy-rescue-image-approval-check.py"))
        self.assertEqual(validated["key_pin"], "c" * 64)
        self.assertNotIn("docker.sock", str(validated))
        for wrong in (
            args[:4],  # incomplete signed approval arguments
            ("--skip-approval", *args[1:]),
            (args[0], "f" * 63, *args[2:]),
            (*args[:4], "/home/operator/../manifest.json", *args[5:]),
            (*args[:7], "ghcr.io/lazyxu/xdrive-caddy:latest"),
            (*args[:7], "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "f" * 63),
            (*args[:7], "ghcr.io/a/../caddy@sha256:" + "f" * 64),
            (*args[:7], "ghcr.io/lazyxu/caddy@sha256:" + "f" * 64, "extra"),
        ):
            with self.subTest(bad=str(wrong)[:50]), self.assertRaises(mod.Blocked):
                mod.validate_approved_runtime(wrong, witness)

    def test_five_remote_private_hashes_are_strictly_bound_to_requested_paths(self):
        paths = (
            "/home/operator/.xd/config/.env",
            "/home/operator/.xd/config/compose.yml",
            "/home/operator/.xd/state/approval.json",
            "/home/operator/.xd/state/approval.sig",
            "/home/operator/.xd/state/public.pem",
        )
        value = ("a" * 64 + "  " + paths[0] + "\n" +
                 "b" * 64 + "  " + paths[1] + "\n" +
                 "c" * 64 + "  " + paths[2] + "\n" +
                 "d" * 64 + "  " + paths[3] + "\n" +
                 "e" * 64 + "  " + paths[4] + "\n").encode("ascii")
        with mock.patch.object(mod, "silent_run", return_value=value) as called:
            proof = mod.remote_hashes("user@trusted-host", "/tmp/hosts", 22, paths)
        self.assertEqual(proof, tuple(letter * 64 for letter in "abcde"))
        argv = called.call_args.args[0]
        self.assertEqual(argv[0], "ssh")
        self.assertIn("sha256sum --", argv[-1])
        self.assertNotIn("cat ", argv[-1])
        for corrupt in (
            value[:-1], value + value[:64],
            value.replace(paths[0].encode(), paths[1].encode(), 1),
            value.replace(b"b" * 64, b"z" * 64, 1),
        ):
            with mock.patch.object(mod, "silent_run", return_value=corrupt):
                with self.assertRaises(mod.Blocked):
                    mod.remote_hashes("user@trusted-host", "/tmp/hosts", 22, paths)
        with self.assertRaises(mod.Blocked):
            mod.remote_hashes("user@trusted-host", "/tmp/hosts", 22, paths[:4])
        with self.assertRaises(mod.Blocked):
            mod.remote_hashes("user@trusted-host", "/tmp/hosts", 22,
                              (*paths[:4], paths[3]))

    def test_approved_runtime_proof_is_only_local_and_never_an_apply_grant(self):
        config = mod.validate_approved_runtime((
            "--require-approved-runtime", "a" * 64, "b" * 64,
            "/home/u/approval.json", "/home/u/approval.sig",
            "/home/u/public.pem", "c" * 64,
            "ghcr.io/lazyxu/caddy@sha256:" + "d" * 64,
        ), "/home/u/caddy-rescue-primary-state-witness.py")
        good = (
            b"approved-rescue-runtime-local-phase: primary-down\n"
            b"operator-pinned-signature-and-deployed-image: matched-within-same-local-window\n"
            b"server-rescue-current-generation: consistent-local\n"
            b"public-https-restore-and-caddy-apply-rollback: blocked\n"
        )
        with mock.patch.object(mod, "silent_run", return_value=good) as called:
            mod.remote_approved_runtime(
                "user@host", "/tmp/hosts", 22, config, "primary-down",
                "/home/u/config/.env", "/home/u/config/compose.yml")
        cmd = called.call_args.args[0][-1]
        self.assertIn("caddy-rescue-approved-runtime-check.py", cmd)
        self.assertIn("primary-down", cmd)
        self.assertNotIn("docker restart", cmd)
        self.assertNotIn("apply-and-restart", cmd)
        for denied in (
            good.replace(b"matched-within-same-local-window", b"unverified"),
            good.replace(b"blocked", b"allowed"),
            b"approved-rescue-runtime-local-phase: primary-down\n",
        ):
            with mock.patch.object(mod, "silent_run", return_value=denied):
                with self.assertRaises(mod.Blocked):
                    mod.remote_approved_runtime(
                        "user@host", "/tmp/hosts", 22, config, "primary-down",
                        "/home/u/config/.env", "/home/u/config/compose.yml")

    def test_approved_phase_fences_signed_inputs_before_after_and_across_four_phases(self):
        stable = tuple(k * 64 for k in "abcde")
        other = tuple(k * 64 for k in "abcdz")
        events = []
        def read():
            events.append("pin-inputs")
            return stable
        def signed(phase):
            events.append("signed:" + phase)
        def sample(phase):
            events.append("snapshot:" + phase)
            return {"phase": phase, "apply_supported": False}
        first, anchored = mod.approved_phase("before", read, signed, sample, None)
        self.assertEqual(first["phase"], "before")
        self.assertEqual(anchored, stable)
        self.assertEqual(events, ["pin-inputs", "signed:before", "pin-inputs",
                                  "snapshot:before", "pin-inputs"])
        events.clear()
        next_sample, next_anchor = mod.approved_phase(
            "primary-down", read, signed, sample, stable)
        self.assertEqual((next_sample["phase"], next_anchor),
                         ("primary-down", stable))
        self.assertEqual(len(events), 5)
        events.clear()
        with self.assertRaises(mod.Blocked):
            mod.approved_phase("restored", lambda: other, signed, sample, stable)
        self.assertEqual(events, [])
        for values in ((stable, other, other), (stable, stable, other)):
            seq = iter(values)
            events.clear()
            with self.assertRaises(mod.Blocked):
                mod.approved_phase(
                    "primary-down", lambda: next(seq), signed, sample, stable)
            self.assertTrue(any(event.startswith("signed:") for event in events))
            self.assertTrue(not (events[-1] == "snapshot:primary-down" and
                                  len(events) == 1))


    def test_admin_password_only_anonymous_private_pipe_not_ssh_argv(self):
        import subprocess as sp
        sent = []
        def fake_call(argv, **kwargs):
            sent.append((argv, kwargs))
            return sp.CompletedProcess(argv, 0, stdout=(
                b"rescue-admin-inventory: 11-fixed-services-verified\n"
                b"rescue-independent-ssh-stdio-channel: authenticated-current-session\n"
                b"caddy-apply-stop-restart: blocked\n"), stderr=b"")
        with mock.patch.object(mod.Path, "is_file", return_value=True), \
             mock.patch("builtins.input", return_value="valid-user"), \
             mock.patch.object(mod.getpass, "getpass", return_value="NEVER_PRINT_SECRET"), \
             mock.patch.object(mod.subprocess, "run", side_effect=fake_call):
            mod.off_host_login("user@host", "/tmp/hosts", "3080", "2222")
        self.assertEqual(len(sent), 1)
        args, opts = sent[0]
        self.assertNotIn("NEVER_PRINT_SECRET", " ".join(args))
        self.assertNotIn("valid-user", " ".join(args))
        self.assertEqual(opts["input"], b"valid-user\nNEVER_PRINT_SECRET\n")
        self.assertEqual(opts["stderr"], sp.DEVNULL)

    def test_noninteractive_orchestration_refuses_to_start(self):
        result = subprocess.run([sys.executable, str(SCRIPT)],
                                capture_output=True, text=True, timeout=4,
                                input="\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("blocked", result.stderr)
        self.assertNotIn("docker", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
