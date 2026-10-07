package media

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	RelationEvidenceVersion = 1

	xmpMMNamespace = "http://ns.adobe.com/xap/1.0/mm/"
	stRefNamespace = "http://ns.adobe.com/xap/1.0/sType/ResourceRef#"
	gpanoNamespace = "http://ns.google.com/photos/1.0/panorama/"
	xmpJPEGHeader  = "http://ns.adobe.com/xap/1.0/\x00"
)

type RelationEvidence struct {
	ImageUniqueID                    string `json:"image_unique_id,omitempty"`
	AppleBurstUUID                   string `json:"apple_burst_uuid,omitempty"`
	XMPDocumentID                    string `json:"xmp_document_id,omitempty"`
	XMPOriginalDocumentID            string `json:"xmp_original_document_id,omitempty"`
	XMPDerivedFromDocumentID         string `json:"xmp_derived_from_document_id,omitempty"`
	XMPDerivedFromOriginalDocumentID string `json:"xmp_derived_from_original_document_id,omitempty"`
}

func DecodeRelationEvidence(raw string) (RelationEvidence, error) {
	var out RelationEvidence
	if strings.TrimSpace(raw) == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return RelationEvidence{}, err
	}
	out.normalize()
	return out, nil
}

func encodeRelationEvidence(value RelationEvidence) string {
	value.normalize()
	if value.empty() {
		return ""
	}
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func (e *RelationEvidence) merge(other RelationEvidence) {
	if e == nil {
		return
	}
	other.normalize()
	if e.ImageUniqueID == "" {
		e.ImageUniqueID = other.ImageUniqueID
	}
	if e.AppleBurstUUID == "" {
		e.AppleBurstUUID = other.AppleBurstUUID
	}
	if e.XMPDocumentID == "" {
		e.XMPDocumentID = other.XMPDocumentID
	}
	if e.XMPOriginalDocumentID == "" {
		e.XMPOriginalDocumentID = other.XMPOriginalDocumentID
	}
	if e.XMPDerivedFromDocumentID == "" {
		e.XMPDerivedFromDocumentID = other.XMPDerivedFromDocumentID
	}
	if e.XMPDerivedFromOriginalDocumentID == "" {
		e.XMPDerivedFromOriginalDocumentID = other.XMPDerivedFromOriginalDocumentID
	}
}

func (e *RelationEvidence) normalize() {
	if e == nil {
		return
	}
	e.ImageUniqueID = normalizeRelationIdentifier(e.ImageUniqueID)
	e.AppleBurstUUID = normalizeRelationIdentifier(e.AppleBurstUUID)
	e.XMPDocumentID = normalizeRelationIdentifier(e.XMPDocumentID)
	e.XMPOriginalDocumentID = normalizeRelationIdentifier(e.XMPOriginalDocumentID)
	e.XMPDerivedFromDocumentID = normalizeRelationIdentifier(e.XMPDerivedFromDocumentID)
	e.XMPDerivedFromOriginalDocumentID = normalizeRelationIdentifier(e.XMPDerivedFromOriginalDocumentID)
}

func (e RelationEvidence) empty() bool {
	return e.ImageUniqueID == "" &&
		e.AppleBurstUUID == "" &&
		e.XMPDocumentID == "" &&
		e.XMPOriginalDocumentID == "" &&
		e.XMPDerivedFromDocumentID == "" &&
		e.XMPDerivedFromOriginalDocumentID == ""
}

func normalizeRelationIdentifier(value string) string {
	value = strings.TrimFunc(value, func(r rune) bool {
		return r == 0 || unicode.IsSpace(r)
	})
	if value == "" || len([]byte(value)) > 512 || !utf8.ValidString(value) {
		return ""
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return ""
		}
	}
	return value
}

func parseXMPRelationEvidence(data []byte) RelationEvidence {
	var out RelationEvidence
	data = bytes.TrimSpace(data)
	if len(data) == 0 || len(data) > maxEmbeddedMetadataBytes {
		return out
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	type element struct {
		name  xml.Name
		depth int
	}
	var stack []element
	depth := 0
	derivedDepth := 0
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			depth++
			stack = append(stack, element{name: value.Name, depth: depth})
			if value.Name.Space == xmpMMNamespace && value.Name.Local == "DerivedFrom" {
				derivedDepth = depth
			}
			for _, attr := range value.Attr {
				text := normalizeRelationIdentifier(attr.Value)
				if text == "" {
					continue
				}
				switch {
				case attr.Name.Space == xmpMMNamespace && attr.Name.Local == "DocumentID" && derivedDepth == 0:
					out.XMPDocumentID = firstRelationValue(out.XMPDocumentID, text)
				case attr.Name.Space == xmpMMNamespace && attr.Name.Local == "OriginalDocumentID" && derivedDepth == 0:
					out.XMPOriginalDocumentID = firstRelationValue(out.XMPOriginalDocumentID, text)
				case derivedDepth > 0 && attr.Name.Space == stRefNamespace && attr.Name.Local == "documentID":
					out.XMPDerivedFromDocumentID = firstRelationValue(out.XMPDerivedFromDocumentID, text)
				case derivedDepth > 0 && attr.Name.Space == stRefNamespace && attr.Name.Local == "originalDocumentID":
					out.XMPDerivedFromOriginalDocumentID = firstRelationValue(out.XMPDerivedFromOriginalDocumentID, text)
				}
			}
		case xml.CharData:
			if len(stack) == 0 {
				continue
			}
			current := stack[len(stack)-1]
			text := normalizeRelationIdentifier(string(value))
			if text == "" {
				continue
			}
			switch {
			case current.name.Space == xmpMMNamespace && current.name.Local == "DocumentID" && derivedDepth == 0:
				out.XMPDocumentID = firstRelationValue(out.XMPDocumentID, text)
			case current.name.Space == xmpMMNamespace && current.name.Local == "OriginalDocumentID" && derivedDepth == 0:
				out.XMPOriginalDocumentID = firstRelationValue(out.XMPOriginalDocumentID, text)
			case derivedDepth > 0 && current.name.Space == stRefNamespace && current.name.Local == "documentID":
				out.XMPDerivedFromDocumentID = firstRelationValue(out.XMPDerivedFromDocumentID, text)
			case derivedDepth > 0 && current.name.Space == stRefNamespace && current.name.Local == "originalDocumentID":
				out.XMPDerivedFromOriginalDocumentID = firstRelationValue(out.XMPDerivedFromOriginalDocumentID, text)
			}
		case xml.EndElement:
			if derivedDepth == depth {
				derivedDepth = 0
			}
			if len(stack) != 0 {
				stack = stack[:len(stack)-1]
			}
			if depth > 0 {
				depth--
			}
		}
	}
	out.normalize()
	return out
}

func firstRelationValue(current, candidate string) string {
	if current != "" {
		return current
	}
	return candidate
}

func parseXMPMediaFields(data []byte) map[string]any {
	out := map[string]any{}
	data = bytes.TrimSpace(data)
	if len(data) == 0 || len(data) > maxEmbeddedMetadataBytes {
		return out
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var current xml.Name
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			current = value.Name
			for _, attr := range value.Attr {
				if attr.Name.Space == gpanoNamespace {
					setGPanoMediaField(out, attr.Name.Local, attr.Value)
				}
			}
		case xml.CharData:
			if current.Space == gpanoNamespace {
				setGPanoMediaField(out, current.Local, string(value))
			}
		case xml.EndElement:
			current = xml.Name{}
		}
	}
	return out
}

func setGPanoMediaField(out map[string]any, name, raw string) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return
	}
	switch name {
	case "ProjectionType":
		out["gpano_projection_type"] = value
		out["is_panorama"] = true
	case "UsePanoramaViewer":
		if strings.EqualFold(value, "true") || value == "1" {
			out["gpano_use_panorama_viewer"] = true
			out["is_panorama"] = true
		}
	}
}

func readJPEGXMPMediaFields(r io.ReadSeeker) map[string]any {
	out := map[string]any{}
	if r == nil {
		return out
	}
	if _, err := r.Seek(2, io.SeekStart); err != nil {
		return out
	}
	for {
		var marker [2]byte
		if _, err := io.ReadFull(r, marker[:]); err != nil {
			return out
		}
		if marker[0] != 0xff {
			return out
		}
		for marker[1] == 0xff {
			if _, err := io.ReadFull(r, marker[1:2]); err != nil {
				return out
			}
		}
		if marker[1] == 0xd9 || marker[1] == 0xda {
			return out
		}
		if marker[1] >= 0xd0 && marker[1] <= 0xd7 {
			continue
		}
		var lengthBytes [2]byte
		if _, err := io.ReadFull(r, lengthBytes[:]); err != nil {
			return out
		}
		payloadLength := int(binary.BigEndian.Uint16(lengthBytes[:])) - 2
		if payloadLength < 0 || payloadLength > maxEmbeddedMetadataBytes {
			return out
		}
		if marker[1] == 0xe1 && payloadLength >= len(xmpJPEGHeader) {
			payload := make([]byte, payloadLength)
			if _, err := io.ReadFull(r, payload); err != nil {
				return out
			}
			if bytes.HasPrefix(payload, []byte(xmpJPEGHeader)) {
				for key, value := range parseXMPMediaFields(payload[len(xmpJPEGHeader):]) {
					out[key] = value
				}
			}
			continue
		}
		if _, err := r.Seek(int64(payloadLength), io.SeekCurrent); err != nil {
			return out
		}
	}
}

func readJPEGXMPRelationEvidence(r io.ReadSeeker) RelationEvidence {
	var out RelationEvidence
	if r == nil {
		return out
	}
	if _, err := r.Seek(2, io.SeekStart); err != nil {
		return out
	}
	for {
		var marker [2]byte
		if _, err := io.ReadFull(r, marker[:]); err != nil {
			return out
		}
		if marker[0] != 0xff {
			return out
		}
		for marker[1] == 0xff {
			if _, err := io.ReadFull(r, marker[1:2]); err != nil {
				return out
			}
		}
		if marker[1] == 0xd9 || marker[1] == 0xda {
			return out
		}
		if marker[1] >= 0xd0 && marker[1] <= 0xd7 {
			continue
		}
		var lengthBytes [2]byte
		if _, err := io.ReadFull(r, lengthBytes[:]); err != nil {
			return out
		}
		payloadLength := int(binary.BigEndian.Uint16(lengthBytes[:])) - 2
		if payloadLength < 0 || payloadLength > maxEmbeddedMetadataBytes {
			return out
		}
		if marker[1] == 0xe1 && payloadLength >= len(xmpJPEGHeader) {
			payload := make([]byte, payloadLength)
			if _, err := io.ReadFull(r, payload); err != nil {
				return out
			}
			if bytes.HasPrefix(payload, []byte(xmpJPEGHeader)) {
				out.merge(parseXMPRelationEvidence(payload[len(xmpJPEGHeader):]))
			}
			continue
		}
		if _, err := r.Seek(int64(payloadLength), io.SeekCurrent); err != nil {
			return out
		}
	}
}
