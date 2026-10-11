package mediaworker

// A bounded CPU quota for the isolated Media Worker, not core services.
const DefaultCPUMilli = 750

func ValidCPUMilli(value int) bool {
	return value >= 250 && value <= 4000 && value%250 == 0
}
