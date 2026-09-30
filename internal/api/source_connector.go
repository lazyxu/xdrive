package api

import "github.com/lazyxu/xdrive/internal/meta"

const (
	synologySourceKind      = "synology_photos"
	synologyFilesSourceKind = "synology_files"
)

func isSynologyPullSource(source meta.Source) bool {
	if source.Direction != meta.SourceDirectionPull {
		return false
	}
	return source.Kind == synologySourceKind || source.Kind == synologyFilesSourceKind
}

func sourceUsesStoredCredential(source meta.Source) bool {
	if source.Kind == yikeSourceKind {
		return true
	}
	return isSynologyPullSource(source)
}

func sourceRequiresConnectorConfig(source meta.Source) bool {
	return source.Kind == synologyFilesSourceKind && source.Direction == meta.SourceDirectionPull
}

func sourceCredentialDescription(source meta.Source) string {
	if source.Kind == yikeSourceKind {
		return "Yike Photos Cookie"
	}
	if isSynologyPullSource(source) {
		return "Synology DSM credential"
	}
	return "source credential"
}
