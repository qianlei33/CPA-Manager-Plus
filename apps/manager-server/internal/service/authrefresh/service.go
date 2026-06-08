package authrefresh

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpa"
	cpanodesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

const authFilesFetchMaxAttempts = 3

// RefreshResult 表示单个文件的刷新结果。
type RefreshResult struct {
	Name    string `json:"name"`
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Service 提供 Codex Token 强制刷新的业务能力。
type Service struct {
	managerConfigService *managerconfig.Service
	cpaNodeService       *cpanodesvc.Service
	client               *http.Client
}

// New 创建 Service 实例。
func New(managerConfigService *managerconfig.Service, cpaNodeService *cpanodesvc.Service, clients ...*http.Client) *Service {
	client := &http.Client{Timeout: 30 * time.Second}
	if len(clients) > 0 && clients[0] != nil {
		client = clients[0]
	}
	return &Service{
		managerConfigService: managerConfigService,
		cpaNodeService:       cpaNodeService,
		client:               client,
	}
}

// RefreshTokens 对指定的 Codex 认证文件触发强制刷新，并轮询验证结果。
// 内部实现：并发 PATCH expired → 等待 6 秒 → 再次拉取列表 → 对比 last_refresh 判定成败。
func (s *Service) RefreshTokens(ctx context.Context, nodeID string, names []string) ([]RefreshResult, error) {
	setup, err := s.resolveSetup(ctx, nodeID)
	if err != nil {
		return nil, err
	}

	// 去重并过滤空值
	uniqueNames := make([]string, 0, len(names))
	seen := make(map[string]struct{})
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		uniqueNames = append(uniqueNames, trimmed)
	}
	if len(uniqueNames) == 0 {
		return nil, errors.New("no valid file names provided")
	}

	// 1. 首次快照
	snapshotBefore, err := s.fetchAuthFilesForNames(ctx, setup, uniqueNames)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch auth files before refresh: %w", err)
	}
	beforeMap := buildFileSnapshotMap(snapshotBefore, uniqueNames)

	// 2. 并发触发 PATCH
	triggerErrs := s.triggerRefreshConcurrently(ctx, setup, uniqueNames)

	// 3. 统一等待 6 秒（CLIProxyAPI 刷新循环 5s + 余量）
	time.Sleep(6 * time.Second)

	// 4. 二次快照
	snapshotAfter, err := s.fetchAuthFilesForNames(ctx, setup, uniqueNames)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch auth files after refresh: %w", err)
	}
	afterMap := buildFileSnapshotMap(snapshotAfter, uniqueNames)

	// 5. 对比判定
	results := make([]RefreshResult, 0, len(uniqueNames))
	for _, name := range uniqueNames {
		result := s.evaluateRefresh(name, beforeMap[name], afterMap[name])
		if triggerErr, ok := triggerErrs[name]; ok && triggerErr != nil {
			// PATCH 本身就失败了，直接标记失败
			result.Success = false
			result.Error = fmt.Sprintf("trigger failed: %v", triggerErr)
		}
		results = append(results, result)
	}

	return results, nil
}

func (s *Service) resolveSetup(ctx context.Context, nodeID string) (store.Setup, error) {
	if s.cpaNodeService != nil {
		return s.cpaNodeService.ResolveSetup(ctx, nodeID)
	}
	managerCfg, _, ok, err := s.managerConfigService.ResolveManagerConfigWithSource(ctx)
	if err != nil {
		return store.Setup{}, err
	}
	if !ok || strings.TrimSpace(managerCfg.CPAConnection.CPABaseURL) == "" ||
		strings.TrimSpace(managerCfg.CPAConnection.ManagementKey) == "" {
		return store.Setup{}, errors.New("CPA connection is not configured")
	}
	return managerconfig.SetupFromManagerConfig(managerCfg), nil
}

// fileSnapshot 保存用于判定刷新是否成功的关键字段。
type fileSnapshot struct {
	Name           string
	LastRefresh    string
	Expired        string
	Status         string
	State          string
	Provider       string
	Disabled       bool
	HasLastRefresh bool
	HasExpired     bool
}

func buildFileSnapshotMap(files []authFile, targetNames []string) map[string]*fileSnapshot {
	targetSet := make(map[string]struct{})
	for _, n := range targetNames {
		targetSet[n] = struct{}{}
	}
	result := make(map[string]*fileSnapshot)
	for _, file := range files {
		name := readString(file, "name", "id")
		if name == "" {
			continue
		}
		if _, ok := targetSet[name]; !ok {
			continue
		}
		snapshot := &fileSnapshot{
			Name:     name,
			Status:   readString(file, "status", "state"),
			State:    readString(file, "state"),
			Provider: strings.ToLower(readString(file, "provider", "type")),
			Disabled: isDisabledAuthFile(file),
		}
		if lr, ok := file["last_refresh"]; ok && lr != nil {
			snapshot.LastRefresh = fmt.Sprint(lr)
			snapshot.HasLastRefresh = true
		}
		if exp, ok := file["expired"]; ok && exp != nil {
			snapshot.Expired = fmt.Sprint(exp)
			snapshot.HasExpired = true
		}
		// metadata 嵌套字段也可能包含 expired/last_refresh
		metadata := readMap(file, "metadata")
		if metadata != nil {
			if !snapshot.HasLastRefresh {
				if lr, ok := metadata["last_refresh"]; ok && lr != nil {
					snapshot.LastRefresh = fmt.Sprint(lr)
					snapshot.HasLastRefresh = true
				}
			}
			if !snapshot.HasExpired {
				if exp, ok := metadata["expired"]; ok && exp != nil {
					snapshot.Expired = fmt.Sprint(exp)
					snapshot.HasExpired = true
				}
			}
		}
		result[name] = snapshot
	}
	return result
}

func (s *Service) evaluateRefresh(name string, before, after *fileSnapshot) RefreshResult {
	if after == nil {
		return RefreshResult{
			Name:    name,
			Success: false,
			Error:   "file not found after refresh",
		}
	}
	if before == nil {
		// 刷新前就没找到，说明文件可能不存在，但 PATCH 可能仍成功了（如果文件是后来创建的）
		// 这种情况比较少见，按成功处理如果 last_refresh 有值
		if after.HasLastRefresh && after.LastRefresh != "" {
			return RefreshResult{Name: name, Success: true, Message: "Token refreshed"}
		}
		return RefreshResult{Name: name, Success: false, Error: "file was not found before refresh"}
	}

	// 判定 1：last_refresh 更新了
	if after.HasLastRefresh && after.LastRefresh != "" {
		if !before.HasLastRefresh || before.LastRefresh != after.LastRefresh {
			return RefreshResult{Name: name, Success: true, Message: "Token refreshed"}
		}
	}

	// 判定 2：expired 从过去时间变成了未来时间
	if after.HasExpired && after.Expired != "" {
		beforeExpired := parseRFC3339OrZero(before.Expired)
		afterExpired := parseRFC3339OrZero(after.Expired)
		now := time.Now().UTC()
		if beforeExpired.Before(now) && afterExpired.After(now) {
			return RefreshResult{Name: name, Success: true, Message: "Token refreshed (expired updated)"}
		}
	}

	// 判定 3：状态仍为异常，说明刷新失败
	statusLower := strings.ToLower(after.Status)
	stateLower := strings.ToLower(after.State)
	if statusLower == "auth_unavailable" || statusLower == "error" || statusLower == "unavailable" ||
		stateLower == "auth_unavailable" || stateLower == "error" {
		return RefreshResult{
			Name:    name,
			Success: false,
			Error:   "Token refresh failed, refresh_token may be invalid or expired",
		}
	}

	// 判定 4：不确定状态
	return RefreshResult{
		Name:    name,
		Success: false,
		Error:   "Unable to confirm refresh status, please check manually later",
	}
}

func (s *Service) triggerRefreshConcurrently(ctx context.Context, setup store.Setup, names []string) map[string]error {
	type task struct {
		name string
		err  error
	}
	tasks := make(chan string, len(names))
	results := make(chan task, len(names))

	// 启动固定数量的 worker
	workers := 4
	if len(names) < workers {
		workers = len(names)
	}
	for i := 0; i < workers; i++ {
		go func() {
			for name := range tasks {
				err := s.patchAuthFileExpired(ctx, setup, name)
				results <- task{name: name, err: err}
			}
		}()
	}

	for _, name := range names {
		tasks <- name
	}
	close(tasks)

	errs := make(map[string]error)
	for i := 0; i < len(names); i++ {
		t := <-results
		if t.err != nil {
			errs[t.name] = t.err
		}
	}
	return errs
}

func (s *Service) patchAuthFileExpired(ctx context.Context, setup store.Setup, fileName string) error {
	payload := map[string]any{
		"name":    fileName,
		"expired": "2000-01-01T00:00:00Z",
	}
	primaryErr, primaryStatus := s.patchAuthFile(ctx, setup, "/auth-files/fields", payload)
	if primaryErr == nil {
		return nil
	}
	if shouldFallbackManagement(primaryStatus) {
		managementErr, _ := s.patchAuthFile(ctx, setup, "/v0/management/auth-files/fields", payload)
		if managementErr == nil {
			return nil
		}
		return fmt.Errorf("primary: %v; management: %v", primaryErr, managementErr)
	}
	return primaryErr
}

func (s *Service) patchAuthFile(ctx context.Context, setup store.Setup, path string, payload map[string]any) (error, int) {
	data, err := json.Marshal(payload)
	if err != nil {
		return err, 0
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPatch,
		cpa.NormalizeBaseURL(setup.CPAUpstreamURL)+path,
		bytes.NewReader(data),
	)
	if err != nil {
		return err, 0
	}
	req.Header.Set("Content-Type", "application/json")
	return s.doCPAAction(req, setup.ManagementKey)
}

func (s *Service) doCPAAction(req *http.Request, managementKey string) (error, int) {
	req.Header.Set("Authorization", "Bearer "+managementKey)
	res, err := s.client.Do(req)
	if err != nil {
		return err, 0
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1024*1024))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("%s %s", res.Status, truncate(string(body), 2048)), res.StatusCode
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err == nil {
		if failed, ok := payload["failed"].([]any); ok && len(failed) > 0 {
			return fmt.Errorf("CPA action failed: %s", truncate(fmt.Sprint(failed[0]), 2048)), res.StatusCode
		}
	}
	return nil, res.StatusCode
}

func shouldFallbackManagement(status int) bool {
	return status == http.StatusNotFound || status == http.StatusMethodNotAllowed
}

type authFile map[string]any

func (s *Service) fetchAuthFiles(ctx context.Context, setup store.Setup) ([]authFile, error) {
	files, status, err := s.fetchAuthFilesAt(ctx, setup, "/auth-files")
	if err == nil {
		return files, nil
	}
	if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
		files, _, err = s.fetchAuthFilesAt(ctx, setup, "/v0/management/auth-files")
		return files, err
	}
	return nil, err
}

func (s *Service) fetchAuthFilesForNames(ctx context.Context, setup store.Setup, names []string) ([]authFile, error) {
	var lastErr error
	var lastFiles []authFile
	for attempt := 1; attempt <= authFilesFetchMaxAttempts; attempt++ {
		files, err := s.fetchAuthFiles(ctx, setup)
		if err != nil {
			lastErr = err
		} else {
			lastFiles = files
			missing := missingAuthFileNames(files, names)
			if len(missing) == 0 {
				return files, nil
			}
		}

		if attempt < authFilesFetchMaxAttempts {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 500 * time.Millisecond):
			}
		}
	}
	if lastFiles != nil {
		return lastFiles, nil
	}
	return nil, lastErr
}

func (s *Service) fetchAuthFilesAt(ctx context.Context, setup store.Setup, path string) ([]authFile, int, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		cpa.NormalizeBaseURL(setup.CPAUpstreamURL)+path,
		nil,
	)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+setup.ManagementKey)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8*1024*1024))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, res.StatusCode, fmt.Errorf("auth files request failed: %s %s", res.Status, truncate(string(body), 2048))
	}
	var payload struct {
		Files []authFile `json:"files"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, res.StatusCode, err
	}
	return payload.Files, res.StatusCode, nil
}

func missingAuthFileNames(files []authFile, names []string) []string {
	found := make(map[string]struct{}, len(files))
	for _, file := range files {
		name := readString(file, "name", "id")
		if name != "" {
			found[name] = struct{}{}
		}
	}

	missing := make([]string, 0)
	for _, name := range names {
		if _, ok := found[name]; !ok {
			missing = append(missing, name)
		}
	}
	return missing
}

// --- 辅助函数（与 codexinspection/service.go 保持一致） ---

func readString(file authFile, keys ...string) string {
	for _, key := range keys {
		value, ok := file[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func readMap(file authFile, keys ...string) authFile {
	for _, key := range keys {
		value, ok := file[key]
		if !ok || value == nil {
			continue
		}
		if typed, ok := value.(map[string]any); ok {
			return typed
		}
	}
	return nil
}

func isDisabledAuthFile(file authFile) bool {
	status := strings.ToLower(readString(file, "status", "state"))
	if status == "disabled" || status == "inactive" {
		return true
	}
	value, ok := file["disabled"]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1"
	default:
		return false
	}
}

func parseRFC3339OrZero(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		// 尝试其他常见格式
		t, err = time.Parse(time.RFC3339Nano, trimmed)
	}
	if err != nil {
		return time.Time{}
	}
	return t
}

func truncate(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "...(truncated)"
}
