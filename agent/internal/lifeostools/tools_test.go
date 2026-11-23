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

func TestBookmarkToolsRegistered(t *testing.T) {
	client := NewClient("http://localhost:8080", "")
	tools, deferred := AllTools(client)

	deferredSet := make(map[string]bool, len(deferred))
	for _, d := range deferred {
		deferredSet[d] = true
	}

	expectedBookmarkTools := []string{
		"lifeos_bookmarks_list",
		"lifeos_bookmarks_get",
		"lifeos_bookmarks_create",
		"lifeos_bookmarks_update",
		"lifeos_bookmarks_delete",
		"lifeos_bookmark_folders_list",
		"lifeos_bookmark_folders_get",
		"lifeos_bookmark_folders_create",
		"lifeos_bookmark_folders_update",
		"lifeos_bookmark_folders_delete",
	}

	for _, name := range expectedBookmarkTools {
		tl := findTool(t, tools, name)
		if tl == nil {
			t.Fatalf("expected tool %s to be registered", name)
		}
	}

	// Verify field hints on create tools
	bmCreate := findTool(t, tools, "lifeos_bookmarks_create")
	if !strings.Contains(bmCreate.Description(), "url (required)") || !strings.Contains(bmCreate.Description(), "suggestedFolderId") {
		t.Fatalf("expected lifeos_bookmarks_create to contain detailed field hints, got %q", bmCreate.Description())
	}
	if deferredSet["lifeos_bookmarks_create"] {
		t.Fatalf("expected lifeos_bookmarks_create to be primary (not deferred)")
	}

	bmFolderCreate := findTool(t, tools, "lifeos_bookmark_folders_create")
	if !strings.Contains(bmFolderCreate.Description(), "name (required)") {
		t.Fatalf("expected lifeos_bookmark_folders_create to contain field hints, got %q", bmFolderCreate.Description())
	}
	if !deferredSet["lifeos_bookmark_folders_create"] {
		t.Fatalf("expected lifeos_bookmark_folders_create to be deferred")
	}

	// Check read-only vs mutating permissions
	readTools := []string{"lifeos_bookmarks_list", "lifeos_bookmarks_get", "lifeos_bookmark_folders_list", "lifeos_bookmark_folders_get"}
	for _, name := range readTools {
		tl := findTool(t, tools, name)
		if !tl.IsReadOnly(nil) || !tl.IsConcurrencySafe(nil) {
			t.Fatalf("expected %s to be read-only and concurrency-safe", name)
		}
		dec := tl.CheckPermissions(context.Background(), nil, permission.Context{})
		if dec.Behavior != permission.Allow {
			t.Fatalf("expected %s permission Behavior=allow, got %q", name, dec.Behavior)
		}
	}

	mutatingTools := []string{
		"lifeos_bookmarks_create", "lifeos_bookmarks_update", "lifeos_bookmarks_delete",
		"lifeos_bookmark_folders_create", "lifeos_bookmark_folders_update", "lifeos_bookmark_folders_delete",
	}
	for _, name := range mutatingTools {
		tl := findTool(t, tools, name)
		if tl.IsReadOnly(nil) || tl.IsConcurrencySafe(nil) {
			t.Fatalf("expected %s to NOT be read-only or concurrency-safe", name)
		}
		dec := tl.CheckPermissions(context.Background(), json.RawMessage(`{"id":"bm1"}`), permission.Context{})
		if dec.Behavior != permission.Ask {
			t.Fatalf("expected %s permission Behavior=ask, got %q", name, dec.Behavior)
		}
	}
}

func TestBookmarkToolsExecution(t *testing.T) {
	type callRecord struct {
		method string
		path   string
		query  string
	}
	var recorded []callRecord

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorded = append(recorded, callRecord{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.RawQuery,
		})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/bookmarks" && r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`{"bookmarks":[{"id":"bm1","title":"Go Dev","url":"https://go.dev"}],"total":1}`))
		case r.URL.Path == "/api/bookmarks" && r.Method == http.MethodPost:
			_, _ = w.Write([]byte(`{"id":"bm2","title":"Rust Lang","url":"https://rust-lang.org"}`))
		case r.URL.Path == "/api/bookmarks/folders" && r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`[{"id":"fld1","name":"Tech Docs"}]`))
		case r.URL.Path == "/api/bookmarks/folders" && r.Method == http.MethodPost:
			_, _ = w.Write([]byte(`{"id":"fld2","name":"News"}`))
		case r.URL.Path == "/api/bookmarks/folders/fld2" && r.Method == http.MethodPatch:
			_, _ = w.Write([]byte(`{"id":"fld2","name":"Updated News"}`))
		case r.URL.Path == "/api/bookmarks/bm1" && r.Method == http.MethodDelete:
			_, _ = w.Write([]byte(`{"success":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
		}
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "test-key")
	tools, _ := AllTools(client)

	ctx := context.Background()

	// 1. Query bookmarks
	listBm := findTool(t, tools, "lifeos_bookmarks_list")
	res, err := listBm.Call(ctx, json.RawMessage(`{"query":{"status":"inbox","limit":5}}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmarks_list failed: err=%v, res=%+v", err, res)
	}

	// 2. Create bookmark
	createBm := findTool(t, tools, "lifeos_bookmarks_create")
	res, err = createBm.Call(ctx, json.RawMessage(`{"body":{"title":"Rust Lang","url":"https://rust-lang.org"}}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmarks_create failed: err=%v, res=%+v", err, res)
	}

	// 3. Query folders
	listFolders := findTool(t, tools, "lifeos_bookmark_folders_list")
	res, err = listFolders.Call(ctx, json.RawMessage(`{}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmark_folders_list failed: err=%v, res=%+v", err, res)
	}

	// 4. Create folder
	createFolder := findTool(t, tools, "lifeos_bookmark_folders_create")
	res, err = createFolder.Call(ctx, json.RawMessage(`{"body":{"name":"News"}}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmark_folders_create failed: err=%v, res=%+v", err, res)
	}

	// 5. Update folder
	updateFolder := findTool(t, tools, "lifeos_bookmark_folders_update")
	res, err = updateFolder.Call(ctx, json.RawMessage(`{"id":"fld2","body":{"name":"Updated News"}}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmark_folders_update failed: err=%v, res=%+v", err, res)
	}

	// 6. Delete bookmark
	deleteBm := findTool(t, tools, "lifeos_bookmarks_delete")
	res, err = deleteBm.Call(ctx, json.RawMessage(`{"id":"bm1"}`), nil)
	if err != nil || res.IsError {
		t.Fatalf("lifeos_bookmarks_delete failed: err=%v, res=%+v", err, res)
	}

	if len(recorded) != 6 {
		t.Fatalf("expected 6 requests recorded, got %d", len(recorded))
	}
	if recorded[0].path != "/api/bookmarks" || recorded[0].method != http.MethodGet {
		t.Errorf("step 1 mismatch: %+v", recorded[0])
	}
	if recorded[1].path != "/api/bookmarks" || recorded[1].method != http.MethodPost {
		t.Errorf("step 2 mismatch: %+v", recorded[1])
	}
	if recorded[2].path != "/api/bookmarks/folders" || recorded[2].method != http.MethodGet {
		t.Errorf("step 3 mismatch: %+v", recorded[2])
	}
	if recorded[3].path != "/api/bookmarks/folders" || recorded[3].method != http.MethodPost {
		t.Errorf("step 4 mismatch: %+v", recorded[3])
	}
	if recorded[4].path != "/api/bookmarks/folders/fld2" || recorded[4].method != http.MethodPatch {
		t.Errorf("step 5 mismatch: %+v", recorded[4])
	}
	if recorded[5].path != "/api/bookmarks/bm1" || recorded[5].method != http.MethodDelete {
		t.Errorf("step 6 mismatch: %+v", recorded[5])
	}
}
