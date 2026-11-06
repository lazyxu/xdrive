package meta

// SynologyPullTemporarilyDisabled disables the remote DSM Pull connectors
// during the DSM local_folder Push MVP, without removing their code or data.
func SynologyPullTemporarilyDisabled(kind, direction string) bool {
	return direction == SourceDirectionPull &&
		(kind == "synology_photos" || kind == "synology_files")
}
