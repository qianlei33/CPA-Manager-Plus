package admintoken

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	adminauthsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/adminauth"
)

// Handler exposes administrator token initialization and rotation endpoints.
type Handler struct {
	App *app.Context
}

type saveTokenRequest struct {
	Token string `json:"token"`
}

// Handle dispatches administrator token routes.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v0/management/admin-token/init" {
		h.Initialize(w, r)
		return
	}
	if r.URL.Path == "/v0/management/admin-token" {
		h.Rotate(w, r)
		return
	}
	http.NotFound(w, r)
}

// Initialize creates the first administrator token without requiring prior authentication.
func (h *Handler) Initialize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}
	req, ok := decodeRequest(w, r)
	if !ok {
		return
	}
	if err := h.App.AdminAuthService.InitializeAdminToken(r.Context(), req.Token); err != nil {
		writeAdminTokenError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Rotate replaces the administrator token for an authenticated session.
func (h *Handler) Rotate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		response.MethodNotAllowed(w)
		return
	}
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}
	req, ok := decodeRequest(w, r)
	if !ok {
		return
	}
	if err := h.App.AdminAuthService.RotateAdminToken(r.Context(), req.Token); err != nil {
		writeAdminTokenError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func decodeRequest(w http.ResponseWriter, r *http.Request) (saveTokenRequest, bool) {
	var req saveTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, err)
		return saveTokenRequest{}, false
	}
	return req, true
}

func writeAdminTokenError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, adminauthsvc.ErrAdminTokenRequired):
		response.Error(w, http.StatusBadRequest, err)
	case errors.Is(err, adminauthsvc.ErrAdminCredentialExists):
		response.Error(w, http.StatusConflict, err)
	case errors.Is(err, adminauthsvc.ErrAdminCredentialMissing):
		response.Error(w, http.StatusPreconditionFailed, err)
	default:
		response.Error(w, http.StatusInternalServerError, err)
	}
}
