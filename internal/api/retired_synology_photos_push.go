package api

import "github.com/lazyxu/xdrive/internal/meta"

// isRetiredSynologyPhotosPush is a compatibility predicate for historical
// Source rows. It NEVER grants upload, run, mutation or data-deletion rights.
// The same kind with Pull direction remains supported by Server workers.
func isRetiredSynologyPhotosPush(source meta.Source) bool {
	return source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush
}
