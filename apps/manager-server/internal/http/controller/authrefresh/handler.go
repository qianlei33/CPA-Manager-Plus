package authrefresh

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/app"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/middleware"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/http/response"
	authrefreshsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/authrefresh"
)

// Handler 处理认证文件 Token 刷新的 HTTP 请求。
type Handler struct {
	App *app.Context
}

type refreshRequest struct {
	NodeID string   `json:"nodeId"`
	Names  []string `json:"names"`
}

type refreshResponse struct {
	Results []authrefreshsvc.RefreshResult `json:"results"`
}

// Handle 路由入口。只处理 POST /v0/management/auth-files/refresh-token。
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	if !middleware.AuthorizePanel(w, r, h.App.AdminAuthService) {
		return
	}

	if r.Method != http.MethodPost {
		response.MethodNotAllowed(w)
		return
	}

	if r.URL.Path != "/v0/management/auth-files/refresh-token" {
		response.MethodNotAllowed(w)
		return
	}

	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}

	nodeID := req.NodeID
	if nodeID == "" {
		nodeID = r.URL.Query().Get("nodeId")
	}
	results, err := h.App.AuthRefreshService.RefreshTokens(r.Context(), nodeID, req.Names)
	if err != nil {
		response.Error(w, authRefreshErrorStatus(err), err)
		return
	}

	response.JSON(w, http.StatusOK, refreshResponse{Results: results})
}

func authRefreshErrorStatus(err error) int {
	message := err.Error()
	switch {
	case strings.Contains(message, "nodeId is required"):
		return http.StatusBadRequest
	case strings.Contains(message, "not found"):
		return http.StatusNotFound
	case strings.Contains(message, "disabled"), strings.Contains(message, "no valid file names"):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}
