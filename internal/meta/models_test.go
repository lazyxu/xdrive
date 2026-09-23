package meta

import "testing"

func TestValidateName(t *testing.T) {
	valid := []string{"report.pdf", "项目数据", "hello world.txt"}
	for _, name := range valid {
		if err := ValidateName(name); err != nil {
			t.Fatalf("%q: %v", name, err)
		}
	}
	invalid := []string{"", "..", "a/b", "bad*name", "CON", "LPT1.txt", "trail. "}
	for _, name := range invalid {
		if err := ValidateName(name); err == nil {
			t.Fatalf("expected %q to be invalid", name)
		}
	}
}
