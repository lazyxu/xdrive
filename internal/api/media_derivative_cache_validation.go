package api

import (
	"bytes"
	"os"
	"strings"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

var mediaDerivativePNGSignature = []byte{137, 80, 78, 71, 13, 10, 26, 10}
var mediaDerivativePNGIEND = []byte{0, 0, 0, 0, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82}

// mediaDerivativeCacheValid is an O(1) envelope check for xDrive-produced
// cached image derivatives. It catches empty, truncated and wrong-format
// files without reading/decoding an entire JPEG/PNG for each visible tile.
// The original CAS file is never inspected here. This is not a cryptographic
// proof that every compressed image byte is valid.
//
// Legacy video posters are separately supplied/uploaded and are not governed
// by this generated-thumbnail cache contract.
func mediaDerivativeCacheValid(file *os.File, key string) bool {
	if file == nil {
		return false
	}
	if !strings.HasPrefix(key, mediapkg.ThumbnailStoragePrefix) {
		return true
	}
	jpg := strings.HasSuffix(key, ".jpg")
	thumb := strings.HasSuffix(key, ".thumb")
	if !jpg && !thumb {
		return true
	}
	stat, err := file.Stat()
	if err != nil || stat.Size() < 45 {
		return false
	}
	var beginning [8]byte
	var ending [12]byte
	if _, err := file.ReadAt(beginning[:], 0); err != nil {
		return false
	}
	if _, err := file.ReadAt(ending[:], stat.Size()-int64(len(ending))); err != nil {
		return false
	}
	isJPEG := stat.Size() >= 64 &&
		beginning[0] == 0xff && beginning[1] == 0xd8 && beginning[2] == 0xff &&
		ending[10] == 0xff && ending[11] == 0xd9
	if isJPEG {
		return true
	}
	return thumb &&
		bytes.Equal(beginning[:], mediaDerivativePNGSignature) &&
		bytes.Equal(ending[:], mediaDerivativePNGIEND)
}
