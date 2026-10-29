package cicontract

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func androidWorkflow(t *testing.T) map[string]any {
	t.Helper()
	var workflow map[string]any
	if err := yaml.Unmarshal([]byte(readFile(t, filepath.Join(repositoryRoot(t), ".github", "workflows", "ci.yml"))), &workflow); err != nil {
		t.Fatal(err)
	}
	return workflow
}

func androidJob(workflow map[string]any, name string) map[string]any {
	jobs, _ := workflow["jobs"].(map[string]any)
	job, _ := jobs[name].(map[string]any)
	return job
}

func androidStep(job map[string]any, key, value string) map[string]any {
	steps, _ := job["steps"].([]any)
	for _, raw := range steps {
		step, _ := raw.(map[string]any)
		if step[key] == value {
			return step
		}
	}
	return nil
}

// Validate the parsed job, rather than matching unrelated strings elsewhere in CI.
func validateAndroidWorkflow(workflow map[string]any) error {
	job := androidJob(workflow, "android-native")
	if job == nil || job["runs-on"] != "ubuntu-latest" || job["continue-on-error"] != nil {
		return fmt.Errorf("Android must remain a required hosted Linux job")
	}
	const requiredScope = "needs.pr-scope.outputs.scope == 'full' || needs.pr-scope.outputs.scope == 'android'"
	if job["needs"] != "pr-scope" || job["if"] != requiredScope {
		return fmt.Errorf("Android must run for all master/stable builds and for every Android-only PR")
	}
	scope := androidJob(workflow, "pr-scope")
	if scope == nil || scope["runs-on"] != "ubuntu-latest" || scope["if"] != nil ||
		scope["continue-on-error"] != nil || androidStep(scope, "name", "Classify immutable PR diff; default full") == nil {
		return fmt.Errorf("Android CI scope must be derived from the trusted base and fail closed")
	}
	steps, _ := job["steps"].([]any)
	for _, raw := range steps {
		step, _ := raw.(map[string]any)
		if step["continue-on-error"] != nil || (step["if"] != nil && step["uses"] != "actions/upload-artifact@v4") {
			return fmt.Errorf("Android verification steps cannot skip or ignore failures")
		}
	}
	for _, required := range []struct {
		key, value string
		with       map[string]any
	}{
		{"uses", "actions/checkout@v4", map[string]any{"ref": "${{ github.event.pull_request.head.sha || github.sha }}"}},
		{"uses", "actions/setup-java@v4", map[string]any{"java-version": "17", "distribution": "temurin"}},
		{"uses", "android-actions/setup-android@v3", map[string]any{"packages": "platform-tools"}},
		{"uses", "reactivecircus/android-emulator-runner@v2", map[string]any{
			"api-level": 35, "arch": "x86_64", "target": "google_apis", "working-directory": "android",
			"script": "bash gradlew --no-daemon :app:connectedDebugAndroidTest",
		}},
		{"uses", "actions/upload-artifact@v4", map[string]any{
			"name": "android-native-debug-${{ github.event.pull_request.head.sha || github.sha }}", "if-no-files-found": "error",
		}},
	} {
		step := androidStep(job, required.key, required.value)
		if step == nil {
			return fmt.Errorf("missing Android step %s", required.value)
		}
		with, _ := step["with"].(map[string]any)
		for key, want := range required.with {
			if with[key] != want {
				return fmt.Errorf("Android %s %s=%v, want %v", required.value, key, with[key], want)
			}
		}
	}
	if androidStep(job, "run", "sdkmanager 'platforms;android-35' 'build-tools;35.0.0'") == nil {
		return fmt.Errorf("Android requires SDK 35 and build-tools 35.0.0")
	}
	unit := androidStep(job, "run", "bash gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug")
	if unit == nil || unit["working-directory"] != "android" {
		return fmt.Errorf("Android must use the repository wrapper for unit, lint and debug APK")
	}
	artifact := androidStep(job, "uses", "actions/upload-artifact@v4")
	if artifact["if"] != "always()" {
		return fmt.Errorf("Android reports must be retained even on failure")
	}
	with, _ := artifact["with"].(map[string]any)
	paths, _ := with["path"].(string)
	for _, path := range []string{"android/app/build/outputs/apk/debug/*.apk", "android/app/build/reports/", "android/app/build/outputs/androidTest-results/", "android/core/build/reports/tests/"} {
		if !slices.Contains(strings.Fields(paths), path) {
			return fmt.Errorf("Android artifact missing %s", path)
		}
	}
	gate := androidJob(workflow, "final-gate")
	needs, _ := gate["needs"].([]any)
	if !slices.Contains(needs, any("android-native")) || gate["if"] != "${{ !cancelled() }}" || gate["continue-on-error"] != nil {
		return fmt.Errorf("Final Gate must require Android and cancel when the workflow is cancelled")
	}
	check := androidStep(gate, "name", "Require every applicable CI gate to succeed")
	if check == nil {
		return fmt.Errorf("Final Gate check is missing")
	}
	env, _ := check["env"].(map[string]any)
	run, _ := check["run"].(string)
	if check["if"] != nil || check["continue-on-error"] != nil || env["NEEDS_JSON"] != "${{ toJSON(needs) }}" ||
		env["CI_SCOPE"] != "${{ needs.pr-scope.outputs.scope }}" ||
		!strings.Contains(run, `if [[ "$CI_SCOPE" == full ]]`) ||
		!strings.Contains(run, `echo "$NEEDS_JSON" | jq -e 'all(.[]; .result == "success")' >/dev/null`) ||
		!strings.Contains(run, `accepted(["android-native"])`) ||
		!strings.Contains(run, `else $item.value.result == "skipped" end`) ||
		!strings.HasPrefix(run, "set -euo pipefail\n") || strings.Contains(run, "|| true") {
		return fmt.Errorf("Final Gate must require full CI on master/stable, and actual Android success for scoped PRs")
	}
	return nil
}

func TestAndroidNativeCIContract(t *testing.T) {
	if err := validateAndroidWorkflow(androidWorkflow(t)); err != nil {
		t.Fatal(err)
	}
	// Both test commands use this checksum-pinned wrapper, never ambient Gradle.
	properties := readFile(t, filepath.Join(repositoryRoot(t), "android", "gradle", "wrapper", "gradle-wrapper.properties"))
	for _, line := range []string{
		`distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-bin.zip`,
		`distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`,
		`validateDistributionUrl=true`,
	} {
		if !slices.Contains(strings.Fields(properties), line) {
			t.Errorf("Android wrapper missing pin %s", line)
		}
	}
}

func TestAndroidNativeCIRejectsWeakenedGates(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"unit omitted": func(w map[string]any) {
			androidStep(androidJob(w, "android-native"), "name", "Unit tests, lint and exact debug APK")["run"] = "bash gradlew --no-daemon :app:lintDebug :app:assembleDebug"
		},
		"emulator omitted": func(w map[string]any) {
			androidStep(androidJob(w, "android-native"), "uses", "reactivecircus/android-emulator-runner@v2")["uses"] = "removed"
		},
		"gate dependency omitted": func(w map[string]any) {
			gate := androidJob(w, "final-gate")
			gate["needs"] = slices.DeleteFunc(gate["needs"].([]any), func(v any) bool { return v == "android-native" })
		},
		"job conditional": func(w map[string]any) { androidJob(w, "android-native")["if"] = "false" },
		"unit failure ignored": func(w map[string]any) {
			androidStep(androidJob(w, "android-native"), "name", "Unit tests, lint and exact debug APK")["continue-on-error"] = true
		},
		"wrong source": func(w map[string]any) {
			androidStep(androidJob(w, "android-native"), "uses", "actions/checkout@v4")["with"].(map[string]any)["ref"] = "master"
		},
		"legacy tools": func(w map[string]any) {
			androidStep(androidJob(w, "android-native"), "uses", "android-actions/setup-android@v3")["with"].(map[string]any)["packages"] = "tools platform-tools"
		},
		"gate ignores cancellation": func(w map[string]any) { androidJob(w, "final-gate")["if"] = "always()" },
		"gate accepts failure": func(w map[string]any) {
			androidStep(androidJob(w, "final-gate"), "name", "Require every applicable CI gate to succeed")["run"] = "exit 0"
		},
	} {
		t.Run(name, func(t *testing.T) {
			workflow := androidWorkflow(t)
			mutate(workflow)
			if err := validateAndroidWorkflow(workflow); err == nil {
				t.Fatal("weakened Android gate was accepted")
			}
		})
	}
}
