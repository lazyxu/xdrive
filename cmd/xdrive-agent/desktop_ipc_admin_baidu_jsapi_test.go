package main

import "testing"

func TestDesktopBaiduJSAPIInputStrictAndSeparateAK(t *testing.T) {
	enabled, disabled := true, false
	rev := uint64(0)
	cases := []struct {
		name  string
		input desktopIPCBaiduJSAPIInput
		valid bool
	}{
		{"configure", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled, Revision: &rev, BrowserAK: "separate-browser-ak"}, true},
		{"disable", desktopIPCBaiduJSAPIInput{DesiredEnabled: &disabled, Revision: &rev}, true},
		{"clear", desktopIPCBaiduJSAPIInput{DesiredEnabled: &disabled, Revision: &rev, ClearAK: true}, true},
		{"missing desired", desktopIPCBaiduJSAPIInput{Revision: &rev}, false},
		{"missing revision", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled}, false},
		{"enable and clear", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled, Revision: &rev, ClearAK: true}, false},
		{"clear and rotate", desktopIPCBaiduJSAPIInput{DesiredEnabled: &disabled, Revision: &rev, ClearAK: true, BrowserAK: "new-key"}, false},
		{"newline", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled, Revision: &rev, BrowserAK: "a\nb"}, false},
		{"non-ASCII", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled, Revision: &rev, BrowserAK: "密钥"}, false},
		{"too long", desktopIPCBaiduJSAPIInput{DesiredEnabled: &enabled, Revision: &rev, BrowserAK: string(make([]byte, 257))}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validDesktopBaiduJSAPIInput(tc.input); got != tc.valid {
				t.Fatalf("valid=%v want=%v", got, tc.valid)
			}
		})
	}
}
