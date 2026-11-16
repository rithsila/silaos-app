package chat

import (
	"context"
	"encoding/json"
	"errors"
	"iter"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestMultiToolApprovalsProduceUniqueIDs(t *testing.T) {
	var created atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tasks" && r.Method == http.MethodPost {
			created.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-x","title":"ok"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer backend.Close()

	dir := t.TempDir()
	prov := &scriptedProvider{
		fn: func(_ context.Context, _ llm.CompletionRequest, call int) []llm.StreamEvent {
			if call == 1 {
				return []llm.StreamEvent{
					{Type: llm.SEMessageStart},
					{Type: llm.SEToolUseStart, ToolID: "tool_1", ToolName: "lifeos_tasks_create"},
					{Type: llm.SEToolInputJSON, Text: `{"body":{"title":"Task 1"}}`},
					{Type: llm.SEToolUseStart, ToolID: "tool_2", ToolName: "lifeos_tasks_create"},
					{Type: llm.SEToolInputJSON, Text: `{"body":{"title":"Task 2"}}`},
					{Type: llm.SEMessageDelta, StopReason: "tool_use"},
					{Type: llm.SEMessageStop},
				}
			}
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "Created both."},
				{Type: llm.SEMessageDelta, StopReason: "end_turn"},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient(backend.URL, ""), prov)
	sess, err := mgr.CreateSession(context.Background(), "Multi approve")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	approvalCh := make(chan string, 4)
	done := make(chan error, 1)
	go func() {
		done <- mgr.SendMessage(context.Background(), sess.ID, "create two tasks", func(ev StreamEvent) {
			if ev.Type == "approval_required" && ev.Approval != nil {
				approvalCh <- ev.Approval.ToolUseID
			}
		})
	}()

	seen := make(map[string]bool)
	for i := 0; i < 2; i++ {
		select {
		case aid := <-approvalCh:
			if seen[aid] {
				t.Fatalf("duplicate approval ToolUseID %q for tool call %d", aid, i+1)
			}
			seen[aid] = true
			if err := mgr.ResolveApproval(sess.ID, aid, true); err != nil {
				t.Fatalf("ResolveApproval(%q): %v", aid, err)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out waiting for approval #%d", i+1)
		}
	}

	if err := <-done; err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if created.Load() != 2 {
		t.Fatalf("expected 2 created tasks, got %d", created.Load())
	}
}

func TestGetSessionEmptyReturnsNonNilMessages(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), nil)
	sess, err := mgr.CreateSession(context.Background(), "Empty")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	detail, err := mgr.GetSession(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if detail.Messages == nil {
		t.Fatalf("expected non-nil Messages slice for empty session (so JSON serializes [] instead of null)")
	}
}

func TestRenameAndRewindSession(t *testing.T) {
	dir := t.TempDir()
	prov := &scriptedProvider{
		fn: func(_ context.Context, _ llm.CompletionRequest, call int) []llm.StreamEvent {
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "Reply #" + string(rune('0'+call))},
				{Type: llm.SEMessageDelta, StopReason: "end_turn"},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	sess, err := mgr.CreateSession(context.Background(), "")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Send two turns
	if err := mgr.SendMessage(context.Background(), sess.ID, "First prompt", func(StreamEvent) {}); err != nil {
		t.Fatalf("turn 1: %v", err)
	}
	if err := mgr.SendMessage(context.Background(), sess.ID, "Second prompt", func(StreamEvent) {}); err != nil {
		t.Fatalf("turn 2: %v", err)
	}

	// Rename session
	renamed, err := mgr.RenameSession(context.Background(), sess.ID, "Renamed Thread")
	if err != nil {
		t.Fatalf("RenameSession: %v", err)
	}
	if renamed.Title != "Renamed Thread" {
		t.Fatalf("expected Renamed Thread, got %q", renamed.Title)
	}
	if _, err := mgr.RenameSession(context.Background(), sess.ID, "   "); !errors.Is(err, ErrInvalidTitle) {
		t.Fatalf("expected ErrInvalidTitle, got %v", err)
	}

	// Rewind to index 2 (second user prompt) and edit it
	idx2 := 2
	if err := mgr.SendMessageFrom(context.Background(), sess.ID, "Edited second prompt", &idx2, func(StreamEvent) {}); err != nil {
		t.Fatalf("SendMessageFrom idx 2: %v", err)
	}

	detail, err := mgr.GetSession(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if len(detail.Messages) != 4 {
		t.Fatalf("expected 4 messages after rewind from 2, got %d: %+v", len(detail.Messages), detail.Messages)
	}
	if detail.Messages[2].Text != "Edited second prompt" || detail.Messages[3].Text != "Reply #3" {
		t.Fatalf("unexpected rewound turn: %+v", detail.Messages[2:])
	}

	// Rewind from 0 clears transcript cleanly and resets with new message
	idx0 := 0
	if err := mgr.SendMessageFrom(context.Background(), sess.ID, "Fresh first prompt", &idx0, func(StreamEvent) {}); err != nil {
		t.Fatalf("SendMessageFrom idx 0: %v", err)
	}
	detail2, _ := mgr.GetSession(context.Background(), sess.ID)
	if len(detail2.Messages) != 2 || detail2.Messages[0].Text != "Fresh first prompt" {
		t.Fatalf("expected 2 messages after idx 0 rewind, got %+v", detail2.Messages)
	}

	// Out-of-range rewind returns ErrInvalidMessageIndex
	bad := 99
	if err := mgr.SendMessageFrom(context.Background(), sess.ID, "Oops", &bad, func(StreamEvent) {}); !errors.Is(err, ErrInvalidMessageIndex) {
		t.Fatalf("expected ErrInvalidMessageIndex, got %v", err)
	}
}

func TestGetSessionIncludesBusyAndPendingApprovalsAndCancelUnblocks(t *testing.T) {
	dir := t.TempDir()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer backend.Close()

	prov := &scriptedProvider{
		fn: func(_ context.Context, _ llm.CompletionRequest, call int) []llm.StreamEvent {
			if call == 1 {
				return []llm.StreamEvent{
					{Type: llm.SEMessageStart},
					{Type: llm.SEToolUseStart, ToolID: "call-create", ToolName: "lifeos_tasks_create"},
					{Type: llm.SEToolInputJSON, Text: `{"body":{"title":"Task 1"}}`},
					{Type: llm.SEMessageDelta, StopReason: "tool_use"},
					{Type: llm.SEMessageStop},
				}
			}
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "Done"},
				{Type: llm.SEMessageDelta, StopReason: "end_turn"},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient(backend.URL, ""), prov)
	sess, err := mgr.CreateSession(context.Background(), "Pending approval state")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	approvalCh := make(chan ApprovalRequest, 1)
	done := make(chan error, 1)
	go func() {
		done <- mgr.SendMessage(context.Background(), sess.ID, "delete task t-1", func(ev StreamEvent) {
			if ev.Type == "approval_required" && ev.Approval != nil {
				approvalCh <- *ev.Approval
			}
		})
	}()

	var req ApprovalRequest
	select {
	case req = <-approvalCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for approval_required")
	}

	detail, err := mgr.GetSession(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("GetSession while pending: %v", err)
	}
	if !detail.Busy {
		t.Fatalf("expected GetSession.Busy = true while awaiting approval")
	}
	if len(detail.PendingApprovals) != 1 || detail.PendingApprovals[0].ToolUseID != req.ToolUseID {
		t.Fatalf("expected pending approval %s in GetSession, got %+v", req.ToolUseID, detail.PendingApprovals)
	}

	cancelled, err := mgr.CancelSession(sess.ID)
	if err != nil {
		t.Fatalf("CancelSession: %v", err)
	}
	if !cancelled {
		t.Fatalf("expected CancelSession to return cancelled=true")
	}

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for SendMessage to exit after CancelSession")
	}

	after, err := mgr.GetSession(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("GetSession after cancel: %v", err)
	}
	if after.Busy || len(after.PendingApprovals) != 0 {
		t.Fatalf("expected clean state after cancel, got busy=%v pending=%d", after.Busy, len(after.PendingApprovals))
	}
}

func TestCustomInstructionsPersistenceAndPromptInjection(t *testing.T) {
	dir := t.TempDir()
	var capturedSystems [][]string

	prov := &scriptedProvider{
		fn: func(_ context.Context, req llm.CompletionRequest, _ int) []llm.StreamEvent {
			cp := append([]string(nil), req.System...)
			capturedSystems = append(capturedSystems, cp)
			return []llm.StreamEvent{
				{Type: llm.SEMessageStart},
				{Type: llm.SETextDelta, Text: "ok"},
				{Type: llm.SEMessageDelta, StopReason: "end_turn"},
				{Type: llm.SEMessageStop},
			}
		},
	}

	mgr := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)

	initial := mgr.GetInstructions()
	if initial.Enabled || initial.Instructions != "" {
		t.Fatalf("expected empty disabled default instructions, got %+v", initial)
	}

	// Reject oversized instructions without overwriting state.
	tooLong := strings.Repeat("x", MaxInstructionsLength+1)
	if _, err := mgr.UpdateInstructions(true, tooLong); !errors.Is(err, ErrInstructionsTooLong) {
		t.Fatalf("expected ErrInstructionsTooLong, got %v", err)
	}

	// Valid update trims whitespace and persists across NewManager reload.
	saved, err := mgr.UpdateInstructions(true, "  Reply in short bullet points.  ")
	if err != nil {
		t.Fatalf("UpdateInstructions: %v", err)
	}
	if !saved.Enabled || saved.Instructions != "Reply in short bullet points." || saved.UpdatedAt.IsZero() {
		t.Fatalf("unexpected saved instructions: %+v", saved)
	}

	mgr2 := NewManager(config.Config{DataDir: dir, LLMAPIKey: "test"}, lifeostools.NewClient("http://127.0.0.1:1", ""), prov)
	reloaded := mgr2.GetInstructions()
	if !reloaded.Enabled || reloaded.Instructions != "Reply in short bullet points." {
		t.Fatalf("expected persisted instructions after reload, got %+v", reloaded)
	}

	sess, err := mgr2.CreateSession(context.Background(), "Custom instructions check")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Enabled + non-empty -> appended after core system prompt & deferred tools.
	if err := mgr2.SendMessage(context.Background(), sess.ID, "hello", func(StreamEvent) {}); err != nil {
		t.Fatalf("SendMessage (enabled): %v", err)
	}
	if len(capturedSystems) != 1 {
		t.Fatalf("expected 1 LLM call, got %d", len(capturedSystems))
	}
	sys := capturedSystems[0]
	customIdx := -1
	for i, seg := range sys {
		if strings.Contains(seg, "User custom instructions:\nReply in short bullet points.") {
			customIdx = i
			break
		}
	}
	if customIdx <= 0 {
		t.Fatalf("expected custom instructions segment after base prompt, got %#v", sys)
	}
	if !strings.Contains(sys[customIdx], "never override") {
		t.Fatalf("expected safety guard in custom instructions segment, got %q", sys[customIdx])
	}

	// Disabled -> NOT included in req.System.
	if _, err := mgr2.UpdateInstructions(false, "Reply in short bullet points."); err != nil {
		t.Fatalf("UpdateInstructions disable: %v", err)
	}
	if err := mgr2.SendMessage(context.Background(), sess.ID, "hello again", func(StreamEvent) {}); err != nil {
		t.Fatalf("SendMessage (disabled): %v", err)
	}
	for _, seg := range capturedSystems[1] {
		if strings.Contains(seg, "User custom instructions:") {
			t.Fatalf("expected no custom instructions when disabled, got %#v", capturedSystems[1])
		}
	}

	// Enabled but blank -> NOT included in req.System.
	if _, err := mgr2.UpdateInstructions(true, "   "); err != nil {
		t.Fatalf("UpdateInstructions blank: %v", err)
	}
	if err := mgr2.SendMessage(context.Background(), sess.ID, "hello blank", func(StreamEvent) {}); err != nil {
		t.Fatalf("SendMessage (blank): %v", err)
	}
	for _, seg := range capturedSystems[2] {
		if strings.Contains(seg, "User custom instructions:") {
			t.Fatalf("expected no custom instructions when blank, got %#v", capturedSystems[2])
		}
	}
}
