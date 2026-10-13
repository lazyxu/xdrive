package photointelligence

import "errors"

// An analyzer-generated process-boot session, not a Host Manager/container
// attestation or request token. Legacy Info can omit it but cannot prove
// four-model process identity.
func ValidAnalyzerRuntimeInstanceID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func validateOptionalAnalyzerRuntimeInstanceID(value string) error {
	if value == "" || ValidAnalyzerRuntimeInstanceID(value) {
		return nil
	}
	return errors.New("invalid analyzer runtime instance identity")
}

// HostApplyReceipt is reported by the model process only after its dedicated
// operator-authenticated host acknowledgement. It is not a media task result.
type HostApplyReceipt struct {
	Revision  uint64 `json:"revision"`
	RequestID string `json:"request_id"`
}

func ValidAnalyzerHostRequestID(value string) bool {
	if len(value) != 24 {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func validateOptionalAnalyzerHostApplyReceipt(receipt *HostApplyReceipt) error {
	if receipt == nil {
		return nil
	}
	if receipt.Revision == 0 || receipt.Revision >= 1<<60 ||
		!ValidAnalyzerHostRequestID(receipt.RequestID) {
		return errors.New("invalid model host apply receipt")
	}
	return nil
}
