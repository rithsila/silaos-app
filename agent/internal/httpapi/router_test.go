package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"iter"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Autumn-27/norma/llm"

	"lifeos-agent/internal/chat"
	"lifeos-agent/internal/config"
	"lifeos-agent/internal/lifeostools"
)

type mockLLM struct{}

func (m *mockLLM) Stream(_ context.Context, _ llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	return func(yield func(llm.StreamEvent, error) bool) {
		if !yield(llm.StreamEvent{Type: llm.SEMessageStart}, nil) {
			return
		}
		if !yield(llm.StreamEvent{Type: llm.SETextDelta, Text: "Hi from Norma"}, nil) {
			return
		}
		if !yield(llm.StreamEvent{Type: llm.SEMessageDelta, StopReason: "end_turn"}, nil) {
			return
		}
		yield(llm.StreamEvent{Type: llm.SEMessageStop}, nil)
	}
}

func (m *mockLLM) Complete(_ context.Context, _ llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	return llm.Message{}, "end_turn", llm.Usage{}, nil
}

func newTestRouter(t *testing.T, apiKey string, prov llm.Provider) http.Handler {
	t.Helper()
	cfg := config.Config{
		DataDir:   t.TempDir(),
		APIKey:    apiKey,
		LLMAPIKey: "test-key",
		Provider:  "openai",
		Model:     "gpt-4o-mini",
	}
	if prov == nil {
		cfg.LLMAPIKey = ""
	}
	mgr := chat.NewManager(cfg, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	return NewRouter(cfg, mgr)
}

func TestAuthMiddleware(t *testing.T) {
	h := newTestRouter(t, "secret-123", &mockLLM{})

	// /health is always public
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected /health 200, got %d", rec.Code)
	}

	// /api/chat/sessions requires Bearer token when APIKey is set
	req2 := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec2.Code)
	}

	req3 := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	req3.Header.Set("Authorization", "Bearer secret-123")
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200 with valid token, got %d", rec3.Code)
	}
}

func TestSessionCRUD(t *testing.T) {
	h := newTestRouter(t, "", &mockLLM{})

	// Create
	req := httptest.NewRequest(http.MethodPost, "/api/chat/sessions", bytes.NewBufferString(`{"title":"Sprint Plan"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var created chat.SessionSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal created: %v", err)
	}
	if created.ID == "" || created.Title != "Sprint Plan" {
		t.Fatalf("unexpected created session: %+v", created)
	}

	// List
	reqList := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
	recList := httptest.NewRecorder()
	h.ServeHTTP(recList, reqList)
	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 on list, got %d", recList.Code)
	}
	var listWrap struct {
		Sessions []chat.SessionSummary `json:"sessions"`
	}
	if err := json.Unmarshal(recList.Body.Bytes(), &listWrap); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(listWrap.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(listWrap.Sessions))
	}

	// Rename
	reqRename := httptest.NewRequest(http.MethodPatch, "/api/chat/sessions/"+created.ID, bytes.NewBufferString(`{"title":"Updated Plan"}`))
	recRename := httptest.NewRecorder()
	h.ServeHTTP(recRename, reqRename)
	if recRename.Code != http.StatusOK {
		t.Fatalf("expected 200 on rename, got %d: %s", recRename.Code, recRename.Body.String())
	}
	var renamed chat.SessionSummary
	if err := json.Unmarshal(recRename.Body.Bytes(), &renamed); err != nil {
		t.Fatalf("unmarshal renamed: %v", err)
	}
	if renamed.Title != "Updated Plan" {
		t.Fatalf("expected Updated Plan, got %q", renamed.Title)
	}

	// Delete
	reqDel := httptest.NewRequest(http.MethodDelete, "/api/chat/sessions/"+created.ID, nil)
	recDel := httptest.NewRecorder()
	h.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on delete, got %d", recDel.Code)
	}
}

func TestSSEStreamFormat(t *testing.T) {
	h := newTestRouter(t, "", &mockLLM{})

	// Create session first
	recCreate := httptest.NewRecorder()
	h.ServeHTTP(recCreate, httptest.NewRequest(http.MethodPost, "/api/chat/sessions", bytes.NewBufferString(`{}`)))
	var created chat.SessionSummary
	_ = json.Unmarshal(recCreate.Body.Bytes(), &created)

	srv := httptest.NewServer(h)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/chat/sessions/"+created.ID+"/message", "application/json", bytes.NewBufferString(`{"message":"Hello"}`))
	if err != nil {
		t.Fatalf("POST message: %v", err)
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-transform") {
		t.Fatalf("expected Cache-Control to contain no-transform, got %q", cc)
	}
	if xab := resp.Header.Get("X-Accel-Buffering"); xab != "no" {
		t.Fatalf("expected X-Accel-Buffering=no, got %q", xab)
	}
	raw, _ := io.ReadAll(resp.Body)
	body := string(raw)
	if !strings.Contains(body, "event: text\n") || !strings.Contains(body, "Hi from Norma") || !strings.Contains(body, "event: done\n") {
		t.Fatalf("unexpected SSE payload:\n%s", body)
	}
}

func TestErrorShapeMatchesRust(t *testing.T) {
	h := newTestRouter(t, "", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/chat/sessions/missing-id", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	var errBody map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("invalid error JSON: %v", err)
	}
	if errBody["error"] == "" {
		t.Fatalf("expected non-empty error field, got %v", errBody)
	}
}

func TestCancelRoute(t *testing.T) {
	h := newTestRouter(t, "", &mockLLM{})

	recCreate := httptest.NewRecorder()
	h.ServeHTTP(recCreate, httptest.NewRequest(http.MethodPost, "/api/chat/sessions", bytes.NewBufferString(`{}`)))
	var created chat.SessionSummary
	_ = json.Unmarshal(recCreate.Body.Bytes(), &created)

	recCancel := httptest.NewRecorder()
	h.ServeHTTP(recCancel, httptest.NewRequest(http.MethodPost, "/api/chat/sessions/"+created.ID+"/cancel", nil))
	if recCancel.Code != http.StatusOK {
		t.Fatalf("expected 200 on cancel, got %d: %s", recCancel.Code, recCancel.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recCancel.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal cancel: %v", err)
	}
	if payload["ok"] != true || payload["cancelled"] != false {
		t.Fatalf("unexpected cancel payload: %+v", payload)
	}
}

func TestCustomInstructionsRoutes(t *testing.T) {
	h := newTestRouter(t, "", &mockLLM{})

	// Default GET returns disabled empty instructions.
	recGet := httptest.NewRecorder()
	h.ServeHTTP(recGet, httptest.NewRequest(http.MethodGet, "/api/chat/instructions", nil))
	if recGet.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET, got %d: %s", recGet.Code, recGet.Body.String())
	}
	var initial chat.CustomInstructions
	if err := json.Unmarshal(recGet.Body.Bytes(), &initial); err != nil {
		t.Fatalf("unmarshal GET: %v", err)
	}
	if initial.Enabled || initial.Instructions != "" {
		t.Fatalf("expected empty disabled instructions, got %+v", initial)
	}

	// PUT updates and trims instructions.
	recPut := httptest.NewRecorder()
	h.ServeHTTP(
		recPut,
		httptest.NewRequest(
			http.MethodPut,
			"/api/chat/instructions",
			bytes.NewBufferString(`{"enabled":true,"instructions":"  Use simple English.  "}`),
		),
	)
	if recPut.Code != http.StatusOK {
		t.Fatalf("expected 200 on PUT, got %d: %s", recPut.Code, recPut.Body.String())
	}
	var updated chat.CustomInstructions
	if err := json.Unmarshal(recPut.Body.Bytes(), &updated); err != nil {
		t.Fatalf("unmarshal PUT: %v", err)
	}
	if !updated.Enabled || updated.Instructions != "Use simple English." {
		t.Fatalf("unexpected PUT response: %+v", updated)
	}

	// Subsequent GET reflects saved instructions.
	recGet2 := httptest.NewRecorder()
	h.ServeHTTP(recGet2, httptest.NewRequest(http.MethodGet, "/api/chat/instructions", nil))
	var after chat.CustomInstructions
	if err := json.Unmarshal(recGet2.Body.Bytes(), &after); err != nil {
		t.Fatalf("unmarshal GET 2: %v", err)
	}
	if !after.Enabled || after.Instructions != "Use simple English." {
		t.Fatalf("expected persisted instructions on GET, got %+v", after)
	}

	// Exceeding max length returns 400 with error JSON.
	oversized := strings.Repeat("a", chat.MaxInstructionsLength+1)
	body, _ := json.Marshal(map[string]any{"enabled": true, "instructions": oversized})
	recTooLong := httptest.NewRecorder()
	h.ServeHTTP(recTooLong, httptest.NewRequest(http.MethodPut, "/api/chat/instructions", bytes.NewReader(body)))
	if recTooLong.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized instructions, got %d: %s", recTooLong.Code, recTooLong.Body.String())
	}
	var errPayload map[string]string
	if err := json.Unmarshal(recTooLong.Body.Bytes(), &errPayload); err != nil || errPayload["error"] == "" {
		t.Fatalf("expected error JSON, got %s", recTooLong.Body.String())
	}

	// Auth middleware protects instructions endpoints.
	authH := newTestRouter(t, "secret-123", &mockLLM{})
	recUnauth := httptest.NewRecorder()
	authH.ServeHTTP(recUnauth, httptest.NewRequest(http.MethodGet, "/api/chat/instructions", nil))
	if recUnauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", recUnauth.Code)
	}
}
