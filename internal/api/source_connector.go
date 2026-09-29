package api

import "github.com/lazyxu/xdrive/internal/meta"

const synologySourceKind = "synology_photos"

func sourceUsesStoredCredential(source meta.Source) bool {
	if source.Kind == yikeSourceKind {
		return true
	}
	return source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPull
}

func sourceCredentialDescription(source meta.Source) string {
	if source.Kind == yikeSourceKind {
		return "Yike Photos Cookie"
	}
	if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPull {
		return "Synology DSM credential"
	}
	return "source credential"
}
