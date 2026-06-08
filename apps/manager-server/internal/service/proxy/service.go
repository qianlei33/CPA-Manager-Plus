package proxy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	cpanodesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type Service struct {
	managerConfigService *managerconfig.Service
	cpaNodeService       *cpanodesvc.Service
}

func New(managerConfigService *managerconfig.Service, cpaNodeService ...*cpanodesvc.Service) *Service {
	var nodeService *cpanodesvc.Service
	if len(cpaNodeService) > 0 {
		nodeService = cpaNodeService[0]
	}
	return &Service{managerConfigService: managerConfigService, cpaNodeService: nodeService}
}

func (s *Service) ProxyManagement(w http.ResponseWriter, r *http.Request, writeError func(http.ResponseWriter, int, error)) {
	s.proxyWithSavedManagementKey(w, r, writeError)
}

func (s *Service) ProxyCPA(w http.ResponseWriter, r *http.Request, writeError func(http.ResponseWriter, int, error)) {
	s.proxyWithSavedManagementKey(w, r, writeError)
}

func (s *Service) proxyWithSavedManagementKey(w http.ResponseWriter, r *http.Request, writeError func(http.ResponseWriter, int, error)) {
	setup, err := s.resolveSetup(r.Context(), r)
	if err != nil {
		writeError(w, proxySetupErrorStatus(err), err)
		return
	}
	target, err := url.Parse(setup.CPAUpstreamURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
		req.Header.Set("Authorization", "Bearer "+setup.ManagementKey)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.ServeHTTP(w, r)
}

func (s *Service) ProxyModelList(w http.ResponseWriter, r *http.Request, writeError func(http.ResponseWriter, int, error), methodNotAllowed func(http.ResponseWriter)) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	setup, err := s.resolveSetup(r.Context(), r)
	if err != nil {
		writeError(w, proxySetupErrorStatus(err), err)
		return
	}
	target, err := url.Parse(setup.CPAUpstreamURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		writeError(w, http.StatusBadGateway, err)
	}
	proxy.ServeHTTP(w, r)
}

func IsModelListPath(path string) bool {
	cleaned := strings.TrimRight(path, "/")
	return cleaned == "/v1/models" || cleaned == "/models"
}

func IsCPAProxyPath(path string) bool {
	cleaned := strings.TrimRight(path, "/")
	if cleaned == "" {
		return false
	}
	if _, ok := exactCPAProxyPaths[cleaned]; ok {
		return true
	}
	for _, prefix := range cpaProxyPathPrefixes {
		if cleaned == prefix || strings.HasPrefix(cleaned, prefix+"/") {
			return true
		}
	}
	return false
}

var exactCPAProxyPaths = map[string]struct{}{
	"/ampcode":                             {},
	"/api-call":                            {},
	"/api-key-usage":                       {},
	"/api-keys":                            {},
	"/anthropic-auth-url":                  {},
	"/antigravity-auth-url":                {},
	"/claude-api-key":                      {},
	"/codex-api-key":                       {},
	"/codex-auth-url":                      {},
	"/config":                              {},
	"/config.yaml":                         {},
	"/debug":                               {},
	"/force-model-prefix":                  {},
	"/gemini-api-key":                      {},
	"/gemini-cli-auth-url":                 {},
	"/get-auth-status":                     {},
	"/latest-version":                      {},
	"/logging-to-file":                     {},
	"/logs":                                {},
	"/logs-max-total-size-mb":              {},
	"/oauth-callback":                      {},
	"/oauth-excluded-models":               {},
	"/oauth-model-alias":                   {},
	"/openai-compatibility":                {},
	"/proxy-url":                           {},
	"/quota-exceeded/switch-preview-model": {},
	"/quota-exceeded/switch-project":       {},
	"/request-error-logs":                  {},
	"/request-log":                         {},
	"/request-retry":                       {},
	"/routing/strategy":                    {},
	"/vertex-api-key":                      {},
	"/vertex/import":                       {},
	"/ws-auth":                             {},
	"/xai-auth-url":                        {},
}

var cpaProxyPathPrefixes = []string{
	"/ampcode/",
	"/auth-files",
	"/oauth-excluded-models/",
	"/oauth-model-alias/",
	"/request-error-logs",
	"/request-log-by-id",
}

func (s *Service) resolveSetup(ctx context.Context, r *http.Request) (store.Setup, error) {
	if s.cpaNodeService != nil {
		nodeID := resolveNodeIDFromRequest(r)
		if nodeID != "" {
			return s.cpaNodeService.ResolveSetup(ctx, nodeID)
		}
		// Transitional compatibility: existing tests and single-node deployments may
		// still rely on the old saved setup until a CPA node has been created.
		if nodes, err := s.cpaNodeService.EnabledNodes(ctx); err != nil {
			return store.Setup{}, err
		} else if len(nodes) > 0 {
			return store.Setup{}, cpanodesvc.ErrNodeIDRequired
		}
	}
	setup, ok, err := s.managerConfigService.ResolveSetup(ctx)
	if err != nil {
		return store.Setup{}, err
	}
	if !ok {
		return store.Setup{}, errors.New("usage service is not configured")
	}
	return setup, nil
}

func resolveNodeIDFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	if value := strings.TrimSpace(r.URL.Query().Get("nodeId")); value != "" {
		return value
	}
	return strings.TrimSpace(r.Header.Get("X-CPA-Node-ID"))
}

func proxySetupErrorStatus(err error) int {
	message := err.Error()
	switch {
	case strings.Contains(message, "nodeId is required"):
		return http.StatusBadRequest
	case strings.Contains(message, "not found"):
		return http.StatusNotFound
	case strings.Contains(message, "disabled"):
		return http.StatusBadRequest
	case strings.Contains(message, "not configured"):
		return http.StatusPreconditionRequired
	default:
		return http.StatusInternalServerError
	}
}
