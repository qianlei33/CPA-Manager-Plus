package adminauth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

var (
	// ErrAdminCredentialExists indicates the initial admin token was already configured.
	ErrAdminCredentialExists = errors.New("admin credential already exists")
	// ErrAdminCredentialMissing indicates the initial admin token has not been configured.
	ErrAdminCredentialMissing = errors.New("admin credential is not initialized")
	// ErrAdminTokenRequired indicates an empty admin token was submitted.
	ErrAdminTokenRequired = errors.New("admin token is required")
)

// Service verifies and manages CPA Manager Plus administrator credentials.
type Service struct {
	cfg   config.Config
	store *store.Store
}

// New creates an administrator authentication service.
func New(cfg config.Config, store *store.Store) *Service {
	return &Service{cfg: cfg, store: store}
}

// VerifyHeader verifies the Authorization header against the stored administrator token.
func (s *Service) VerifyHeader(ctx context.Context, authorizationHeader string) (bool, error) {
	credential, ok, err := s.store.LoadAdminCredential(ctx)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, errors.New("admin credential is not initialized")
	}
	return security.VerifyAdminKey(credential, security.ExtractBearerToken(authorizationHeader)), nil
}

// InitializeAdminToken creates the first administrator token.
func (s *Service) InitializeAdminToken(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrAdminTokenRequired
	}
	if _, ok, err := s.store.LoadAdminCredential(ctx); err != nil || ok {
		if err != nil {
			return err
		}
		return ErrAdminCredentialExists
	}
	credential, err := security.NewAdminCredential(token, "user")
	if err != nil {
		return err
	}
	if err := s.store.SaveAdminCredential(ctx, credential); err != nil {
		return err
	}
	return s.markAdminReady(ctx)
}

// RotateAdminToken replaces the administrator token after the current token has authenticated.
func (s *Service) RotateAdminToken(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrAdminTokenRequired
	}
	current, ok, err := s.store.LoadAdminCredential(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return ErrAdminCredentialMissing
	}
	next, err := security.NewAdminCredential(token, "user")
	if err != nil {
		return err
	}
	next.CreatedAtMS = current.CreatedAtMS
	next.RotatedAtMS = time.Now().UnixMilli()
	return s.store.SaveAdminCredential(ctx, next)
}

func (s *Service) markAdminReady(ctx context.Context) error {
	state, ok, err := s.store.LoadBootstrapState(ctx)
	if err != nil {
		return err
	}
	if !ok {
		state = store.BootstrapState{Version: 1, DataKeyReady: true}
	} else if state.Version == 0 {
		state.Version = 1
	}
	state.AdminReady = true
	state.ProjectInitialized = true
	if state.Status == "" || state.Status == "fresh" {
		state.Status = "ready"
	}
	return s.store.SaveBootstrapState(ctx, state)
}

// VerifyPanelHeader verifies a management panel request Authorization header.
func (s *Service) VerifyPanelHeader(ctx context.Context, authorizationHeader string) (bool, error) {
	return s.VerifyHeader(ctx, authorizationHeader)
}

// VerifySubmittedExternalConfigHeader verifies config update authorization.
func (s *Service) VerifySubmittedExternalConfigHeader(ctx context.Context, authorizationHeader string, cfg store.ManagerConfig) (bool, error) {
	return s.VerifyHeader(ctx, authorizationHeader)
}

// PanelUsesExternalManagementKey reports whether the panel accepts an external management key.
func (s *Service) PanelUsesExternalManagementKey(ctx context.Context) (bool, error) {
	return false, nil
}
