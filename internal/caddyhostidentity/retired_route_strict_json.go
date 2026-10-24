package caddyhostidentity

import (
	"bytes"
	"encoding/json"
	"io"
)

// A digest of ambiguous JSON is not a trustworthy description of the active
// routing semantics: different parsers or versions could select different
// duplicate "apps", "servers", "routes" or "host" fields. Fail closed on
// ANY duplicate key, even inside a nested configuration module, and cap depth.
func privateHasUnambiguousCaddyJSON(raw []byte) bool {
	if len(raw) == 0 || len(raw) > maxHostPrivateRouteJSON {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := privateWalkCaddyJSON(decoder, 0); err != nil {
		return false
	}
	_, err := decoder.Token()
	return err == io.EOF
}

func privateWalkCaddyJSON(decoder *json.Decoder, depth int) error {
	if depth > 48 {
		return errUntrusted
	}
	token, err := decoder.Token()
	if err != nil {
		return errUntrusted
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return errUntrusted
			}
			key, ok := keyToken.(string)
			if !ok {
				return errUntrusted
			}
			if _, exists := seen[key]; exists {
				return errUntrusted
			}
			seen[key] = struct{}{}
			if privateWalkCaddyJSON(decoder, depth+1) != nil {
				return errUntrusted
			}
		}
		close, err := decoder.Token()
		if err != nil || close != json.Delim('}') {
			return errUntrusted
		}
	case '[':
		for decoder.More() {
			if privateWalkCaddyJSON(decoder, depth+1) != nil {
				return errUntrusted
			}
		}
		close, err := decoder.Token()
		if err != nil || close != json.Delim(']') {
			return errUntrusted
		}
	default:
		return errUntrusted
	}
	return nil
}
