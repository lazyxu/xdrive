package mount

type FileAvailability struct {
	Path             string
	Mode             string
	Placeholder      bool
	Pinned           bool
	OnlineOnly       bool
	AvailableOffline bool
	InSync           bool
	Syncing          bool
}

func KeepLocal(path string) error { return keepLocalPlatform(path) }

func ReleaseSpace(path string) error { return releaseSpacePlatform(path) }

func MakeOnlineOnly(path string) error { return onlineOnlyPlatform(path) }

func Availability(path string) (FileAvailability, error) { return availabilityPlatform(path) }

func RequestSync(root string) bool { return requestSyncPlatform(root) }
