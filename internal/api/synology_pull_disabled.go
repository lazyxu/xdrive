package api

import "errors"

// Historical Synology Pull Sources remain Owner-readable while the two
// remote Synology Pull connectors are disabled for DSM folder Push MVP.
var errSynologyPullDisabled = errors.New("Synology Photos and Files Pull are disabled for the DSM folder-Push MVP")
