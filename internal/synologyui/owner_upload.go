package synologyui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

const dsmOwnerSmallUploadJSONMax = 6 << 20

type OwnerSmallFileUploader interface {
	OwnerUploadSmallFile(context.Context, uint64, string, string, []byte) (localbackupipc.OwnerFileNode, error)
}

type dsmOwnerSmallUploadInput struct {
	ParentID   uint64
	Name       string
	OwnerScope string
	SHA256     string
	Data       []byte
}

// The exact same-origin CGI object has five non-repeated fields and <=4 MiB
// of real bytes. No multipart paths, URLs or unrestricted forwarding.
func parseDSMOwnerSmallUpload(r *http.Request) (dsmOwnerSmallUploadInput, error) {
	var out dsmOwnerSmallUploadInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > dsmOwnerSmallUploadJSONMax {
		return out, errors.New("invalid DSM upload size or route")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, dsmOwnerSmallUploadJSONMax+1))
	if err != nil || len(body) != int(r.ContentLength) || len(body) > dsmOwnerSmallUploadJSONMax {
		return out, errors.New("invalid DSM upload length")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	begin, err := decoder.Token()
	if err != nil || begin != json.Delim('{') {
		return out, errors.New("expected Owner upload JSON object")
	}
	seen := make(map[string]bool, 5)
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return out, errors.New("invalid or duplicate upload field")
		}
		seen[key] = true
		switch key {
		case "parent_id":
			err = decoder.Decode(&out.ParentID)
		case "name":
			err = decoder.Decode(&out.Name)
		case "owner_scope":
			err = decoder.Decode(&out.OwnerScope)
		case "sha256":
			err = decoder.Decode(&out.SHA256)
		case "data":
			err = decoder.Decode(&out.Data)
		default:
			return out, errors.New("unknown Owner upload field")
		}
		if err != nil {
			return out, errors.New("invalid Owner upload field")
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 5 {
		return out, errors.New("incomplete Owner upload")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return out, errors.New("trailing Owner upload content")
	}
	if !localbackupipc.ValidOwnerFileID(out.ParentID) ||
		!localbackupipc.ValidOwnerFolderName(out.Name) ||
		!nasSelectionID.MatchString(out.OwnerScope) ||
		len(out.Data) < 1 || len(out.Data) > localbackupipc.OwnerSmallUploadMaxBytes ||
		len(out.SHA256) != 64 {
		return out, errors.New("invalid Owner upload selector")
	}
	sum := sha256.Sum256(out.Data)
	if hex.EncodeToString(sum[:]) != out.SHA256 {
		return out, errors.New("invalid Owner upload digest")
	}
	return out, nil
}

func serveDSMOwnerSmallUpload(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string,
) {
	input, err := parseDSMOwnerSmallUpload(r)
	if err != nil {
		http.Error(w, "invalid Owner small upload", http.StatusBadRequest)
		return
	}
	uploader, canUpload := agent.(OwnerSmallFileUploader)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canUpload || !canIdentify || !canVerify {
		http.Error(w, "owning Agent upload unavailable", http.StatusNotImplemented)
		return
	}
	status, err := login.ServerConnection(ctx)
	if err != nil || !status.Configured || status.MustChangePassword {
		http.Error(w, "Server Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host, status.Server, status.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Server Owner changed before upload", http.StatusConflict)
		return
	}
	ownerQuota, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(ownerQuota) {
		http.Error(w, "Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.Server != status.Server || before.Username != status.Username {
		http.Error(w, "Server Owner changed before upload", http.StatusConflict)
		return
	}
	node, err := uploader.OwnerUploadSmallFile(ctx, input.ParentID, input.Name, input.SHA256, input.Data)
	if err != nil || !localbackupipc.ValidateOwnerUploadedFile(node, input.ParentID, input.Name, len(input.Data)) {
		http.Error(w, "Owner upload failed or acknowledgement uncertain; refresh before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != status.Server || after.Username != status.Username {
		http.Error(w, "Server Owner changed during upload; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, node)
}
