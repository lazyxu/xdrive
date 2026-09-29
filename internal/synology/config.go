package synology

import (
	"encoding/json"
	"fmt"
)

type PullConfig struct {
	Spaces []Space `json:"spaces"`
}

func DefaultPullConfig() PullConfig {
	return PullConfig{Spaces: []Space{SpacePersonal, SpaceShared}}
}

func NormalizePullConfig(input PullConfig) (PullConfig, error) {
	if len(input.Spaces) == 0 {
		return PullConfig{}, fmt.Errorf("at least one Synology space is required")
	}
	seen := map[Space]bool{}
	for _, space := range input.Spaces {
		switch space {
		case SpacePersonal, SpaceShared:
			seen[space] = true
		default:
			return PullConfig{}, fmt.Errorf("unsupported Synology space %q", space)
		}
	}
	out := PullConfig{Spaces: make([]Space, 0, len(seen))}
	if seen[SpacePersonal] {
		out.Spaces = append(out.Spaces, SpacePersonal)
	}
	if seen[SpaceShared] {
		out.Spaces = append(out.Spaces, SpaceShared)
	}
	return out, nil
}

func ParsePullConfig(payload []byte) (PullConfig, error) {
	var input PullConfig
	if err := json.Unmarshal(payload, &input); err != nil {
		return PullConfig{}, err
	}
	return NormalizePullConfig(input)
}
