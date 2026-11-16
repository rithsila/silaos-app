package lifeostools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Autumn-27/norma/permission"
	"github.com/Autumn-27/norma/tool"
)

func findTool(t *testing.T, tools []tool.CoreTool, name string) tool.CoreTool {
	t.Helper()
	for _, tl := range tools {
		if tl.Name() == name {
			return tl
		}
	}
	t.Fatalf("tool %q not found", name)
	return nil
}

func TestReadToolParallelSafe(t *testing.T) {
	var gotAuth string
	var gotStatus string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotStatus = r.URL.Query().Get("status")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tasks":[{"id":"t1","title":"Ship Chat"}],"total":1}`))
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "top-secret")
	tools, _ := AllTools(client)

	tasksList := findTool(t, tools, "lifeos_tasks_list")
	if !tasksList.IsReadOnly(nil) || !tasksList.IsConcurrencySafe(nil) {
		t.Fatalf("expected lifeos_tasks_list to be read-only and concurrency-safe")
	}

	searchTool := findTool(t, tools, "lifeos_search")
	if !searchTool.IsReadOnly(nil) || !searchTool.IsConcurrencySafe(nil) {
		t.Fatalf("expected lifeos_search to be read-only and concurrency-safe")
	}

	res, err := tasksList.Call(context.Background(), json.RawMessage(`{"query":{"status":"todo"}}`), nil)
	if err != nil {
		t.Fatalf("unexpected Call error: %v", err)
	}
	if res.IsError {
		t.Fatalf("unexpected tool error result: %v", res.Content)
	}
	if gotAuth != "Bearer top-secret" {
		t.Fatalf("expected Bearer top-secret, got %q", gotAuth)
	}
	if gotStatus != "todo" {
		t.Fatalf("expected query param status=todo, got %q", gotStatus)
	}
}

func TestMutatingToolRequiresApproval(t *testing.T) {
	client := NewClient("http://localhost:8080", "")
	tools, deferred := AllTools(client)

	deferredSet := make(map[string]bool, len(deferred))
	for _, d := range deferred {
		deferredSet[d] = true
	}
	for _, primaryCreate := range []string{"lifeos_habits_create", "lifeos_projects_create", "lifeos_goals_create"} {
		if deferredSet[primaryCreate] {
			t.Fatalf("expected %s to be primary (not deferred)", primaryCreate)
		}
		tl := findTool(t, tools, primaryCreate)
		if !strings.Contains(tl.Description(), "Fields:") {
			t.Fatalf("expected %s description to include field hints, got %q", primaryCreate, tl.Description())
		}
	}

	for _, name := range []string{"lifeos_tasks_create", "lifeos_tasks_delete", "lifeos_finance_account_delete"} {
		tl := findTool(t, tools, name)
		if tl.IsReadOnly(nil) {
			t.Fatalf("expected %s to NOT be read-only", name)
		}
		if tl.IsConcurrencySafe(nil) {
			t.Fatalf("expected %s to NOT be concurrency-safe", name)
		}
		dec := tl.CheckPermissions(context.Background(), json.RawMessage(`{"id":"123"}`), permission.Context{})
		if dec.Behavior != permission.Ask {
			t.Fatalf("expected %s permission Behavior=ask, got %q", name, dec.Behavior)
		}
	}
}

func TestResetEndpointNotExposed(t *testing.T) {
	client := NewClient("http://localhost:8080", "")
	tools, _ := AllTools(client)
	for _, tl := range tools {
		name := strings.ToLower(tl.Name())
		desc := strings.ToLower(tl.Description())
		if strings.Contains(name, "reset") || strings.Contains(desc, "/api/data/reset") {
			t.Fatalf("reset endpoint must not be exposed: %s", tl.Name())
		}
	}
}

func TestBuildSnapshotCompact(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/dashboard":
			_, _ = w.Write([]byte(`{"tasks":{"total":5,"pending":2,"completed":3},"habits":{"completedToday":1,"totalActive":3},"upcomingEvents":[{"title":"Standup"}]}`))
		case "/api/profile":
			_, _ = w.Write([]byte(`{"name":"Rithsila","timezone":"Asia/Bangkok"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	snap := BuildSnapshot(context.Background(), NewClient(srv.URL, ""))
	if snap == "" {
		t.Fatalf("expected non-empty snapshot")
	}
	if len(snap) >= 1500 {
		t.Fatalf("expected snapshot < 1500 chars, got %d", len(snap))
	}
	if !strings.Contains(snap, "Rithsila") {
		t.Fatalf("expected snapshot to include profile name, got %q", snap)
	}

	// Unreachable backend should return empty string cleanly.
	down := BuildSnapshot(context.Background(), NewClient("http://127.0.0.1:1", ""))
	if down != "" {
		t.Fatalf("expected empty snapshot on unreachable backend, got %q", down)
	}
}
