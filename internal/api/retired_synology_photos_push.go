package api

import (
	"github.com/lazyxu/xdrive/internal/meta"
)

// Historical dedicated DSM Photos Push writers are retired. This Source-kind
// predicate is intentionally separate from UploadSession.SourceID: native
// iOS/Android Source-bound sessions must retain narrowly scoped Device grants.
func isRetiredSynologyPhotosPush(source meta.Source) bool {
	return source.Kind == synologySourceKind &&
		source.Direction == meta.SourceDirectionPush
}
