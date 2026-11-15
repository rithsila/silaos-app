package chat

import (
	"context"
	"encoding/json"
	"errors"
	"iter"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Autumn-27/norma/llm"

	"lifeos-agent/internal/config"
	"lifeos-agent/internal/lifeostools"
)

type scriptedProvider struct {
	fn func(ctx context.Context, req llm.CompletionRequest, call int) []llm.StreamEvent
	n  atomic.Int32
}

func (p *scriptedProvider) Stream(ctx context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	call := int(p.n.Add(1))
	events := p.fn(ctx, req, call)
	return func(yield func(llm.StreamEvent, error) bool) {
		for _, ev := range events {
			if ctx.Err() != nil {
				yield(llm.StreamEvent{}, ctx.Err())
				return
			}
			if !yield(ev, nil) {
				return
			}
		}
	}
}

func (p *scriptedProvider) Complete(_ context.Context, _ llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	return llm.Message{}, "end_turn", llm.Usage{}, nil
}

func TestSendMessageStreamsAndPersists(t *testing.T) {
	dir := t.TempDir()
	prov := &scriptedProvider{
		fn: func(_ context.Context, _ llm.CompletionRequest, _ int) []llm.StreamEvent {
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "Hello "},
				{Type: llm.SETextDelta, Text: "Rithsila!"},
				{Type: llm.SEMessageDelta, StopReason: "end_turn", Usage: llm.Usage{InputTokens: 10, OutputTokens: 5}},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	sess, err := mgr.CreateSession(context.Background(), "Morning check-in")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	var gotText string
	var gotDone bool
	err = mgr.SendMessage(context.Background(), sess.ID, "Hi Norma", func(ev StreamEvent) {
		if ev.Type == "text" {
			gotText += ev.Text
		}
		if ev.Type == "done" {
			gotDone = true
		}
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if gotText != "Hello Rithsila!" {
		t.Fatalf("expected streamed text 'Hello Rithsila!', got %q", gotText)
	}
	if !gotDone {
		t.Fatalf("expected done event")
	}

	// Re-open Manager over the same DataDir and verify persistence.
	mgr2 := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	list, err := mgr2.ListSessions(context.Background())
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(list) != 1 || list[0].ID != sess.ID {
		t.Fatalf("expected persisted session %s, got %+v", sess.ID, list)
	}

	detail, err := mgr2.GetSession(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if len(detail.Messages) < 2 {
		t.Fatalf("expected at least 2 persisted messages (user + assistant), got %d", len(detail.Messages))
	}
}

func TestConcurrentPromptRejected(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	release := make(chan struct{})

	prov := &scriptedProvider{
		fn: func(_ context.Context, _ llm.CompletionRequest, _ int) []llm.StreamEvent {
			close(started)
			<-release
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "done"},
				{Type: llm.SEMessageDelta, StopReason: "end_turn"},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	sess, err := mgr.CreateSession(context.Background(), "Busy")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	firstDone := make(chan error, 1)
	go func() {
		firstDone <- mgr.SendMessage(context.Background(), sess.ID, "slow turn", func(StreamEvent) {})
	}()

	<-started
	err2 := mgr.SendMessage(context.Background(), sess.ID, "second turn", func(StreamEvent) {})
	if !errors.Is(err2, ErrSessionBusy) {
		t.Fatalf("expected ErrSessionBusy, got %v", err2)
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("first SendMessage failed: %v", err)
	}
}

func TestToolApprovalBlocksUntilResolved(t *testing.T) {
	var createdCount atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tasks" && r.Method == http.MethodPost {
			createdCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","title":"Buy milk"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer backend.Close()

	runWithDecision := func(allow bool) (int32, bool) {
		dir := t.TempDir()
		var sawDeniedResult atomic.Bool
		prov := &scriptedProvider{
			fn: func(_ context.Context, req llm.CompletionRequest, call int) []llm.StreamEvent {
				if call == 1 {
					return []llm.StreamEvent{
						{Type: llm.SEMessageStart},
						{Type: llm.SEToolUseStart, ToolID: "tool_1", ToolName: "lifeos_tasks_create"},
						{Type: llm.SEToolInputJSON, Text: `{"body":{"title":"Buy milk"}}`},
						{Type: llm.SEMessageDelta, StopReason: "tool_use"},
						{Type: llm.SEMessageStop},
					}
				}
				for _, m := range req.Messages {
					for _, b := range m.Content {
						if b.Type == llm.BlockToolResult && b.IsError {
							sawDeniedResult.Store(true)
						}
					}
				}
				return []llm.StreamEvent{
					{Type: llm.SEMessageStart},
					{Type: llm.SETextDelta, Text: "All set"},
					{Type: llm.SEMessageDelta, StopReason: "end_turn"},
					{Type: llm.SEMessageStop},
				}
			},
		}

		mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient(backend.URL, ""), prov)
		sess, err := mgr.CreateSession(context.Background(), "Approve test")
		if err != nil {
			t.Fatalf("CreateSession: %v", err)
		}

		approvalCh := make(chan string, 1)
		before := createdCount.Load()
		done := make(chan error, 1)
		go func() {
			done <- mgr.SendMessage(context.Background(), sess.ID, "create task Buy milk", func(ev StreamEvent) {
				if ev.Type == "approval_required" && ev.Approval != nil {
					approvalCh <- ev.Approval.ToolUseID
				}
			})
		}()

		select {
		case toolUseID := <-approvalCh:
			if err := mgr.ResolveApproval(sess.ID, toolUseID, allow); err != nil {
				t.Fatalf("ResolveApproval: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for approval_required event")
		}

		if err := <-done; err != nil {
			t.Fatalf("SendMessage: %v", err)
		}
		return createdCount.Load() - before, sawDeniedResult.Load()
	}

	// Allow = true executes backend POST
	deltaAllow, _ := runWithDecision(true)
	if deltaAllow != 1 {
		t.Fatalf("expected 1 POST when approved, got %d", deltaAllow)
	}

	// Allow = false blocks backend POST and feeds error result back to model
	deltaDeny, sawErr := runWithDecision(false)
	if deltaDeny != 0 {
		t.Fatalf("expected 0 POSTs when denied, got %d", deltaDeny)
	}
	if !sawErr {
		t.Fatalf("expected denied tool result to be sent back to model")
	}

	_ = json.Marshal // keep import clean if needed
}

func TestMissingProviderReturnsClearError(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: ""}, lifeostools.NewClient("http://127.0.0.1:1", ""), nil)
	sess, err := mgr.CreateSession(context.Background(), "No key")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	err = mgr.SendMessage(context.Background(), sess.ID, "hello", func(StreamEvent) {})
	if !errors.Is(err, ErrLLMNotConfigured) {
		t.Fatalf("expected ErrLLMNotConfigured, got %v", err)
	}
}
