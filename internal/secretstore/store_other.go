//go:build !linux && !windows

package secretstore

func Save(configDir, sessionID, _ string, creds Credentials) error {
	return saveFallback(configDir, sessionID, creds)
}

func Load(configDir, sessionID string) (Credentials, error) {
	return loadFallback(configDir, sessionID)
}

func Delete(configDir, sessionID string) error {
	return deleteFallback(configDir, sessionID)
}

func Backend(configDir, sessionID string) string {
	if _, err := loadFallback(configDir, sessionID); err == nil {
		return "file-0600"
	}
	return "unavailable"
}
