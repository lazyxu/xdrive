package main

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

type agentOwnerShareLink struct {
	URL string `json:"url"`
}

func (c *agentController) CloudOwnShares(ctx context.Context, cursor uint64, limit int) (client.OwnerSharePage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OwnerSharePage{}, err
	}
	return cli.OwnerShares(ctx, cursor, limit)
}

func (c *agentController) CloudOwnShareLink(ctx context.Context, shareID uint64) (agentOwnerShareLink, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return agentOwnerShareLink{}, err
	}
	link, err := cli.ShareLink(ctx, shareID)
	if err != nil {
		return agentOwnerShareLink{}, err
	}
	// A public share capability is a base64url random token: allow only that
	// exact alphabet and length, never URL fragments, queries or credentials.
	if len(link.Token) != 43 {
		return agentOwnerShareLink{}, errors.New("malformed public share capability")
	}
	for _, char := range link.Token {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-') {
			return agentOwnerShareLink{}, errors.New("malformed public share capability")
		}
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	if base == "" {
		return agentOwnerShareLink{}, errors.New("missing public Share origin")
	}
	return agentOwnerShareLink{URL: base + "/#/s/" + url.PathEscape(link.Token)}, nil
}
