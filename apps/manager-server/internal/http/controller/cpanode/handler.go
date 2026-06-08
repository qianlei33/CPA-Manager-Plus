package cpanode

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	cpanodesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
)

// Handler serves CPA node management endpoints.
type Handler struct {
	App *app.Context
}

// Handle routes CPA node management requests.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v0/management/cpa-nodes"), "/")
	if path == "" {
		h.handleCollection(w, r)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 1 {
		h.handleItem(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "validate" {
		h.handleValidate(w, r, parts[0])
		return
	}
	response.MethodNotAllowed(w)
}

func (h *Handler) handleCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		nodes, err := h.App.CPANodeService.ListNodes(r.Context())
		if err != nil {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		response.JSON(w, http.StatusOK, map[string]any{"nodes": nodes})
	case http.MethodPost:
		var req cpanodesvc.SaveNodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			response.Error(w, http.StatusBadRequest, err)
			return
		}
		node, err := h.App.CPANodeService.CreateNodeWithOptions(r.Context(), req)
		if err != nil {
			response.Error(w, cpaNodeErrorStatus(err), err)
			return
		}
		if err := h.reloadCollectors(r); err != nil {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		response.JSON(w, http.StatusCreated, node)
	default:
		response.MethodNotAllowed(w)
	}
}

func (h *Handler) handleItem(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		node, err := h.App.CPANodeService.GetNode(r.Context(), id)
		if err != nil {
			response.Error(w, cpaNodeErrorStatus(err), err)
			return
		}
		response.JSON(w, http.StatusOK, node)
	case http.MethodPut:
		var req cpanodesvc.SaveNodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			response.Error(w, http.StatusBadRequest, err)
			return
		}
		node, err := h.App.CPANodeService.UpdateNodeWithOptions(r.Context(), id, req)
		if err != nil {
			response.Error(w, cpaNodeErrorStatus(err), err)
			return
		}
		if err := h.reloadCollectors(r); err != nil {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		response.JSON(w, http.StatusOK, node)
	case http.MethodDelete:
		if err := h.App.CPANodeService.DeleteNode(r.Context(), id); err != nil {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		if err := h.reloadCollectors(r); err != nil {
			response.Error(w, http.StatusInternalServerError, err)
			return
		}
		response.JSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		response.MethodNotAllowed(w)
	}
}

func (h *Handler) reloadCollectors(r *http.Request) error {
	if h.App.CollectorReloader == nil {
		return nil
	}
	return h.App.CollectorReloader.ReloadNodes(r.Context())
}

func (h *Handler) handleValidate(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}
	if err := h.App.CPANodeService.ValidateNode(r.Context(), id); err != nil {
		response.Error(w, cpaNodeErrorStatus(err), err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func cpaNodeErrorStatus(err error) int {
	message := err.Error()
	switch {
	case strings.Contains(message, "not found"):
		return http.StatusNotFound
	case strings.Contains(message, "required"), strings.Contains(message, "disabled"):
		return http.StatusBadRequest
	case strings.Contains(message, "management API"):
		return http.StatusBadGateway
	default:
		return http.StatusInternalServerError
	}
}
