package lifeostools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Autumn-27/norma/permission"
	"github.com/Autumn-27/norma/tool"
)

type endpointSpec struct {
	name        string
	description string
	method      string
	path        string
	needsID     bool
	deferred    bool
	schema      map[string]any
}

var (
	emptySchema = map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
	querySchema = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":                 "object",
				"description":          "Optional query parameters (filters, dates, status, limit)",
				"additionalProperties": true,
			},
		},
	}
	idSchema = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id": map[string]any{"type": "string", "description": "Record ID"},
		},
		"required": []any{"id"},
	}
	bodySchema = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"body": map[string]any{
				"type":                 "object",
				"description":          "JSON payload for the record",
				"additionalProperties": true,
			},
		},
		"required": []any{"body"},
	}
	updateSchema = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id": map[string]any{"type": "string", "description": "Record ID"},
			"body": map[string]any{
				"type":                 "object",
				"description":          "Fields to update",
				"additionalProperties": true,
			},
		},
		"required": []any{"id", "body"},
	}
)

var createFieldHints = map[string]string{
	"lifeos_tasks":    "Fields: {title (required), description?, status? (todo|in-progress|done), priority? (low|medium|high), dueDate?, startDate?, estimatedMinutes?, projectId?}.",
	"lifeos_projects": "Fields: {name (required), description?, status? (active|completed|archived), color?, startDate?, endDate?}.",
	"lifeos_notes":    "Fields: {title (required), content?, type?, folderId?, color?}.",
	"lifeos_events":   "Fields: {title (required), startDate (required, ISO-8601), endDate?, allDay?, location?, description?}.",
	"lifeos_habits":   "Fields: {name (required), description?, frequency? (daily|weekly|custom), targetCount?, unit?, color?}.",
	"lifeos_journal":  "Fields: {title?, content?, mood?, moodScore?, energy?, stress?, gratitude?, date?}.",
	"lifeos_goals":    "Fields: {title (required), description?, category?, status?, progress?, targetDate?}.",
}

func crudSpecs(prefix, basePath, label string, primaryList, primaryCreate, primaryUpdate bool) []endpointSpec {
	createDesc := fmt.Sprintf("Create a new %s record in Life OS.", label)
	if hint := createFieldHints[prefix]; hint != "" {
		createDesc += " " + hint
	}
	return []endpointSpec{
		{
			name:        prefix + "_list",
			description: fmt.Sprintf("List %s from Life OS (supports query filters like status, startDate, endDate, limit).", label),
			method:      http.MethodGet,
			path:        basePath,
			deferred:    !primaryList,
			schema:      querySchema,
		},
		{
			name:        prefix + "_get",
			description: fmt.Sprintf("Get a single %s record by id.", label),
			method:      http.MethodGet,
			path:        basePath,
			needsID:     true,
			deferred:    true,
			schema:      idSchema,
		},
		{
			name:        prefix + "_create",
			description: createDesc,
			method:      http.MethodPost,
			path:        basePath,
			deferred:    !primaryCreate,
			schema:      bodySchema,
		},
		{
			name:        prefix + "_update",
			description: fmt.Sprintf("Update an existing %s record by id.", label),
			method:      http.MethodPatch,
			path:        basePath,
			needsID:     true,
			deferred:    !primaryUpdate,
			schema:      updateSchema,
		},
		{
			name:        prefix + "_delete",
			description: fmt.Sprintf("Delete a %s record by id.", label),
			method:      http.MethodDelete,
			path:        basePath,
			needsID:     true,
			deferred:    true,
			schema:      idSchema,
		},
	}
}

func allSpecs() []endpointSpec {
	specs := []endpointSpec{
		{
			name:        "lifeos_search",
			description: "Search across Life OS tasks, notes, journal, projects, goals, habits, events, and courses.",
			method:      http.MethodGet,
			path:        "/api/search",
			schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"q": map[string]any{"type": "string", "description": "Search query text"},
				},
				"required": []any{"q"},
			},
		},
		{
			name:        "lifeos_dashboard_get",
			description: "Get the Life OS dashboard overview (tasks summary, habits, finance, upcoming events, active goals and projects).",
			method:      http.MethodGet,
			path:        "/api/dashboard",
			schema:      emptySchema,
		},
		{
			name:        "lifeos_profile_get",
			description: "Get the user's Life OS profile and preferences.",
			method:      http.MethodGet,
			path:        "/api/profile",
			schema:      emptySchema,
		},
		{
			name:        "lifeos_habit_logs_list",
			description: "List habit completion logs (optional query filters).",
			method:      http.MethodGet,
			path:        "/api/habit-logs",
			deferred:    true,
			schema:      querySchema,
		},
		{
			name:        "lifeos_habits_log",
			description: "Log a habit completion in Life OS (habitId, date, completed/value).",
			method:      http.MethodPost,
			path:        "/api/habit-logs",
			schema:      bodySchema,
		},
		// Note folders
		{name: "lifeos_note_folders_list", description: "List note folders.", method: http.MethodGet, path: "/api/note-folders", deferred: true, schema: emptySchema},
		{name: "lifeos_note_folders_create", description: "Create a note folder.", method: http.MethodPost, path: "/api/note-folders", deferred: true, schema: bodySchema},
		// Time tracking & Pomodoro
		{name: "lifeos_time_entries_list", description: "List time tracking entries.", method: http.MethodGet, path: "/api/time-entries", deferred: true, schema: querySchema},
		{name: "lifeos_time_entries_start", description: "Start a time tracking entry.", method: http.MethodPost, path: "/api/time-entries", deferred: true, schema: bodySchema},
		{name: "lifeos_time_entries_stop", description: "Stop/update a running time entry.", method: http.MethodPatch, path: "/api/time-entries", deferred: true, schema: bodySchema},
		{name: "lifeos_time_entries_delete", description: "Delete a time entry by id.", method: http.MethodDelete, path: "/api/time-entries", needsID: true, deferred: true, schema: idSchema},
		{name: "lifeos_pomodoro_list", description: "List Pomodoro sessions.", method: http.MethodGet, path: "/api/pomodoro-sessions", deferred: true, schema: emptySchema},
		{name: "lifeos_pomodoro_create", description: "Create a Pomodoro session.", method: http.MethodPost, path: "/api/pomodoro-sessions", deferred: true, schema: bodySchema},
		{name: "lifeos_pomodoro_update", description: "Update a Pomodoro session by id.", method: http.MethodPatch, path: "/api/pomodoro-sessions", needsID: true, deferred: true, schema: updateSchema},
		{name: "lifeos_pomodoro_delete", description: "Delete a Pomodoro session by id.", method: http.MethodDelete, path: "/api/pomodoro-sessions", needsID: true, deferred: true, schema: idSchema},
		// Finance
		{name: "lifeos_finance_accounts_list", description: "List finance accounts.", method: http.MethodGet, path: "/api/finance/accounts", deferred: true, schema: emptySchema},
		{name: "lifeos_finance_account_create", description: "Create a finance account.", method: http.MethodPost, path: "/api/finance/accounts", deferred: true, schema: bodySchema},
		{name: "lifeos_finance_account_update", description: "Update a finance account by id.", method: http.MethodPatch, path: "/api/finance/accounts", needsID: true, deferred: true, schema: updateSchema},
		{name: "lifeos_finance_account_delete", description: "Delete a finance account by id.", method: http.MethodDelete, path: "/api/finance/accounts", needsID: true, deferred: true, schema: idSchema},
		{name: "lifeos_finance_transactions_list", description: "List finance transactions.", method: http.MethodGet, path: "/api/finance/transactions", deferred: true, schema: querySchema},
		{name: "lifeos_finance_transaction_create", description: "Create a finance transaction.", method: http.MethodPost, path: "/api/finance/transactions", deferred: true, schema: bodySchema},
		{name: "lifeos_finance_transaction_delete", description: "Delete a finance transaction by id.", method: http.MethodDelete, path: "/api/finance/transactions", needsID: true, deferred: true, schema: idSchema},
		{name: "lifeos_finance_categories_list", description: "List finance transaction categories.", method: http.MethodGet, path: "/api/finance/categories", deferred: true, schema: emptySchema},
		{name: "lifeos_finance_category_create", description: "Create a finance transaction category.", method: http.MethodPost, path: "/api/finance/categories", deferred: true, schema: bodySchema},
		{name: "lifeos_finance_budgets_list", description: "List finance budgets.", method: http.MethodGet, path: "/api/finance/budgets", deferred: true, schema: emptySchema},
		{name: "lifeos_finance_budget_create", description: "Create a finance budget.", method: http.MethodPost, path: "/api/finance/budgets", deferred: true, schema: bodySchema},
		// Profile, tags, analytics, notifications, export (never reset!)
		{name: "lifeos_profile_update", description: "Update the user's profile.", method: http.MethodPatch, path: "/api/profile", deferred: true, schema: bodySchema},
		{name: "lifeos_tags_list", description: "List all tags.", method: http.MethodGet, path: "/api/tags", deferred: true, schema: emptySchema},
		{name: "lifeos_tags_create", description: "Create a tag.", method: http.MethodPost, path: "/api/tags", deferred: true, schema: bodySchema},
		{name: "lifeos_analytics_get", description: "Get Life OS analytics and insights.", method: http.MethodGet, path: "/api/analytics", deferred: true, schema: emptySchema},
		{name: "lifeos_weekly_review_get", description: "Get the Life OS weekly review summary.", method: http.MethodGet, path: "/api/weekly-review", deferred: true, schema: emptySchema},
		{name: "lifeos_notifications_get", description: "Get current notifications.", method: http.MethodGet, path: "/api/notifications", deferred: true, schema: emptySchema},
		{name: "lifeos_activity_list", description: "List recent activity log items.", method: http.MethodGet, path: "/api/activity", deferred: true, schema: querySchema},
		{name: "lifeos_data_stats", description: "Get record counts across all Life OS modules.", method: http.MethodGet, path: "/api/data/stats", deferred: true, schema: emptySchema},
		{name: "lifeos_data_export", description: "Export all Life OS data as JSON.", method: http.MethodGet, path: "/api/data/export", deferred: true, schema: emptySchema},
	}

	specs = append(specs, crudSpecs("lifeos_tasks", "/api/tasks", "tasks", true, true, true)...)
	specs = append(specs, crudSpecs("lifeos_projects", "/api/projects", "projects", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_notes", "/api/notes", "notes", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_events", "/api/events", "calendar events", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_habits", "/api/habits", "habits", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_journal", "/api/journal", "journal entries", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_goals", "/api/goals", "goals", true, true, false)...)
	specs = append(specs, crudSpecs("lifeos_courses", "/api/courses", "learning courses", false, false, false)...)
	return specs
}

// AllTools returns every Life OS CoreTool plus the subset of deferred tool names.
// Caller passes allTools to agentcore.Options.Tools and deferredNames to Options.DeferredTools.
func AllTools(c *Client) ([]tool.CoreTool, []string) {
	specs := allSpecs()
	all := make([]tool.CoreTool, 0, len(specs))
	var deferred []string

	for _, sp := range specs {
		sp := sp
		isRead := sp.method == http.MethodGet
		permFn := func(context.Context, json.RawMessage, permission.Context) permission.Decision {
			return permission.AskUser(fmt.Sprintf("Allow %s (%s %s)?", sp.name, sp.method, sp.path))
		}
		if isRead {
			permFn = func(context.Context, json.RawMessage, permission.Context) permission.Decision {
				return permission.Allowed()
			}
		}

		ct := tool.Build(tool.Spec{
			Name:        sp.name,
			Description: sp.description,
			Schema:      sp.schema,
			ReadOnly:    func(json.RawMessage) bool { return isRead },
			Concurrent:  func(json.RawMessage) bool { return isRead },
			Permissions: permFn,
			Run: func(ctx context.Context, in json.RawMessage, tc *tool.ToolContext) (tool.Result, error) {
				var args map[string]any
				if len(in) > 0 {
					if err := json.Unmarshal(in, &args); err != nil {
						return tool.Errorf("invalid JSON arguments: " + err.Error()), nil
					}
				}
				if args == nil {
					args = map[string]any{}
				}

				targetPath := sp.path
				if sp.needsID {
					id, _ := args["id"].(string)
					id = strings.TrimSpace(id)
					if id == "" {
						return tool.Errorf("id is required"), nil
					}
					targetPath = sp.path + "/" + url.PathEscape(id)
				}

				var query map[string]any
				if sp.name == "lifeos_search" {
					query = map[string]any{"q": args["q"]}
				} else if qMap, ok := args["query"].(map[string]any); ok {
					query = qMap
				}

				var body any
				if sp.method != http.MethodGet && sp.method != http.MethodDelete {
					if b, ok := args["body"]; ok {
						body = b
					} else {
						// Fallback: forward non-envelope fields if model passed flat args.
						flat := make(map[string]any, len(args))
						for k, v := range args {
							if k != "id" && k != "query" {
								flat[k] = v
							}
						}
						body = flat
					}
				}

				out, err := c.Do(ctx, sp.method, targetPath, query, body)
				if err != nil {
					return tool.Errorf(err.Error()), nil
				}
				return tool.Text(tool.Capture(tc, out)), nil
			},
		})
		all = append(all, ct)
		if sp.deferred {
			deferred = append(deferred, sp.name)
		}
	}

	return all, deferred
}

// BuildSnapshot fetches a compact summary of the user's current Life OS state
// for Norma's SystemReminderFunc. Returns "" if the backend is unavailable.
func BuildSnapshot(ctx context.Context, c *Client) string {
	var parts []string

	if profRaw, err := c.Do(ctx, http.MethodGet, "/api/profile", nil, nil); err == nil {
		var prof struct {
			Name     string `json:"name"`
			Timezone string `json:"timezone"`
		}
		if json.Unmarshal([]byte(profRaw), &prof) == nil && prof.Name != "" {
			if prof.Timezone != "" {
				parts = append(parts, fmt.Sprintf("User: %s (%s)", prof.Name, prof.Timezone))
			} else {
				parts = append(parts, fmt.Sprintf("User: %s", prof.Name))
			}
		}
	}

	if dashRaw, err := c.Do(ctx, http.MethodGet, "/api/dashboard", nil, nil); err == nil {
		var dash struct {
			Tasks struct {
				Total     int `json:"total"`
				Pending   int `json:"pending"`
				Completed int `json:"completed"`
			} `json:"tasks"`
			Habits struct {
				CompletedToday int `json:"completedToday"`
				TotalActive    int `json:"totalActive"`
			} `json:"habits"`
			UpcomingEvents []struct {
				Title string `json:"title"`
			} `json:"upcomingEvents"`
			ActiveGoals []struct {
				Title string `json:"title"`
			} `json:"activeGoals"`
		}
		if json.Unmarshal([]byte(dashRaw), &dash) == nil {
			parts = append(parts, fmt.Sprintf(
				"Dashboard: tasks %d pending/%d total; habits %d/%d today; upcoming events %d; active goals %d",
				dash.Tasks.Pending, dash.Tasks.Total,
				dash.Habits.CompletedToday, dash.Habits.TotalActive,
				len(dash.UpcomingEvents), len(dash.ActiveGoals),
			))
			if len(dash.UpcomingEvents) > 0 {
				var titles []string
				for i, ev := range dash.UpcomingEvents {
					if i >= 3 {
						break
					}
					if ev.Title != "" {
						titles = append(titles, ev.Title)
					}
				}
				if len(titles) > 0 {
					parts = append(parts, "Next events: "+strings.Join(titles, ", "))
				}
			}
		}
	}

	if len(parts) == 0 {
		return ""
	}
	summary := strings.Join(parts, "\n")
	if len(summary) > 1400 {
		summary = summary[:1397] + "..."
	}
	return summary
}
