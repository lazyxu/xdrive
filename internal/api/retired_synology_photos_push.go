package api

import "github.com/lazyxu/xdrive/internal/meta"

// isRetiredSynologyPhotosPush is a compatibility predicate for historical
// Source rows. It NEVER grants upload, run, mutation or data-deletion rights.
// The same kind with Pull direction remains supported by Server workers.
func isRetiredSynologyPhotosPush(source meta.Source) bool {
	return source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush
}

// The retired DSM Photos Push client used SourceID/SourceRevision/Root headers
// on the generic UploadSession endpoints. That legacy writer is no longer
// authorized. The original owning local_folder Agent continues through its
// private lp2_ operation proof (without these retired request fields), and
// Pull workers continue through their independent signed SourceRun.
func validUploadWithoutRetiredSynologyProof(req uploadInitRequest) bool {
	return req.SourceID == 0 && req.SourceRevision == 0 &&
		req.SourceRootID == "" && req.SourceRootFingerprint == ""
}

// UploadSession UUIDs and old SourceID fields are not authorizations.
// Deny every legacy SourceID-bound session before an upload read, chunk,
// resume, or finalize. Future platform-bound writers must replace this
// interim gate with their own transactional Source/Device checks.
func requireUploadWithoutRetiredSynologySource(session meta.UploadSession) error {
	if session.SourceID != 0 {
		return errManagedSourceWriteDenied
	}
	return nil
}
