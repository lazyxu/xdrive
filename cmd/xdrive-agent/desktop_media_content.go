package main

import (
	"context"
	"encoding/json"
	"github.com/lazyxu/xdrive/internal/client"
	"net/http"
)

type desktopMediaContentController interface {
	CloudMediaContent(context.Context, client.MediaContentRequest) (json.RawMessage, error)
}

func (c *agentController) CloudMediaContent(ctx context.Context, input client.MediaContentRequest) (json.RawMessage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaContent(ctx, input)
}

func (h *desktopIPCHandler) mediaContent(w http.ResponseWriter, r *http.Request) {
	var input client.MediaContentRequest
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if err := input.Validate(); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_photo_content", err.Error())
		return
	}
	controller, ok := h.ctrl.(desktopMediaContentController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "photo_content_unavailable", "photo content operations require an updated Agent")
		return
	}
	value, err := controller.CloudMediaContent(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}
