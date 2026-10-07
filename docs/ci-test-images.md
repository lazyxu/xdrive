# CI test-image and bind-mount contract

This document is normative for Docker/container images whose purpose is to run xDrive tests, integration checks, E2E harnesses, or benchmarks.

The goal is to keep the test environment stable while allowing the code under test to change cheaply:

```text
stable runtime image
  + bind-mounted current checkout business code
  + bind-mounted tests/scripts
  + explicit writable output/cache/runtime mounts
  = test execution
```

A normal xDrive source-code or test-code change must not require rebuilding a materially different test image.

## 1. Default rule

For an ordinary containerized test, the Docker image is a **runtime/toolchain image**, not an image of the current xDrive source tree.

The reusable image may contain stable inputs such as:

- the base operating-system image;
- system packages and native libraries;
- language runtimes and package managers;
- dependencies resolved from lockfiles/manifests when the image is intentionally the dependency cache boundary;
- stable third-party runtime assets or ML models that are not xDrive business source;
- test utilities that are part of the environment rather than the code being tested.

The reusable image should not contain mutable xDrive business implementation or test source merely so the test can execute.

At runtime, CI mounts the checked-out repository content needed by the test. Prefer read-only mounts for source, tests, and scripts. Add separate writable mounts only for declared output, cache, socket, temporary, or runtime-state directories.

Example shape:

```bash
docker run --rm \
  --mount type=bind,src="$PWD/services/photo-face-analyzer",dst=/workspace,readonly \
  --mount type=bind,src="$PWD/dist",dst=/out \
  xdrive/photo-face-test-runtime:<runtime-contract-version> \
  python -m unittest discover -s /workspace/tests -v
```

The exact paths and command may differ by subsystem, but the ownership boundary must remain the same: **environment in the image; current xDrive code through mounts**.

## 2. What must not be added for ordinary tests

Do not introduce a test Docker stage whose normal path does any of the following with frequently changing xDrive source:

```dockerfile
COPY analyzer.py /app/analyzer.py
COPY internal/ /app/internal/
COPY tests/ /app/tests/
RUN python -m unittest ...
RUN go test ...
```

Do not use a commit SHA, source-tree hash, or business-code change as the cache identity for a reusable runtime image.

Do not rebuild the runtime image simply because:

- application source changed;
- a unit/integration test changed;
- a benchmark implementation changed;
- a shell test harness changed;
- generated business binaries changed, when those binaries can be mounted as test inputs.

Those inputs belong to the test invocation, not the runtime-image layer.

## 3. When the runtime image is allowed to rebuild

Rebuild or version the reusable test image when the **environment contract** changes, including changes to:

- base image or operating-system version;
- apt/apk/yum packages;
- Go/Node/Python/Java or other runtime/toolchain versions;
- Python/npm/system/native dependency manifests used to populate the environment image;
- native shared libraries;
- browser/runtime packages needed by the test environment;
- stable ML/runtime models or their fetch/verification contract;
- image entrypoint/helper tooling that belongs to the generic test environment.

The cache key or image tag should therefore be derived from those environment inputs, not from the full repository commit.

## 4. Mount rules

Use the following defaults:

| Input | Default |
| --- | --- |
| xDrive business source | bind mount, read-only |
| test source | bind mount, read-only |
| CI shell scripts used by the test | bind mount, read-only |
| prebuilt artifact being exercised | bind mount, read-only unless the test must mutate a disposable copy |
| output/dist directory | explicit writable bind mount |
| compiler/package cache | explicit writable cache/volume |
| runtime socket/temp/state | explicit writable temporary mount |
| secrets/credentials | inject only through the existing secret boundary; never bake into the image |

Mount only the directories required by the test. Do not solve convenience by mounting host-wide paths or Docker credentials into an application test container.

## 5. Exact-artifact and release-image exception

Tests whose explicit purpose is **Build Once / Test Exact Artifact / Publish Exact Artifact** are different.

When CI validates a final image or installer that may be published:

- use the exact produced artifact/image;
- do not bind-mount business source over packaged business source;
- do not rebuild the artifact inside the test job;
- do not mutate the artifact before publication;
- preserve the existing byte-for-byte handoff from build to test to publish.

Examples include final xDrive Server/Caddy/photo-face release-image validation and exact client installer tests.

If a subsystem needs both kinds of validation, split them:

```text
runtime-mounted source tests
        ↓
build final release artifact once
        ↓
exact-artifact validation
        ↓
publish that exact artifact
```

The fast source-mounted stage proves current behavior in a stable environment. The exact-artifact stage proves packaging/release correctness. One must not impersonate the other.

## 6. Photo Intelligence reference implementation

`scripts/ci/test-photo-face-image.sh` is the reference implementation for this contract.

The `runtime` Docker target contains only the stable Photo Face execution environment: Python, native libraries, pinned Python dependencies, and verified third-party face models. It deliberately contains no `analyzer.py`, no `tests/`, and no commit/version labels.

The ordinary analyzer unit tests, self-test, and benchmark run from that runtime image with `services/photo-face-analyzer` bind-mounted read-only at `/workspace`. A business-source or test-only change therefore does not create a different test-runtime image; Docker can reuse the runtime layers while the mounted checkout supplies the current code.

The `final` Docker target is separate. It packages `analyzer.py`, adds build version/revision labels, runs exact-image self-test/benchmark without source overrides, and is then exported as the release artifact. This preserves **Build Once / Test Exact Artifact / Publish Exact Artifact** while keeping ordinary source tests independent from the release image contents.

Stable OpenCV/native dependencies and verified third-party face models remain in the reusable runtime target because they are runtime dependencies rather than mutable xDrive business source. Changing those inputs is a valid reason to rebuild the runtime layers.

### Current repository audit

As of this migration:

- Photo Face is the only repository-owned Docker test stage that previously copied mutable xDrive business/test source into a test image; it now follows the mounted-code pattern.
- GitLab `golang:1.25-bookworm` and `node:22-bookworm` job images are already stable toolchain environments; GitLab supplies the current checkout in the job workspace.
- PostgreSQL and other third-party CI service images are stable external runtime dependencies rather than xDrive business-code images.
- `xdrive/server:test`, `xdrive/caddy:test`, and the final `xdrive/photo-face:test` image are exact release-artifact candidates despite their local `:test` tag. They intentionally package business code and must not be converted to bind-mounted source validation.

## 7. GitHub/GitLab parity

This contract applies equally to GitHub Actions and GitLab CI.

When adding or changing a containerized test:

1. keep the same runtime-image/source-mount boundary in both providers;
2. update `.github/workflows/ci.yml` and `.gitlab-ci.yml` together when job behavior changes;
3. keep shared image/tool versions centralized under `infra/ci/images.yml` when applicable;
4. preserve `internal/cicontract/ci_parity_test.go` as the executable parity guard;
5. do not let one provider rebuild business-code test images while the other mounts the checkout.

## 8. New-test checklist

Before adding a new containerized test, verify all of the following:

- [ ] The image contains environment/runtime dependencies, not the current xDrive business source tree.
- [ ] Current business source and tests enter through bind mounts.
- [ ] Source/test mounts are read-only unless mutation is explicitly required.
- [ ] Writable output/cache/runtime paths are explicit and narrowly scoped.
- [ ] A source-only change reuses the same runtime image.
- [ ] Runtime-image rebuilds are keyed only by environment-contract inputs.
- [ ] The test does not call `docker build` merely to execute changed business/test code.
- [ ] If this is an exact release-artifact check, it tests the packaged artifact without source overrides.
- [ ] GitHub/GitLab behavior remains equivalent.
- [ ] Any exception is documented in the same change with the reason it cannot use the mounted-code pattern.

## 9. Migration policy

All newly added test-container paths must comply with this document immediately.

Existing test images that bake changing business/test source are considered migration debt. When one of those paths is materially modified, migrate it to this contract rather than extending the old pattern. A dedicated migration may convert several related test images together when that reduces repeated image rebuilds without changing release-artifact semantics.
