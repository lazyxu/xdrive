package media

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func TestParseXMPRelationEvidence(t *testing.T) {
	data := []byte(`<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:stRef="http://ns.adobe.com/xap/1.0/sType/ResourceRef#">
<rdf:Description xmpMM:DocumentID="xmp.did:rendered"
 xmpMM:OriginalDocumentID="xmp.did:original">
 <xmpMM:DerivedFrom>
  <rdf:Description stRef:documentID="xmp.did:source"
   stRef:originalDocumentID="xmp.did:source-original"/>
 </xmpMM:DerivedFrom>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>`)
	got := parseXMPRelationEvidence(data)
	if got.XMPDocumentID != "xmp.did:rendered" ||
		got.XMPOriginalDocumentID != "xmp.did:original" ||
		got.XMPDerivedFromDocumentID != "xmp.did:source" ||
		got.XMPDerivedFromOriginalDocumentID != "xmp.did:source-original" {
		t.Fatalf("evidence=%+v", got)
	}
}

func TestReadJPEGXMPRelationEvidence(t *testing.T) {
	xmp := []byte(`<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
<rdf:Description xmpMM:DocumentID="xmp.did:jpeg"/>
</rdf:RDF></x:xmpmeta>`)
	payload := append([]byte(xmpJPEGHeader), xmp...)
	segment := make([]byte, 4+len(payload))
	segment[0], segment[1] = 0xff, 0xe1
	binary.BigEndian.PutUint16(segment[2:4], uint16(len(payload)+2))
	copy(segment[4:], payload)
	jpeg := append([]byte{0xff, 0xd8}, segment...)
	jpeg = append(jpeg, 0xff, 0xd9)

	got := readJPEGXMPRelationEvidence(bytes.NewReader(jpeg))
	if got.XMPDocumentID != "xmp.did:jpeg" {
		t.Fatalf("evidence=%+v", got)
	}
}

func TestReadJPEGXMPMediaFieldsDetectsConfirmedPanorama(t *testing.T) {
	xmp := []byte(`<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">
<rdf:Description GPano:ProjectionType="equirectangular"
 GPano:UsePanoramaViewer="True"/>
</rdf:RDF></x:xmpmeta>`)
	payload := append([]byte(xmpJPEGHeader), xmp...)
	segment := make([]byte, 4+len(payload))
	segment[0], segment[1] = 0xff, 0xe1
	binary.BigEndian.PutUint16(segment[2:4], uint16(len(payload)+2))
	copy(segment[4:], payload)
	jpeg := append([]byte{0xff, 0xd8}, segment...)
	jpeg = append(jpeg, 0xff, 0xd9)

	fields := readJPEGXMPMediaFields(bytes.NewReader(jpeg))
	if fields["gpano_projection_type"] != "equirectangular" ||
		fields["gpano_use_panorama_viewer"] != true ||
		fields["is_panorama"] != true {
		t.Fatalf("fields=%+v", fields)
	}
}

func TestAppleMakerNoteBurstUUID(t *testing.T) {
	const burst = "E9C7F7C4-4F73-40B8-B394-4D7FE7428E52"
	note := buildAppleMakerNoteStringTag(0x000b, burst)
	if got := appleMakerNoteBurstUUID(note); got != burst {
		t.Fatalf("burst=%q want=%q", got, burst)
	}
}

func TestParseTIFFReadsImageUniqueIDRelationEvidence(t *testing.T) {
	const imageID = "IMAGE-UNIQUE-ID-123"
	exif, err := parseTIFF(buildTIFFWithImageUniqueID(imageID))
	if err != nil {
		t.Fatal(err)
	}
	if exif.Relation.ImageUniqueID != imageID {
		t.Fatalf("image unique id=%q", exif.Relation.ImageUniqueID)
	}
	if got, _ := exif.Fields["image_unique_id"].(string); got != imageID {
		t.Fatalf("EXIF field image_unique_id=%q", got)
	}
}

func TestExtractStandaloneXMPRelationEvidence(t *testing.T) {
	xmp := []byte(`<?xml version="1.0"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:stRef="http://ns.adobe.com/xap/1.0/sType/ResourceRef#">
<rdf:Description>
<xmpMM:DerivedFrom>
<rdf:Description stRef:documentID="xmp.did:target"/>
</xmpMM:DerivedFrom>
</rdf:Description>
</rdf:RDF></x:xmpmeta>`)
	result, err := Extract("edit.xmp", bytes.NewReader(xmp), int64(len(xmp)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindOther {
		t.Fatalf("kind=%q", result.Kind)
	}
	evidence, err := DecodeRelationEvidence(result.RelationJSON)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.XMPDerivedFromDocumentID != "xmp.did:target" {
		t.Fatalf("relation=%+v", evidence)
	}
}

func TestRelationEvidenceDecodeNormalizesAndRejectsControls(t *testing.T) {
	raw := `{"image_unique_id":"  ABC-123  ","apple_burst_uuid":"BAD\u0000ID"}`
	got, err := DecodeRelationEvidence(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.ImageUniqueID != "ABC-123" || got.AppleBurstUUID != "" {
		t.Fatalf("evidence=%+v", got)
	}
}

func buildAppleMakerNoteStringTag(tag uint16, value string) []byte {
	note := append([]byte{}, []byte("Apple iOS\x00")...)
	note = append(note, 0x00, 0x01, 'M', 'M')
	dirOffset := len(note)
	note = append(note, 0x00, 0x01)

	entry := make([]byte, 12)
	binary.BigEndian.PutUint16(entry[0:2], tag)
	binary.BigEndian.PutUint16(entry[2:4], 2)
	binary.BigEndian.PutUint32(entry[4:8], uint32(len(value)+1))
	valueOffset := dirOffset + 2 + 12 + 4
	binary.BigEndian.PutUint32(entry[8:12], uint32(valueOffset))
	note = append(note, entry...)
	note = append(note, 0, 0, 0, 0)
	note = append(note, []byte(value)...)
	note = append(note, 0)
	return note
}

func buildTIFFWithImageUniqueID(imageID string) []byte {
	data := []byte{'M', 'M', 0, 42, 0, 0, 0, 8}
	root := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(root[0:2], 1)
	binary.BigEndian.PutUint16(root[2:4], 0x8769)
	binary.BigEndian.PutUint16(root[4:6], 4)
	binary.BigEndian.PutUint32(root[6:10], 1)
	exifOffset := len(data) + len(root)
	binary.BigEndian.PutUint32(root[10:14], uint32(exifOffset))
	data = append(data, root...)

	exif := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(exif[0:2], 1)
	binary.BigEndian.PutUint16(exif[2:4], 0xa420)
	binary.BigEndian.PutUint16(exif[4:6], 2)
	binary.BigEndian.PutUint32(exif[6:10], uint32(len(imageID)+1))
	valueOffset := len(data) + len(exif)
	binary.BigEndian.PutUint32(exif[10:14], uint32(valueOffset))
	data = append(data, exif...)
	data = append(data, []byte(imageID)...)
	data = append(data, 0)
	return data
}

func TestRelationEvidenceJSONStable(t *testing.T) {
	value := RelationEvidence{
		ImageUniqueID:  "ID",
		AppleBurstUUID: "BURST",
	}
	raw := encodeRelationEvidence(value)
	if !strings.Contains(raw, `"image_unique_id":"ID"`) ||
		!strings.Contains(raw, `"apple_burst_uuid":"BURST"`) {
		t.Fatalf("raw=%q", raw)
	}
}
