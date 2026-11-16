package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"lifeos-agent/internal/chat"
	"lifeos-agent/internal/config"
)

// NewRouter constructs the HTTP + SSE handler for the Life OS Norma agent.
func NewRouter(cfg config.Config, mgr *chat.Manager) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"llmConfigured": cfg.LLMAPIKey != "",
		})
	})

	api := http.NewServeMux()

	api.HandleFunc("GET /api/chat/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"llmConfigured": cfg.LLMAPIKey != "",
			"provider":      cfg.Provider,
			"model":         cfg.Model,
		})
	})

	api.HandleFunc("GET /api/chat/sessions", func(w http.ResponseWriter, r *http.Request) {
		sessions, err := mgr.ListSessions(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
	})

	api.HandleFunc("POST /api/chat/sessions", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title string `json:"title"`
		}
		if r.Body != nil {
			_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body)
		}
		sess, err := mgr.CreateSession(r.Context(), body.Title)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, sess)
	})

	api.HandleFunc("GET /api/chat/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		detail, err := mgr.GetSession(r.Context(), id)
		if err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, detail)
	})

	api.HandleFunc("PATCH /api/chat/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Title string `json:"title"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		sess, err := mgr.RenameSession(r.Context(), id, body.Title)
		if err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sess)
	})

	api.HandleFunc("DELETE /api/chat/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := mgr.DeleteSession(r.Context(), id); err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	})

	api.HandleFunc("POST /api/chat/sessions/{id}/message", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Message         string `json:"message"`
			RewindFromIndex *int   `json:"rewindFromIndex,omitempty"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if strings.TrimSpace(body.Message) == "" {
			writeError(w, http.StatusBadRequest, "message is required")
			return
		}

		flusher, _ := w.(http.Flusher)
		sseStarted := false
		ensureSSE := func() {
			if sseStarted {
				return
			}
			sseStarted = true
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache, no-transform")
			w.Header().Set("Connection", "keep-alive")
			w.Header().Set("X-Accel-Buffering", "no")
			w.WriteHeader(http.StatusOK)
			if flusher != nil {
				flusher.Flush()
			}
		}

		err := mgr.SendMessageFrom(r.Context(), id, body.Message, body.RewindFromIndex, func(ev chat.StreamEvent) {
			ensureSSE()
			b, mErr := json.Marshal(ev)
			if mErr != nil {
				return
			}
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, string(b))
			if flusher != nil {
				flusher.Flush()
			}
		})
		if err != nil {
			if !sseStarted {
				writeMappedError(w, err)
				return
			}
			b, _ := json.Marshal(chat.StreamEvent{Type: "error", Error: err.Error()})
			_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", string(b))
			if flusher != nil {
				flusher.Flush()
			}
		}
	})

	api.HandleFunc("POST /api/chat/sessions/{id}/approve", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			ToolUseID string `json:"toolUseId"`
			Allow     bool   `json:"allow"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if strings.TrimSpace(body.ToolUseID) == "" {
			writeError(w, http.StatusBadRequest, "toolUseId is required")
			return
		}
		if err := mgr.ResolveApproval(id, body.ToolUseID, body.Allow); err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	api.HandleFunc("POST /api/chat/sessions/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cancelled, err := mgr.CancelSession(id)
		if err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cancelled": cancelled})
	})

	api.HandleFunc("GET /api/chat/memory", func(w http.ResponseWriter, _ *http.Request) {
		mems, err := mgr.ListMemories()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"memories": mems})
	})

	api.HandleFunc("GET /api/chat/instructions", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, mgr.GetInstructions())
	})

	api.HandleFunc("PUT /api/chat/instructions", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Enabled      bool   `json:"enabled"`
			Instructions string `json:"instructions"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		updated, err := mgr.UpdateInstructions(body.Enabled, body.Instructions)
		if err != nil {
			writeMappedError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	mux.Handle("/api/chat/", authMiddleware(cfg.APIKey, api))
	return mux
}

func authMiddleware(apiKey string, next http.Handler) http.Handler {
	if apiKey == "" {
		return next
	}
	expected := "Bearer " + apiKey
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("Authorization")
		if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeMappedError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, chat.ErrSessionNotFound), errors.Is(err, chat.ErrApprovalNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, chat.ErrInvalidMessageIndex), errors.Is(err, chat.ErrInvalidTitle), errors.Is(err, chat.ErrInstructionsTooLong):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, chat.ErrSessionBusy):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, chat.ErrLLMNotConfigured):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
