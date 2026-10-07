package media

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"testing"
)

func TestAVIFTransformOrientationMatchesISOBMFFTransforms(t *testing.T) {
	tests := []struct {
		name         string
		haveRotation bool
		angle        int
		haveMirror   bool
		axis         int
		want         int
	}{
		{name: "normal", want: 1},
		{name: "rotate_90_ccw", haveRotation: true, angle: 1, want: 8},
		{name: "rotate_180", haveRotation: true, angle: 2, want: 3},
		{name: "rotate_90_cw", haveRotation: true, angle: 3, want: 6},
		{name: "mirror_horizontal", haveMirror: true, axis: 1, want: 2},
		{name: "mirror_vertical", haveMirror: true, axis: 0, want: 4},
		{name: "rotate_90_ccw_mirror_horizontal", haveRotation: true, angle: 1, haveMirror: true, axis: 1, want: 7},
		{name: "rotate_90_ccw_mirror_vertical", haveRotation: true, angle: 1, haveMirror: true, axis: 0, want: 5},
		{name: "rotate_180_mirror_horizontal", haveRotation: true, angle: 2, haveMirror: true, axis: 1, want: 4},
		{name: "rotate_180_mirror_vertical", haveRotation: true, angle: 2, haveMirror: true, axis: 0, want: 2},
		{name: "rotate_90_cw_mirror_horizontal", haveRotation: true, angle: 3, haveMirror: true, axis: 1, want: 5},
		{name: "rotate_90_cw_mirror_vertical", haveRotation: true, angle: 3, haveMirror: true, axis: 0, want: 7},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := avifTransformOrientation(
				test.haveRotation,
				test.angle,
				test.haveMirror,
				test.axis,
			); got != test.want {
				t.Fatalf("orientation=%d want=%d", got, test.want)
			}
		})
	}
}

func TestThumbnailJPEGHonorsRealAVIFContainerRotation(t *testing.T) {
	// gen2brain/avif testdata/test_rot.avif (MIT) stores 640x480 pixels and
	// associates irot=3 with the primary image, which is EXIF orientation 6.
	const fixture = "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAOBtZXRhAAAAAAAAACFo" +
		"ZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAA" +
		"Imlsb2MAAAAAREAAAQABAAAAAAEEAAEAAAAAAAAAoQAAACNpaW5mAAAAAAAB" +
		"AAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAYGlwcnAAAABBaXBjbwAAAAxhdjFD" +
		"gURsAAAAABRpc3BlAAAAAAAAAoAAAAHgAAAAEHBpeGkAAAAAAwwMDAAAAAlp" +
		"cm90AwAAABdpcG1hAAAAAAAAAAEAAQSBAgOEAAAAqW1kYXQSAAoKWSYn/vsa" +
		"AhoNwjKQAUSAAOOOOEC1G3sKlYvaVm9zmuFenT+Jbbn7wihWiZQajoFIfo9f" +
		"h4ogJHXITkDBR1Dq0X1/+mpbBz3ACJDYZ/cdkT+Tog4zAuH5JO6h8O5xxC/1" +
		"ohrvPJmFOvChzKzeihbRYfk7eGF78rRrgaBFwNV/2xfMnjYEDVp+M3L2T+hJ" +
		"EoZnwaHPrB4G8pfTHWmAUA=="
	data, err := base64.StdEncoding.DecodeString(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if got := avifContainerOrientation(bytes.NewReader(data)); got != 6 {
		t.Fatalf("container orientation=%d want=6", got)
	}
	thumbnail, err := ThumbnailJPEG(bytes.NewReader(data), 1, 640)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnail.SourceKind != "avif" {
		t.Fatalf("source kind=%q want=avif", thumbnail.SourceKind)
	}
	if thumbnail.Width != 480 || thumbnail.Height != 640 {
		t.Fatalf(
			"oriented AVIF thumbnail=%dx%d want=480x640",
			thumbnail.Width,
			thumbnail.Height,
		)
	}
}

func TestAVIFContainerOrientationUsesPrimaryItemAssociations(t *testing.T) {
	data := testAVIFContainer([]testAVIFAssociation{
		{itemID: 1, properties: []testAVIFProperty{
			{kind: "irot", value: 3},
		}},
		{itemID: 2, properties: []testAVIFProperty{
			{kind: "irot", value: 1},
		}},
	})
	if got := avifContainerOrientation(bytes.NewReader(data)); got != 6 {
		t.Fatalf("container orientation=%d want=6", got)
	}
}

func TestThumbnailSourceOrientationPrefersAVIFContainerTransform(t *testing.T) {
	data := testAVIFContainer([]testAVIFAssociation{
		{itemID: 1, properties: []testAVIFProperty{
			{kind: "irot", value: 3},
		}},
	})
	if got := thumbnailSourceOrientation(bytes.NewReader(data), "avif", 8); got != 6 {
		t.Fatalf("AVIF orientation=%d want=6", got)
	}
	if got := thumbnailSourceOrientation(bytes.NewReader(nil), "avif", 8); got != 8 {
		t.Fatalf("AVIF EXIF fallback=%d want=8", got)
	}
}

type testAVIFProperty struct {
	kind  string
	value byte
}

type testAVIFAssociation struct {
	itemID     uint16
	properties []testAVIFProperty
}

func testAVIFContainer(items []testAVIFAssociation) []byte {
	properties := []testAVIFProperty{}
	itemIndices := make([][]byte, len(items))
	for itemIndex, item := range items {
		for _, property := range item.properties {
			properties = append(properties, property)
			itemIndices[itemIndex] = append(
				itemIndices[itemIndex],
				byte(len(properties)),
			)
		}
	}

	ipcoPayload := []byte{}
	for _, property := range properties {
		ipcoPayload = append(
			ipcoPayload,
			testAVIFBox(property.kind, []byte{property.value})...,
		)
	}
	ipco := testAVIFBox("ipco", ipcoPayload)

	ipmaPayload := make([]byte, 8)
	binary.BigEndian.PutUint32(ipmaPayload[4:8], uint32(len(items)))
	for itemIndex, item := range items {
		entry := make([]byte, 3+len(itemIndices[itemIndex]))
		binary.BigEndian.PutUint16(entry[:2], item.itemID)
		entry[2] = byte(len(itemIndices[itemIndex]))
		copy(entry[3:], itemIndices[itemIndex])
		ipmaPayload = append(ipmaPayload, entry...)
	}
	ipma := testAVIFBox("ipma", ipmaPayload)
	iprp := testAVIFBox("iprp", append(ipco, ipma...))

	pitmPayload := make([]byte, 6)
	if len(items) != 0 {
		binary.BigEndian.PutUint16(pitmPayload[4:6], items[0].itemID)
	}
	pitm := testAVIFBox("pitm", pitmPayload)
	metaPayload := append(make([]byte, 4), pitm...)
	metaPayload = append(metaPayload, iprp...)
	meta := testAVIFBox("meta", metaPayload)

	ftyp := testAVIFBox("ftyp", []byte("avif\x00\x00\x00\x00avif"))
	return append(ftyp, meta...)
}

func testAVIFBox(kind string, payload []byte) []byte {
	box := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(box[:4], uint32(len(box)))
	copy(box[4:8], kind)
	copy(box[8:], payload)
	return box
}
