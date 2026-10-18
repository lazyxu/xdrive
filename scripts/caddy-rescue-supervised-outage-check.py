#!/usr/bin/env python3
"""Off-host, operator-supervised READ-ONLY Caddy outage/rescue continuity check.

Run on a separately trusted operator workstation. Another operator performs
physical stop/restore OUTSIDE this program. This program cannot stop/restart
Caddy, grant Host Apply, or issue a production rollout receipt.
"""
import datetime as dt
import getpass
import importlib.util
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time

PROTOCOL = "xdrive.caddy.rescue.primary-phase-readonly.v1"
PHASES = ("before", "primary-down", "primary-down", "restored")
HEX = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
OCI = re.compile(r"[a-z0-9][a-z0-9./:_-]{2,180}@sha256:[0-9a-f]{64}\Z", re.ASCII)
TARGET = re.compile(r"[A-Za-z_][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,252}\Z")
PATH = re.compile(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\Z")
FIELDS = frozenset((
    "protocol", "phase", "observed_at_utc", "project_sha256",
    "primary_id_sha256", "primary_started_at", "primary_finished_at",
    "server_generation_sha256", "rescue_generation_sha256", "apply_supported",
))


class Blocked(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Blocked(reason)


def sibling_module(name):
    file = Path(__file__).with_name(name)
    spec = importlib.util.spec_from_file_location("xdrive_caddy_operator_ssh", file)
    require(spec is not None and spec.loader is not None, "Trusted SSH helper unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def remote_path(raw, basename=None):
    require(isinstance(raw, str) and 1 < len(raw) <= 256 and bool(PATH.fullmatch(raw))
            and all(segment not in (".", "..") for segment in raw.split("/"))
            and (basename is None or raw.rsplit("/", 1)[-1] == basename),
            "Unsafe remote witness or deployment path")
    return raw


def key_pair(items):
    value = {}
    for key, content in items:
        require(key not in value, "Duplicate witness field")
        value[key] = content
    return value


def time_utc(value, precise=False):
    require(isinstance(value, str) and len(value) <= 45 and value.endswith("Z"),
            "Invalid Docker generation or observation time")
    try:
        if precise:
            parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
        else:
            require(bool(re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T"
                                      r"[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value)),
                    "Untrusted observation clock")
            parsed = dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=dt.timezone.utc)
    except (ValueError, OverflowError):
        raise Blocked("Invalid Docker generation or observation time") from None
    require(parsed.year >= 2020 and parsed.year < 2100,
            "Out-of-range phase time")
    return parsed


def decode_phase(raw, expected, now=None):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 4096 and raw.endswith(b"\n")
            and raw.count(b"\n") == 1, "Invalid bounded host witness response")
    try:
        decoded = json.loads(raw.decode("ascii"), object_pairs_hook=key_pair)
    except (UnicodeError, ValueError):
        raise Blocked("Malformed read-only host witness") from None
    require(isinstance(decoded, dict) and set(decoded) == FIELDS,
            "Unexpected or missing host-witness evidence")
    require(decoded["protocol"] == PROTOCOL and decoded["phase"] == expected
            and decoded["apply_supported"] is False,
            "Wrong host phase or unsafe apply claim")
    for key in ("project_sha256", "primary_id_sha256", "server_generation_sha256",
                "rescue_generation_sha256"):
        require(type(decoded[key]) is str and bool(HEX.fullmatch(decoded[key])),
                "Untrusted hashed container identity")
    observed = time_utc(decoded["observed_at_utc"])
    time_utc(decoded["primary_started_at"], precise=True)
    finished = decoded["primary_finished_at"]
    require(isinstance(finished, str) and
            (finished == "" if expected != "primary-down"
             else bool(finished) and bool(time_utc(finished, precise=True))),
            "Primary stopped/running generation not verified")
    now = now or dt.datetime.now(dt.timezone.utc)
    require(abs((now - observed).total_seconds()) <= 90,
            "Remote observation clock not contemporaneous")
    return decoded


def validate_sequence(records):
    require(isinstance(records, list) and len(records) == 4,
            "Four independently observed phases required")
    require([r["phase"] for r in records] == list(PHASES),
            "Outage phase order invalid")
    first = records[0]
    for receipt in records:
        for key in ("project_sha256", "primary_id_sha256",
                    "server_generation_sha256", "rescue_generation_sha256"):
            require(receipt[key] == first[key],
                    "Current host, server, rescue or primary identity changed")
    observation = [time_utc(row["observed_at_utc"]) for row in records]
    require(all(a <= b for a, b in zip(observation, observation[1:]))
            and 0 <= (observation[-1] - observation[0]).total_seconds() <= 900,
            "Outage observation order or maximum duration invalid")
    original_start = time_utc(first["primary_started_at"], precise=True)
    stopped_1 = time_utc(records[1]["primary_finished_at"], precise=True)
    stopped_2 = time_utc(records[2]["primary_finished_at"], precise=True)
    resumed_start = time_utc(records[3]["primary_started_at"], precise=True)
    require(first["primary_started_at"] == records[1]["primary_started_at"]
            == records[2]["primary_started_at"]
            and records[1]["primary_finished_at"] == records[2]["primary_finished_at"]
            and original_start < stopped_1 == stopped_2 < resumed_start,
            "Primary generation did not show a stable stop and actual restart")
    # Docker lifecycle timestamps have finer precision than these witness stamps.
    grace = dt.timedelta(seconds=1)
    require(observation[0] <= stopped_1 <= observation[1] + grace
            and observation[2] < resumed_start <= observation[3] + grace,
            "Primary stop or recovery was not timed within the witnessed outage")


def validate_options(target, hosts, rescue_port, ssh_port, witness, env, compose,
                     witness_sha, operator_sha):
    require(bool(TARGET.fullmatch(target)) and ".." not in target,
            "Invalid pinned SSH target")
    require(str(rescue_port).isdigit() and 1024 <= int(rescue_port) <= 65535
            and str(ssh_port).isdigit() and 1 <= int(ssh_port) <= 65535,
            "Invalid SSH or rescue port")
    witness = remote_path(witness, "caddy-rescue-primary-state-witness.py")
    env = remote_path(env)
    compose = remote_path(compose)
    operator = witness.rsplit("/", 1)[0] + "/caddy-rescue-operator-check.py"
    require(bool(HEX.fullmatch(witness_sha)) and bool(HEX.fullmatch(operator_sha)),
            "Missing independently pinned witness/checker hashes")
    require(isinstance(hosts, str) and len(hosts) < 4096,
            "Invalid operator SSH trust file")
    return witness, env, compose, operator


def validate_approved_runtime(args, witness):
    """Opt-in approved-image proof; never accept the old review-only signature as Apply.

    The two fixed remote checkers must live beside the already pinned witness,
    and every approval input must be a bounded absolute private host path.
    """
    require(len(args) == 8 and args[0] == "--require-approved-runtime",
            "Complete signed rescue approval parameters are required")
    _, runtime_sha, image_checker_sha, manifest, signature, public_key, key_pin, image = args
    require(all(isinstance(v, str) and bool(HEX.fullmatch(v))
                for v in (runtime_sha, image_checker_sha, key_pin)),
            "Unsigned or unpinned Rescue verification input")
    require(isinstance(image, str) and bool(OCI.fullmatch(image)) and ".." not in image,
            "Operator-approved Rescue image must be a fixed digest")
    root = witness.rsplit("/", 1)[0]
    return {
        "runtime": root + "/caddy-rescue-approved-runtime-check.py",
        "runtime_sha": runtime_sha,
        "image_checker": root + "/caddy-rescue-image-approval-check.py",
        "image_checker_sha": image_checker_sha,
        "manifest": remote_path(manifest),
        "signature": remote_path(signature),
        "public_key": remote_path(public_key),
        "key_pin": key_pin,
        "image": image,
    }


def build_ssh(target, pinned_hosts, ssh_port, tokens):
    # Fixed pinned OpenSSH identity; remote shell command is only quoted tokens.
    return [
        "ssh", "-F", "/dev/null", "-T",
        "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "UpdateHostKeys=no", "-o", "GlobalKnownHostsFile=/dev/null",
        "-o", "UserKnownHostsFile=" + str(pinned_hosts),
        "-o", "ControlMaster=no", "-o", "ControlPath=none",
        "-o", "ForwardAgent=no", "-o", "ForwardX11=no",
        "-o", "PermitLocalCommand=no", "-o", "ProxyCommand=none",
        "-o", "ConnectTimeout=8", "-p", str(ssh_port), "--", target,
        shlex.join(tokens),
    ]


def silent_run(args, seconds, limit=4096, stdin=subprocess.DEVNULL):
    try:
        result = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=seconds,
                                check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Independent read-only SSH verification unavailable") from None
    require(result.returncode == 0 and len(result.stdout) <= limit,
            "Independent read-only SSH verification blocked")
    return result.stdout


def check_remote_pin(target, hosts, port, script, expected):
    output = silent_run(build_ssh(target, hosts, port,
                                  ["sha256sum", "--", script]), 30, 512)
    require(output == (expected + "  " + script + "\n").encode("ascii"),
            "Remote read-only checker digest differs from independent pin")


def remote_hashes(target, hosts, port, files):
    """Read a stable set of remote hashes, never its private bytes."""
    require(isinstance(files, (tuple, list)) and len(files) == 5
            and len(set(files)) == 5, "Five distinct private approval inputs required")
    normalized = [remote_path(path) for path in files]
    output = silent_run(build_ssh(target, hosts, port,
                                  ["sha256sum", "--", *normalized]), 35, 2048)
    rows = output.splitlines(keepends=True)
    require(len(rows) == len(normalized), "Incomplete private approval SHA evidence")
    values = []
    for item, path in zip(rows, normalized):
        expected = b"  " + path.encode("ascii") + b"\n"
        require(item.endswith(expected), "Private approval hash path mismatch")
        value = item[:len(item) - len(expected)]
        require(bool(re.fullmatch(rb"[0-9a-f]{64}", value)),
                "Invalid private approval hash")
        values.append(value.decode("ascii"))
    return tuple(values)


def remote_approved_runtime(target, hosts, port, approved, stage, env, compose):
    command = [
        "python3", "-I", approved["runtime"], stage, env, compose,
        approved["manifest"], approved["signature"], approved["public_key"],
        approved["key_pin"], approved["image"],
    ]
    result = silent_run(build_ssh(target, hosts, port, command), 180, 8192)
    require(
        ("approved-rescue-runtime-local-phase: " + stage + "\n").encode() in result
        and b"operator-pinned-signature-and-deployed-image: matched-within-same-local-window\n" in result
        and b"server-rescue-current-generation: consistent-local\n" in result
        and b"public-https-restore-and-caddy-apply-rollback: blocked\n" in result,
        "Operator-signed immutable Rescue runtime not proven in this phase",
    )


def approved_phase(stage, read_fingerprints, verify_signed_runtime,
                   observe_phase, anchored):
    """Fence approved inputs before/proof/after, throughout the one outage."""
    first = read_fingerprints()
    require(isinstance(first, tuple) and len(first) == 5
            and all(type(x) is str and bool(HEX.fullmatch(x)) for x in first),
            "Missing complete signed Rescue input evidence")
    require(anchored is None or first == anchored,
            "Signed Rescue inputs changed between outage phases")
    verify_signed_runtime(stage)
    require(read_fingerprints() == first,
            "Signed Rescue inputs changed during local approved-runtime proof")
    receipt = observe_phase(stage)
    require(read_fingerprints() == first,
            "Signed Rescue inputs changed during remote primary observation")
    return receipt, first


def remote_observe(target, hosts, port, witness, env, compose, stage):
    return silent_run(build_ssh(target, hosts, port,
                                ["python3", "-I", witness, "--json", stage, env, compose]),
                      130, 4096)


def off_host_login(target, hosts, rescue_port, ssh_port):
    helper = Path(__file__).with_name("caddy-rescue-ssh-auth-check.py")
    require(helper.is_file(), "Local pinned rescue administrator checker unavailable")
    # Never pass credentials via argv, environment variables, disk or logs.
    username = input("Rescue 管理员用户名：")
    password = getpass.getpass("Rescue 管理员密码（不回显）：")
    require(0 < len(username.encode("utf-8")) <= 128
            and 0 < len(password.encode("utf-8")) <= 2048
            and all(ord(c) >= 32 and c not in "\r\n" for c in username + password),
            "Invalid administrator credential")
    credentials = (username + "\n" + password + "\n").encode("utf-8")
    del password
    try:
        outcome = subprocess.run(
            [sys.executable, str(helper), target, str(hosts),
             str(rescue_port), str(ssh_port)], input=credentials,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=150, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Independent rescue login check unavailable") from None
    finally:
        del credentials
    require(outcome.returncode == 0 and len(outcome.stdout) <= 8192,
            "Independent rescue administrator login not verified")
    output = outcome.stdout
    require(b"rescue-admin-inventory: 11-fixed-services-verified\n" in output
            and b"rescue-independent-ssh-stdio-channel: authenticated-current-session\n" in output
            and b"caddy-apply-stop-restart: blocked\n" in output,
            "Live off-host rescue administrator login not demonstrated")


def supervised_sequence(observe, authenticate, confirm):
    records = [observe("before")]
    confirm("请由另一位运维人员安全停止主 Caddy；确认已停止后按回车进行只读检查：")
    records.append(observe("primary-down"))
    print("主 Caddy 已观测为停止。现在通过独立 SSH Rescue 验证管理员会话。")
    authenticate()
    records.append(observe("primary-down"))
    confirm("请由运维人员恢复主 Caddy，并核验其健康状态；完成后按回车：")
    records.append(observe("restored"))
    validate_sequence(records)
    return records


def check():
    require(len(sys.argv) in (10, 18),
            "Usage: supervised-outage-check.py USER@HOST KNOWN_HOSTS RESCUE_PORT SSH_PORT REMOTE_WITNESS REMOTE_ENV REMOTE_COMPOSE PINNED_WITNESS_SHA256 PINNED_OPERATOR_SHA256 [--require-approved-runtime PINNED_RUNTIME_SHA256 PINNED_IMAGE_CHECKER_SHA256 REMOTE_MANIFEST REMOTE_SIGNATURE REMOTE_PUBKEY INDEPENDENT_DER_KEY_SHA256 APPROVED_OCI_IMAGE_DIGEST]")
    require(sys.stdin.isatty() and sys.stdout.isatty(),
            "Physical outage verification requires a real supervised operator terminal")
    _, target, hosts_file, rescue_port, ssh_port, witness, env, compose, witness_sha, operator_sha = sys.argv[:10]
    witness, env, compose, operator = validate_options(
        target, hosts_file, rescue_port, ssh_port, witness, env, compose, witness_sha, operator_sha)
    approved = validate_approved_runtime(sys.argv[10:], witness) if len(sys.argv) == 18 else None
    ssh = sibling_module("caddy-rescue-ssh-auth-check.py")
    try:
        snapshot = ssh.pinned_known_hosts_bytes(Path(hosts_file).expanduser().absolute())
    except (OSError, ssh.Blocked):
        raise Blocked("Trusted pinned SSH host keys cannot be loaded") from None
    with tempfile.TemporaryDirectory(prefix="xdrive-caddy-supervised-rescue-") as directory:
        hosts = Path(directory) / "known_hosts"
        hosts.write_bytes(snapshot)
        hosts.chmod(0o600)
        start = time.monotonic()
        anchored = None
        def observe(stage):
            nonlocal anchored
            check_remote_pin(target, hosts, ssh_port, witness, witness_sha)
            check_remote_pin(target, hosts, ssh_port, operator, operator_sha)
            if approved:
                check_remote_pin(target, hosts, ssh_port,
                                 approved["runtime"], approved["runtime_sha"])
                check_remote_pin(target, hosts, ssh_port,
                                 approved["image_checker"], approved["image_checker_sha"])
                def read_inputs():
                    return remote_hashes(
                        target, hosts, ssh_port,
                        (env, compose, approved["manifest"],
                         approved["signature"], approved["public_key"]),
                    )
                def signed(stage_name):
                    remote_approved_runtime(target, hosts, ssh_port, approved,
                                            stage_name, env, compose)
                def original(stage_name):
                    return decode_phase(remote_observe(
                        target, hosts, ssh_port, witness, env, compose, stage_name
                    ), stage_name)
                record, anchored = approved_phase(
                    stage, read_inputs, signed, original, anchored)
                # Recheck fixed scripts after running the remote local checker
                # so even same-window script substitution cannot silently pass.
                check_remote_pin(target, hosts, ssh_port, witness, witness_sha)
                check_remote_pin(target, hosts, ssh_port, operator, operator_sha)
                check_remote_pin(target, hosts, ssh_port,
                                 approved["runtime"], approved["runtime_sha"])
                check_remote_pin(target, hosts, ssh_port,
                                 approved["image_checker"], approved["image_checker_sha"])
            else:
                data = remote_observe(target, hosts, ssh_port, witness, env, compose, stage)
                record = decode_phase(data, stage)
            require(time.monotonic() - start <= 900,
                    "Supervised outage exceeded the observation window")
            return record
        supervised_sequence(
            observe,
            lambda: off_host_login(target, hosts, rescue_port, ssh_port),
            input,
        )
        require(time.monotonic() - start <= 900,
                "Supervised verification exceeded the allowed duration")
        print("supervised-primary-outage: sampled-before-down-down-restored")
        print("off-host-pinned-ssh-admin: verified-between-two-down-samples")
        print("server-and-rescue-generations: unchanged-across-samples")
        print("signed-rescue-runtime-across-phases: " +
              ("observed-approved-local-per-phase" if approved else "not-checked"))
        print("cross-phase-observation: consistent-readonly-unapplied")
        print("outage-continuous-between-samples: unverified")
        print("physical-network-other-clients-and-public-https: unverified")
        print("caddy-apply-stop-restart: blocked")
        print("apply_supported: false")


if __name__ == "__main__":
    try:
        check()
    except (Blocked, KeyboardInterrupt, EOFError, OSError, UnicodeError) as err:
        reason = str(err) if isinstance(err, Blocked) else "Supervised observation interrupted"
        print("caddy-supervised-outage-check: blocked (" + reason + ")", file=sys.stderr)
        sys.exit(1)
