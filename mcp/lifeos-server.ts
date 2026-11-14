#!/usr/bin/env bun
/**
 * Life OS MCP (stdio, newline JSON). Talks to the Next/Rust app over HTTP.
 * Env: LIFEOS_URL (default http://10.10.22.63:3000), LIFEOS_API_KEY (optional)
 */
import { writeSync } from "node:fs"
const BASE = (process.env.LIFEOS_URL || "http://10.10.22.63:3000").replace(/\/$/, "")
const KEY = process.env.LIFEOS_API_KEY || ""

type Json = Record<string, unknown>

async function api(method: string, path: string, opts: { query?: Json; body?: unknown } = {}) {
  const url = new URL(path, BASE)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === "") continue
      url.searchParams.set(k, String(v))
    }
  }
  const headers: Record<string, string> = { Accept: "application/json" }
  if (KEY) headers.Authorization = `Bearer ${KEY}`
  let body: string | undefined
  if (opts.body !== undefined && method !== "GET" && method !== "DELETE") {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(url.toString(), { method, headers, body })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`)
  }
  return data
}

function idPath(base: string, id?: string) {
  if (!id) throw new Error("id is required for this op")
  return `${base}/${encodeURIComponent(id)}`
}

type Handler = (args: Json) => Promise<unknown>

function payload(a: Json): Json {
  if (a.body && typeof a.body === "object" && !Array.isArray(a.body)) return a.body as Json
  const skip = new Set(["module", "op", "id", "query", "q", "body", "filters"])
  const out: Json = {}
  for (const [k, v] of Object.entries(a)) {
    if (!skip.has(k)) out[k] = v
  }
  return out
}

function listQuery(a: Json): Json {
  if (a.query && typeof a.query === "object") return a.query as Json
  return payload(a)
}

function crud(base: string, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    list: (a) => api("GET", base, { query: listQuery(a) }),
    get: (a) => api("GET", idPath(base, a.id as string)),
    create: (a) => api("POST", base, { body: payload(a) }),
    update: (a) => api("PATCH", idPath(base, a.id as string), { body: payload(a) }),
    delete: (a) => api("DELETE", idPath(base, a.id as string)),
    ...extra,
  }
}

const modules: Record<string, Record<string, Handler>> = {
  dashboard: {
    get: () => api("GET", "/api/dashboard"),
    widgets: () => api("GET", "/api/dashboard/widgets"),
    save_widgets: (a) => api("PUT", "/api/dashboard/widgets", { body: payload(a) }),
    notifications: () => api("GET", "/api/notifications"),
    analytics: () => api("GET", "/api/analytics"),
    weekly_review: () => api("GET", "/api/weekly-review"),
    activity: (a) => api("GET", "/api/activity", { query: listQuery(a) }),
  },
  tasks: crud("/api/tasks"),
  projects: crud("/api/projects"),
  notes: crud("/api/notes"),
  note_folders: {
    list: () => api("GET", "/api/note-folders"),
    create: (a) => api("POST", "/api/note-folders", { body: payload(a) }),
  },
  calendar: crud("/api/events"),
  time: {
    list: (a) => api("GET", "/api/time-entries", { query: listQuery(a) }),
    start: (a) => api("POST", "/api/time-entries", { body: payload(a) }),
    stop: (a) => api("PATCH", "/api/time-entries", { body: payload(a) }),
    delete: (a) => api("DELETE", idPath("/api/time-entries", a.id as string)),
    pomodoro_list: () => api("GET", "/api/pomodoro-sessions"),
    pomodoro_create: (a) => api("POST", "/api/pomodoro-sessions", { body: payload(a) }),
    pomodoro_update: (a) =>
      api("PATCH", idPath("/api/pomodoro-sessions", a.id as string), { body: payload(a) }),
    pomodoro_delete: (a) => api("DELETE", idPath("/api/pomodoro-sessions", a.id as string)),
  },
  habits: {
    ...crud("/api/habits"),
    logs: (a) => api("GET", "/api/habit-logs", { query: listQuery(a) }),
    log: (a) => api("POST", "/api/habit-logs", { body: payload(a) }),
  },
  journal: crud("/api/journal"),
  goals: crud("/api/goals"),
  learning: crud("/api/courses"),
  finance: {
    accounts: () => api("GET", "/api/finance/accounts"),
    account_get: (a) => api("GET", idPath("/api/finance/accounts", a.id as string)),
    account_create: (a) => api("POST", "/api/finance/accounts", { body: payload(a) }),
    account_update: (a) =>
      api("PATCH", idPath("/api/finance/accounts", a.id as string), { body: payload(a) }),
    transactions: (a) => api("GET", "/api/finance/transactions", { query: listQuery(a) }),
    transaction_get: (a) => api("GET", idPath("/api/finance/transactions", a.id as string)),
    transaction_create: (a) => api("POST", "/api/finance/transactions", { body: payload(a) }),
    transaction_delete: (a) => api("DELETE", idPath("/api/finance/transactions", a.id as string)),
    categories: () => api("GET", "/api/finance/categories"),
    category_create: (a) => api("POST", "/api/finance/categories", { body: payload(a) }),
    budgets: () => api("GET", "/api/finance/budgets"),
    budget_create: (a) => api("POST", "/api/finance/budgets", { body: payload(a) }),
  },
  profile: {
    get: () => api("GET", "/api/profile"),
    create: (a) => api("POST", "/api/profile", { body: payload(a) }),
    update: (a) => api("PATCH", "/api/profile", { body: payload(a) }),
    tags: () => api("GET", "/api/tags"),
    tag_create: (a) => api("POST", "/api/tags", { body: payload(a) }),
    export: () => api("GET", "/api/data/export"),
    stats: () => api("GET", "/api/data/stats"),
  },
  search: {
    query: (a) =>
      api("GET", "/api/search", { query: { q: a.q ?? a.query, ...(a.filters as Json) } }),
  },
}

const opsHelp = Object.fromEntries(
  Object.entries(modules).map(([k, v]) => [k, Object.keys(v)]),
)

const tools = [
  {
    name: "lifeos",
    description:
      "Read and write Life OS (dashboard, tasks, projects, notes, calendar, time tracker, habits, journal, goals, learning, finance, profile, search). Set module + op. Dates ISO-8601. Task status: todo|in-progress|done|cancelled. Priority: low|medium|high|urgent.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        module: {
          type: "string",
          enum: Object.keys(modules),
          description: `One of: ${Object.keys(modules).join(", ")}`,
        },
        op: {
          type: "string",
          description: `Operation for that module. Map: ${JSON.stringify(opsHelp)}`,
        },
        id: { type: "string", description: "Row id for get/update/delete" },
        query: { type: "object", description: "GET query params (filters, dates, limit)" },
        body: { type: "object", description: "JSON body for create/update. Can also pass fields at top level." },
        q: { type: "string", description: "Search text when module=search" },
      },
      required: ["module", "op"],
    },
  },
]

async function callLifeos(args: Json) {
  const moduleName = String(args.module || "")
  const op = String(args.op || "")
  const pack = modules[moduleName]
  if (!pack) throw new Error(`unknown module "${moduleName}". Use: ${Object.keys(modules).join(", ")}`)
  const fn = pack[op]
  if (!fn) throw new Error(`unknown op "${op}" for ${moduleName}. Use: ${Object.keys(pack).join(", ")}`)
  return fn(args)
}

function send(msg: object) {
  // OpenCode stdio MCP is newline JSON. Content-Length makes it parse "Content" and time out.
  const line = JSON.stringify(msg) + "\n"
  writeSync(1, line)
}

function ok(id: unknown, result: unknown) {
  send({ jsonrpc: "2.0", id, result })
}

function err(id: unknown, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

async function handle(msg: Json) {
  const { id, method, params } = msg as {
    id?: unknown
    method?: string
    params?: Json
  }
  if (!method) return
  if (method === "initialize") {
    ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "lifeos", version: "1.0.0" },
      instructions:
        "Life OS personal data on the LAN VM. Use tool lifeos with module+op. Never call data reset. Prefer list before update. Tasks need title. Calendar events need title+startDate.",
    })
    return
  }
  if (method === "notifications/initialized" || method === "initialized") return
  if (method === "ping") {
    ok(id, {})
    return
  }
  if (method === "tools/list") {
    ok(id, { tools })
    return
  }
  if (method === "tools/call") {
    const name = String(params?.name || "")
    const args = (params?.arguments as Json) || {}
    try {
      if (name !== "lifeos") throw new Error(`unknown tool ${name}`)
      const data = await callLifeos(args)
      ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      ok(id, { content: [{ type: "text", text: message }], isError: true })
    }
    return
  }
  if (id !== undefined) err(id, -32601, `Method not found: ${method}`)
}

let buf = Buffer.alloc(0)
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk])
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n")
    if (headerEnd === -1) {
      const nl = buf.indexOf("\n")
      if (nl !== -1 && !buf.subarray(0, nl).includes(Buffer.from("Content-Length"))) {
        const line = buf.subarray(0, nl).toString("utf8").trim()
        buf = buf.subarray(nl + 1)
        if (line.startsWith("{")) {
          try {
            void handle(JSON.parse(line))
          } catch {
            /* ignore */
          }
        }
        continue
      }
      break
    }
    const header = buf.subarray(0, headerEnd).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    if (!m) {
      buf = buf.subarray(headerEnd + 4)
      continue
    }
    const len = Number(m[1])
    const start = headerEnd + 4
    if (buf.length < start + len) break
    const body = buf.subarray(start, start + len).toString("utf8")
    buf = buf.subarray(start + len)
    try {
      void handle(JSON.parse(body))
    } catch (e) {
      err(null, -32700, String(e))
    }
  }
})

process.stdin.resume()
