package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/compaction"
	"github.com/Autumn-27/norma/harness"
	"github.com/Autumn-27/norma/hook"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/norma/memory"
	"github.com/Autumn-27/norma/permission"
	"github.com/Autumn-27/norma/tool"
	"github.com/Autumn-27/norma/transcript"

	"lifeos-agent/internal/config"
	"lifeos-agent/internal/lifeostools"
)

var (
	ErrSessionNotFound  = errors.New("chat session not found")
	ErrSessionBusy      = errors.New("chat session is already processing a message")
	ErrApprovalNotFound = errors.New("pending tool approval not found")
	ErrLLMNotConfigured = errors.New("LLM API key is not configured (set AGENT_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)")
)

const approvalTimeout = 5 * time.Minute

// SessionSummary describes a persisted chat thread.
type SessionSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ToolTrace records a tool invocation inside a chat message.
type ToolTrace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Input   string `json:"input,omitempty"`
	Result  string `json:"result,omitempty"`
	IsError bool   `json:"isError,omitempty"`
}

// ChatMessage is the UI-friendly representation of a persisted turn.
type ChatMessage struct {
	Role      string      `json:"role"`
	Text      string      `json:"text"`
	ToolCalls []ToolTrace `json:"toolCalls,omitempty"`
}

// SessionDetail includes thread metadata and persisted messages.
type SessionDetail struct {
	SessionSummary
	Messages []ChatMessage `json:"messages"`
}

// ApprovalRequest is emitted over SSE when a mutating tool awaits confirmation.
type ApprovalRequest struct {
	ToolUseID string          `json:"toolUseId"`
	ToolName  string          `json:"toolName"`
	Input     json.RawMessage `json:"input"`
}

// StreamEvent is emitted to SSE subscribers during SendMessage.
type StreamEvent struct {
	Type     string           `json:"type"`
	Text     string           `json:"text,omitempty"`
	Tool     *ToolTrace       `json:"tool,omitempty"`
	Approval *ApprovalRequest `json:"approval,omitempty"`
	Usage    *llm.Usage       `json:"usage,omitempty"`
	Error    string           `json:"error,omitempty"`
}

type sessionRuntime struct {
	busy    bool
	pending map[string]chan bool
}

// Manager coordinates Norma sessions, transcripts, memory, and tool approvals.
type Manager struct {
	cfg        config.Config
	client     *lifeostools.Client
	provider   llm.Provider
	transcript *transcript.Store
	memory     *memory.Store

	mu       sync.Mutex
	sessions map[string]SessionSummary
	runtimes map[string]*sessionRuntime
}

// NewManager creates a Manager rooted at cfg.DataDir. If provider is nil, it
// attempts to construct one from cfg when cfg.LLMAPIKey is non-empty.
func NewManager(cfg config.Config, client *lifeostools.Client, provider llm.Provider) *Manager {
	if provider == nil && cfg.LLMAPIKey != "" {
		format := llm.FormatOpenAI
		switch cfg.Provider {
		case "anthropic":
			format = llm.FormatAnthropic
		case "openai-responses":
			format = llm.FormatOpenAIResponses
		}
		if p, err := llm.NewProvider(llm.Config{
			Format:  format,
			BaseURL: cfg.BaseURL,
			APIKey:  cfg.LLMAPIKey,
			Model:   cfg.Model,
		}); err == nil {
			provider = p
		}
	}

	m := &Manager{
		cfg:        cfg,
		client:     client,
		provider:   provider,
		transcript: transcript.NewStore(filepath.Join(cfg.DataDir, "transcripts")),
		memory:     memory.NewStore(filepath.Join(cfg.DataDir, "memory")),
		sessions:   make(map[string]SessionSummary),
		runtimes:   make(map[string]*sessionRuntime),
	}
	_ = m.loadIndex()
	return m
}

func (m *Manager) indexPath() string {
	return filepath.Join(m.cfg.DataDir, "sessions.json")
}

func (m *Manager) loadIndex() error {
	b, err := os.ReadFile(m.indexPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var list []SessionSummary
	if err := json.Unmarshal(b, &list); err != nil {
		return err
	}
	for _, s := range list {
		m.sessions[s.ID] = s
	}
	return nil
}

func (m *Manager) saveIndexLocked() error {
	if err := os.MkdirAll(m.cfg.DataDir, 0o755); err != nil {
		return err
	}
	list := make([]SessionSummary, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].UpdatedAt.After(list[j].UpdatedAt)
	})
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.indexPath(), b, 0o644)
}

func (m *Manager) ListSessions(_ context.Context) ([]SessionSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SessionSummary, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

func (m *Manager) CreateSession(_ context.Context, title string) (SessionSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	t := strings.TrimSpace(title)
	if t == "" {
		t = "New Chat"
	}
	s := SessionSummary{
		ID:        newID(),
		Title:     t,
		CreatedAt: now,
		UpdatedAt: now,
	}
	m.sessions[s.ID] = s
	if err := m.saveIndexLocked(); err != nil {
		return SessionSummary{}, err
	}
	return s, nil
}

func (m *Manager) GetSession(_ context.Context, id string) (*SessionDetail, error) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return nil, ErrSessionNotFound
	}

	msgs := make([]ChatMessage, 0)
	recs, err := m.transcript.Load(m.transcript.MainPath(id))
	if err == nil {
		raw, _ := transcript.Messages(recs)
		msgs = toChatMessages(raw)
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	return &SessionDetail{
		SessionSummary: s,
		Messages:       msgs,
	}, nil
}

func (m *Manager) DeleteSession(_ context.Context, id string) error {
	m.mu.Lock()
	if _, ok := m.sessions[id]; !ok {
		m.mu.Unlock()
		return ErrSessionNotFound
	}
	if rt := m.runtimes[id]; rt != nil && rt.busy {
		m.mu.Unlock()
		return ErrSessionBusy
	}
	delete(m.sessions, id)
	delete(m.runtimes, id)
	err := m.saveIndexLocked()
	m.mu.Unlock()

	_ = os.Remove(m.transcript.MainPath(id))
	return err
}

func (m *Manager) ListMemories() ([]memory.Memory, error) {
	items, err := m.memory.Scan()
	if err != nil {
		return nil, err
	}
	if items == nil {
		return make([]memory.Memory, 0), nil
	}
	return items, nil
}

func (m *Manager) ResolveApproval(sessionID, toolUseID string, allow bool) error {
	m.mu.Lock()
	rt := m.runtimes[sessionID]
	if rt == nil {
		m.mu.Unlock()
		return ErrApprovalNotFound
	}
	ch, ok := rt.pending[toolUseID]
	if ok {
		delete(rt.pending, toolUseID)
	}
	m.mu.Unlock()

	if !ok {
		return ErrApprovalNotFound
	}
	select {
	case ch <- allow:
	default:
	}
	return nil
}

func (m *Manager) SendMessage(ctx context.Context, id, text string, emit func(StreamEvent)) error {
	if m.provider == nil {
		return ErrLLMNotConfigured
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message text is required")
	}

	m.mu.Lock()
	sessMeta, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return ErrSessionNotFound
	}
	rt := m.runtimes[id]
	if rt == nil {
		rt = &sessionRuntime{pending: make(map[string]chan bool)}
		m.runtimes[id] = rt
	}
	if rt.busy {
		m.mu.Unlock()
		return ErrSessionBusy
	}
	rt.busy = true
	if sessMeta.Title == "New Chat" {
		sessMeta.Title = summarizeTitle(text)
		m.sessions[id] = sessMeta
		_ = m.saveIndexLocked()
	}
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		rt.busy = false
		for k, ch := range rt.pending {
			close(ch)
			delete(rt.pending, k)
		}
		if s, exists := m.sessions[id]; exists {
			s.UpdatedAt = time.Now().UTC()
			m.sessions[id] = s
			_ = m.saveIndexLocked()
		}
		m.mu.Unlock()
	}()

	allTools, deferredNames := lifeostools.AllTools(m.client)
	toolMap := make(map[string]tool.CoreTool, len(allTools))
	for _, t := range allTools {
		toolMap[t.Name()] = t
	}

	requestApproval := func(actx context.Context, toolName string, input json.RawMessage) bool {
		callID := "apr_" + newID()
		ch := make(chan bool, 1)
		m.mu.Lock()
		rt.pending[callID] = ch
		m.mu.Unlock()

		emit(StreamEvent{
			Type: "approval_required",
			Approval: &ApprovalRequest{
				ToolUseID: callID,
				ToolName:  toolName,
				Input:     append(json.RawMessage(nil), input...),
			},
		})

		timer := time.NewTimer(approvalTimeout)
		defer timer.Stop()

		select {
		case allow, open := <-ch:
			return open && allow
		case <-actx.Done():
			m.mu.Lock()
			delete(rt.pending, callID)
			m.mu.Unlock()
			return false
		case <-timer.C:
			m.mu.Lock()
			delete(rt.pending, callID)
			m.mu.Unlock()
			return false
		}
	}

	hooks := hook.NewRegistry()
	hooks.On(hook.PreToolUse, func(hctx context.Context, ev hook.Event) hook.Result {
		// Enforce user approval when ExecuteExtraTool invokes a deferred mutating tool.
		if ev.ToolName != tool.ExecuteExtraToolName {
			return hook.Result{}
		}
		var args struct {
			ToolName string          `json:"tool_name"`
			Params   json.RawMessage `json:"params"`
		}
		if json.Unmarshal(ev.Input, &args) != nil {
			return hook.Result{}
		}
		target, exists := toolMap[args.ToolName]
		if !exists || target.IsReadOnly(args.Params) {
			return hook.Result{}
		}
		if !requestApproval(hctx, args.ToolName, args.Params) {
			return hook.Result{Decision: "block", Message: "denied by user"}
		}
		return hook.Result{}
	})

	sysSegments := []string{lifeosSystemPrompt}
	if defBlock := tool.RenderDeferredToolsBlock(deferredNames); defBlock != "" {
		sysSegments = append(sysSegments, defBlock)
	}

	sess := agentcore.NewSession(agentcore.Options{
		Provider:        m.provider,
		SystemPrompt:    sysSegments,
		DynamicBoundary: len(sysSegments),
		Tools:           allTools,
		DeferredTools:   deferredNames,
		PermissionMode:  permission.ModeDefault,
		CanUseTool: func(cctx context.Context, toolName string, input json.RawMessage, _ permission.Context) permission.Decision {
			if requestApproval(cctx, toolName, input) {
				return permission.Allowed()
			}
			return permission.Denied("denied by user")
		},
		Hooks: hooks,
		Compaction: &compaction.Config{
			ContextWindow:   128000,
			MaxOutputTokens: 8000,
			KeepRecent:      10,
		},
		Memory: &agentcore.MemoryOptions{
			Store:                m.memory,
			AutoInject:           true,
			MaxInject:            3,
			IncludeIndexInPrompt: true,
		},
		Transcript:             m.transcript,
		SessionID:              id,
		MaxTurns:               20,
		DisableBackgroundTasks: true,
		SystemReminderFunc: func() string {
			sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			return lifeostools.BuildSnapshot(sctx, m.client)
		},
	})
	defer sess.Close()

	if _, statErr := os.Stat(m.transcript.MainPath(id)); statErr == nil {
		if err := sess.Resume(id); err != nil {
			return fmt.Errorf("resume session: %w", err)
		}
	}

	for ev, err := range sess.Prompt(ctx, text) {
		if err != nil {
			emit(StreamEvent{Type: "error", Error: err.Error()})
			return err
		}
		switch ev.Kind {
		case harness.KindText:
			emit(StreamEvent{Type: "text", Text: ev.Text})
		case harness.KindThinking:
			emit(StreamEvent{Type: "thinking", Text: ev.Text})
		case harness.KindToolUse:
			if ev.ToolUse != nil {
				emit(StreamEvent{
					Type: "tool_use",
					Tool: &ToolTrace{
						ID:    ev.ToolUse.ID,
						Name:  ev.ToolUse.Name,
						Input: string(ev.ToolUse.Input),
					},
				})
			}
		case harness.KindToolResult:
			if ev.ToolResult != nil {
				emit(StreamEvent{
					Type: "tool_result",
					Tool: &ToolTrace{
						ID:      ev.ToolResult.ToolUseID,
						Result:  extractBlockText(ev.ToolResult.Content),
						IsError: ev.ToolResult.IsError,
					},
				})
			}
		case harness.KindUsage:
			if ev.Usage != nil {
				u := *ev.Usage
				emit(StreamEvent{Type: "usage", Usage: &u})
			}
		case harness.KindResult:
			var u *llm.Usage
			if ev.Terminal != nil {
				cp := ev.Terminal.Usage
				u = &cp
				if ev.Terminal.Err != nil {
					emit(StreamEvent{Type: "error", Error: ev.Terminal.Err.Error()})
					return ev.Terminal.Err
				}
			}
			emit(StreamEvent{Type: "done", Usage: u})
		}
	}
	return nil
}

const lifeosSystemPrompt = `You are the built-in personal assistant inside Life OS.
You can inspect and update the user's tasks, projects, notes, note folders, calendar events, time entries, pomodoro sessions, habits, habit logs, journal entries, goals, learning courses, finance accounts/transactions/categories/budgets, tags, analytics, and weekly review.

Rules:
- Always read live Life OS data with tools before stating counts, dates, balances, or statuses. Do not guess.
- When the user asks to create or add a task, habit, note, event, project, goal, or journal entry, call the matching *_create tool right away using sensible defaults instead of running extra list or profile lookups first.
- Use ISO-8601 dates when creating or filtering tasks and calendar events.
- Write actions (create, update, delete, log) prompt the user for confirmation in the chat UI. State clearly what you are changing.
- Use RecordMemory / RecallMemory to remember stable user preferences and ongoing project context across sessions.
- Reply clearly and concisely.`

func toChatMessages(msgs []llm.Message) []ChatMessage {
	out := make([]ChatMessage, 0)
	for _, msg := range msgs {
		var textParts []string
		var tools []ToolTrace
		hasOnlyToolResults := true

		for _, b := range msg.Content {
			switch b.Type {
			case llm.BlockText:
				if strings.TrimSpace(b.Text) != "" {
					hasOnlyToolResults = false
					textParts = append(textParts, b.Text)
				}
			case llm.BlockToolUse:
				hasOnlyToolResults = false
				tools = append(tools, ToolTrace{
					ID:    b.ID,
					Name:  b.Name,
					Input: string(b.Input),
				})
			case llm.BlockToolResult:
				// Attach tool results to the preceding assistant message's matching tool call.
				resText := extractBlockText(b.Content)
				attached := false
				for i := len(out) - 1; i >= 0 && !attached; i-- {
					for j := range out[i].ToolCalls {
						if out[i].ToolCalls[j].ID == b.ToolUseID {
							out[i].ToolCalls[j].Result = resText
							out[i].ToolCalls[j].IsError = b.IsError
							attached = true
							break
						}
					}
				}
			}
		}

		if msg.Role == llm.RoleUser && hasOnlyToolResults {
			continue
		}
		joined := strings.TrimSpace(strings.Join(textParts, "\n"))
		if joined == "" && len(tools) == 0 {
			continue
		}
		// Skip internal compaction boundary summaries if empty/synthetic
		out = append(out, ChatMessage{
			Role:      string(msg.Role),
			Text:      joined,
			ToolCalls: tools,
		})
	}
	return out
}

func extractBlockText(blocks []llm.ContentBlock) string {
	var parts []string
	for _, b := range blocks {
		if b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	out := strings.Join(parts, "\n")
	if len(out) > 2000 {
		out = out[:1997] + "..."
	}
	return out
}

func summarizeTitle(text string) string {
	s := strings.Join(strings.Fields(text), " ")
	if len(s) > 48 {
		return s[:45] + "..."
	}
	return s
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
