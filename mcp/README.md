# Life OS MCP

OpenCode talks to the live app at `LIFEOS_URL` (LAN VM). One tool: `lifeos`.

## Modules (sidebar)

| module | ops |
|--------|-----|
| dashboard | get, widgets, save_widgets, notifications, analytics, weekly_review, activity |
| tasks | list, get, create, update, delete |
| projects | list, get, create, update, delete |
| notes | list, get, create, update, delete |
| note_folders | list, create |
| calendar | list, get, create, update, delete |
| time | list, start, stop, delete, pomodoro_list, pomodoro_create, pomodoro_update, pomodoro_delete |
| habits | list, get, create, update, delete, logs, log |
| journal | list, get, create, update, delete |
| goals | list, get, create, update, delete |
| learning | list, get, create, update, delete |
| finance | accounts, account_get, account_create, account_update, transactions, transaction_get, transaction_create, transaction_delete, categories, category_create, budgets, budget_create |
| profile | get, create, update, tags, tag_create, export, stats |
| search | query |

No `data/reset` on purpose.

Example: `{ "module": "tasks", "op": "create", "title": "Buy milk", "priority": "high" }`

Env: `LIFEOS_URL` (default `http://10.10.22.63:3000`), `LIFEOS_API_KEY` (optional).
