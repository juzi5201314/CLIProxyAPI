package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/MoeForge/moego/json"
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestDeleteAuthFile_UsesAuthPathFromManager(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	tempDir := t.TempDir()
	authDir := filepath.Join(tempDir, "auth")
	externalDir := filepath.Join(tempDir, "external")
	if errMkdirAuth := os.MkdirAll(authDir, 0o700); errMkdirAuth != nil {
		t.Fatalf("failed to create auth dir: %v", errMkdirAuth)
	}
	if errMkdirExternal := os.MkdirAll(externalDir, 0o700); errMkdirExternal != nil {
		t.Fatalf("failed to create external dir: %v", errMkdirExternal)
	}

	fileName := "codex-user@example.com-plus.json"
	shadowPath := filepath.Join(authDir, fileName)
	realPath := filepath.Join(externalDir, fileName)
	if errWriteShadow := os.WriteFile(shadowPath, []byte(`{"type":"codex","email":"shadow@example.com"}`), 0o600); errWriteShadow != nil {
		t.Fatalf("failed to write shadow file: %v", errWriteShadow)
	}
	if errWriteReal := os.WriteFile(realPath, []byte(`{"type":"codex","email":"real@example.com"}`), 0o600); errWriteReal != nil {
		t.Fatalf("failed to write real file: %v", errWriteReal)
	}

	manager := coreauth.NewManager(nil, nil, nil)
	record := &coreauth.Auth{
		ID:          "legacy/" + fileName,
		FileName:    fileName,
		Provider:    "codex",
		Status:      coreauth.StatusError,
		Unavailable: true,
		Attributes: map[string]string{
			"path": realPath,
		},
		Metadata: map[string]any{
			"type":  "codex",
			"email": "real@example.com",
		},
	}
	if _, errRegister := manager.Register(context.Background(), record); errRegister != nil {
		t.Fatalf("failed to register auth record: %v", errRegister)
	}

	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)
	h.tokenStore = &memoryAuthStore{}

	deleteRec := httptest.NewRecorder()
	deleteCtx, _ := gin.CreateTestContext(deleteRec)
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v0/management/auth-files?name="+url.QueryEscape(fileName), nil)
	deleteCtx.Request = deleteReq
	h.DeleteAuthFile(deleteCtx)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected delete status %d, got %d with body %s", http.StatusOK, deleteRec.Code, deleteRec.Body.String())
	}
	if _, errStatReal := os.Stat(realPath); !os.IsNotExist(errStatReal) {
		t.Fatalf("expected managed auth file to be removed, stat err: %v", errStatReal)
	}
	if _, errStatShadow := os.Stat(shadowPath); errStatShadow != nil {
		t.Fatalf("expected shadow auth file to remain, stat err: %v", errStatShadow)
	}

	listRec := httptest.NewRecorder()
	listCtx, _ := gin.CreateTestContext(listRec)
	listReq := httptest.NewRequest(http.MethodGet, "/v0/management/auth-files", nil)
	listCtx.Request = listReq
	h.ListAuthFiles(listCtx)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected list status %d, got %d with body %s", http.StatusOK, listRec.Code, listRec.Body.String())
	}
	var listPayload map[string]any
	if errUnmarshal := json.Unmarshal(listRec.Body.Bytes(), &listPayload); errUnmarshal != nil {
		t.Fatalf("failed to decode list payload: %v", errUnmarshal)
	}
	filesRaw, ok := listPayload["files"].([]any)
	if !ok {
		t.Fatalf("expected files array, payload: %#v", listPayload)
	}
	if len(filesRaw) != 0 {
		t.Fatalf("expected removed auth to be hidden from list, got %d entries", len(filesRaw))
	}
}

func TestDeleteAuthFile_FallbackToAuthDirPath(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	authDir := t.TempDir()
	fileName := "fallback-user.json"
	filePath := filepath.Join(authDir, fileName)
	if errWrite := os.WriteFile(filePath, []byte(`{"type":"codex"}`), 0o600); errWrite != nil {
		t.Fatalf("failed to write auth file: %v", errWrite)
	}

	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)
	h.tokenStore = &memoryAuthStore{}

	deleteRec := httptest.NewRecorder()
	deleteCtx, _ := gin.CreateTestContext(deleteRec)
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v0/management/auth-files?name="+url.QueryEscape(fileName), nil)
	deleteCtx.Request = deleteReq
	h.DeleteAuthFile(deleteCtx)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected delete status %d, got %d with body %s", http.StatusOK, deleteRec.Code, deleteRec.Body.String())
	}
	if _, errStat := os.Stat(filePath); !os.IsNotExist(errStat) {
		t.Fatalf("expected auth file to be removed from auth dir, stat err: %v", errStat)
	}
}

func TestDeleteAuthFile_RemovesRuntimeAuth(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	authDir := t.TempDir()
	fileName := "runtime-remove-user.json"
	filePath := filepath.Join(authDir, fileName)
	if errWrite := os.WriteFile(filePath, []byte(`{"type":"codex","email":"runtime@example.com"}`), 0o600); errWrite != nil {
		t.Fatalf("failed to write auth file: %v", errWrite)
	}

	manager := coreauth.NewManager(nil, nil, nil)
	record := &coreauth.Auth{
		ID:       "runtime-remove-auth",
		FileName: fileName,
		Provider: "codex",
		Status:   coreauth.StatusActive,
		Attributes: map[string]string{
			"path": filePath,
		},
		Metadata: map[string]any{
			"type":  "codex",
			"email": "runtime@example.com",
		},
	}
	if _, errRegister := manager.Register(context.Background(), record); errRegister != nil {
		t.Fatalf("failed to register auth record: %v", errRegister)
	}

	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)
	h.tokenStore = &memoryAuthStore{}

	deleteRec := httptest.NewRecorder()
	deleteCtx, _ := gin.CreateTestContext(deleteRec)
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v0/management/auth-files?name="+url.QueryEscape(fileName), nil)
	deleteCtx.Request = deleteReq
	h.DeleteAuthFile(deleteCtx)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected delete status %d, got %d with body %s", http.StatusOK, deleteRec.Code, deleteRec.Body.String())
	}
	if _, ok := manager.GetByID(record.ID); ok {
		t.Fatalf("expected runtime auth %q to be removed", record.ID)
	}
}

func TestDeleteAuthFileV8_QueryArrayAndBracketParams(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	authDir := t.TempDir()
	standardFile := "codex-standard-user@example.com-plus.json"
	singleFile := "codex-abc12345-user@example.com-plus.json"
	batchA := "codex-11111111-a@example.com-plus.json"
	batchB := "codex-22222222-b@example.com-team.json"
	for _, name := range []string{standardFile, singleFile, batchA, batchB} {
		if errWrite := os.WriteFile(filepath.Join(authDir, name), []byte(`{"type":"codex","email":"user@example.com"}`), 0o600); errWrite != nil {
			t.Fatalf("failed to write auth file %s: %v", name, errWrite)
		}
	}

	manager := coreauth.NewManager(nil, nil, nil)
	for _, name := range []string{standardFile, singleFile, batchA, batchB} {
		record := &coreauth.Auth{
			ID:       name,
			FileName: name,
			Provider: "codex",
			Status:   coreauth.StatusActive,
			Attributes: map[string]string{
				"path": filepath.Join(authDir, name),
			},
			Metadata: map[string]any{
				"type": "codex",
			},
		}
		if _, errRegister := manager.Register(context.Background(), record); errRegister != nil {
			t.Fatalf("failed to register auth record %s: %v", name, errRegister)
		}
	}

	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)
	h.tokenStore = &memoryAuthStore{}

	standardRec := httptest.NewRecorder()
	standardCtx, _ := gin.CreateTestContext(standardRec)
	standardCtx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/v8/management/credentials?name="+url.QueryEscape(standardFile),
		nil,
	)
	h.DeleteAuthFileV8(standardCtx)
	if standardRec.Code != http.StatusOK {
		t.Fatalf("standard delete status = %d, want %d: %s", standardRec.Code, http.StatusOK, standardRec.Body.String())
	}
	if _, errStat := os.Stat(filepath.Join(authDir, standardFile)); !os.IsNotExist(errStat) {
		t.Fatalf("expected %s to be deleted, stat err: %v", standardFile, errStat)
	}
	if _, ok := manager.GetByID(standardFile); ok {
		t.Fatalf("expected %s to be unregistered from manager", standardFile)
	}

	singleRec := httptest.NewRecorder()
	singleCtx, _ := gin.CreateTestContext(singleRec)
	singleCtx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/v8/management/credentials?name[]="+url.QueryEscape(singleFile),
		nil,
	)
	h.DeleteAuthFileV8(singleCtx)
	if singleRec.Code != http.StatusOK {
		t.Fatalf("single bracket delete status = %d, want %d: %s", singleRec.Code, http.StatusOK, singleRec.Body.String())
	}
	if _, errStat := os.Stat(filepath.Join(authDir, singleFile)); !os.IsNotExist(errStat) {
		t.Fatalf("expected %s to be deleted, stat err: %v", singleFile, errStat)
	}
	if _, ok := manager.GetByID(singleFile); ok {
		t.Fatalf("expected %s to be unregistered from manager", singleFile)
	}

	batchRec := httptest.NewRecorder()
	batchCtx, _ := gin.CreateTestContext(batchRec)
	batchCtx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/v8/management/credentials?name[]="+url.QueryEscape(batchA)+"&name[]="+url.QueryEscape(batchB),
		nil,
	)
	h.DeleteAuthFileV8(batchCtx)
	if batchRec.Code != http.StatusOK {
		t.Fatalf("batch bracket delete status = %d, want %d: %s", batchRec.Code, http.StatusOK, batchRec.Body.String())
	}
	for _, name := range []string{batchA, batchB} {
		if _, errStat := os.Stat(filepath.Join(authDir, name)); !os.IsNotExist(errStat) {
			t.Fatalf("expected %s to be deleted, stat err: %v", name, errStat)
		}
		if _, ok := manager.GetByID(name); ok {
			t.Fatalf("expected %s to be unregistered from manager", name)
		}
	}
}

func TestDeleteAuthFileV8_RejectsUnsafeBracketNameAndKeepsV0Unchanged(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	authDir := t.TempDir()
	fileName := "codex-safe.json"
	filePath := filepath.Join(authDir, fileName)
	if errWrite := os.WriteFile(filePath, []byte(`{"type":"codex"}`), 0o600); errWrite != nil {
		t.Fatalf("failed to write auth file: %v", errWrite)
	}

	manager := coreauth.NewManager(nil, nil, nil)
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)
	h.tokenStore = &memoryAuthStore{}

	unsafeRec := httptest.NewRecorder()
	unsafeCtx, _ := gin.CreateTestContext(unsafeRec)
	unsafeCtx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/v8/management/credentials?name[]="+url.QueryEscape("../escape.json"),
		nil,
	)
	h.DeleteAuthFileV8(unsafeCtx)
	if unsafeRec.Code != http.StatusBadRequest {
		t.Fatalf("unsafe bracket delete status = %d, want %d: %s", unsafeRec.Code, http.StatusBadRequest, unsafeRec.Body.String())
	}

	v0Rec := httptest.NewRecorder()
	v0Ctx, _ := gin.CreateTestContext(v0Rec)
	v0Ctx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/v0/management/auth-files?name[]="+url.QueryEscape(fileName),
		nil,
	)
	h.DeleteAuthFile(v0Ctx)
	if v0Rec.Code != http.StatusBadRequest {
		t.Fatalf("v0 bracket delete status = %d, want %d: %s", v0Rec.Code, http.StatusBadRequest, v0Rec.Body.String())
	}
	if _, errStat := os.Stat(filePath); errStat != nil {
		t.Fatalf("expected file to remain untouched on v0 request, stat err: %v", errStat)
	}
}
