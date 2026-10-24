package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMediaBaiduJSAPI4ReleaseStrictTransport(t *testing.T) {
	good := `{"provider":"baidu-jsapi-4.0","enabled":true,"activation_state":"authorized_signed_release","attribution":"© 百度地图","isolated_child_origin":"https://map-isolated.example.org"}`
	var accepted MediaBaiduJSAPI4Release
	if err := json.Unmarshal([]byte(good), &accepted); err != nil || !accepted.ValidForTransport() {
		t.Fatalf("signed release denied: %v", err)
	}
	invalid := []string{
		strings.Replace(good, `"enabled":true`, `"enabled":false`, 1),
		strings.Replace(good, `"enabled":true,`, "", 1),
		strings.Replace(good, `"enabled":true`, `"enabled":null`, 1),
		strings.Replace(good, `"enabled":true`, `"enabled":"true"`, 1),
		strings.Replace(good, `"provider":"baidu-jsapi-4.0"`, `"provider":"other"`, 1),
		strings.Replace(good, `"activation_state":"authorized_signed_release"`, `"activation_state":"blocked_pending_licence_and_proxy"`, 1),
		strings.Replace(good, `"isolated_child_origin":"https://map-isolated.example.org"`, `"isolated_child_origin":""`, 1),
		strings.Replace(good, `"isolated_child_origin":"https://map-isolated.example.org"`, `"isolated_child_origin":"http://map-isolated.example.org"`, 1),
		strings.Replace(good, `"isolated_child_origin":"https://map-isolated.example.org"`, `"isolated_child_origin":"https://evil.example@map-isolated.example.org"`, 1),
		strings.Replace(good, `"isolated_child_origin":"https://map-isolated.example.org"`, `"isolated_child_origin":"https://map-isolated.example.org/path"`, 1),
		strings.Replace(good, `"isolated_child_origin":"https://map-isolated.example.org"`, `"isolated_child_origin":"https://map-isolated.example.org?token=1"`, 1),
		strings.Replace(good, `"attribution":"© 百度地图"`, `"attribution":"xDrive"`, 1),
		strings.Replace(good, `"provider":"baidu-jsapi-4.0"`, `"provider":"baidu-jsapi-4.0","owner_id":42`, 1),
		strings.Replace(good, `"provider":"baidu-jsapi-4.0"`, `"provider":"baidu-jsapi-4.0","jwt":"secret"`, 1),
		strings.Replace(good, `"provider":"baidu-jsapi-4.0"`, `"provider":"baidu-jsapi-4.0","latitude":35.1`, 1),
	}
	for _, input := range invalid {
		var bad MediaBaiduJSAPI4Release
		if err := json.Unmarshal([]byte(input), &bad); err == nil {
			t.Fatalf("invalid signed release accepted: %s", input)
		}
	}
}
