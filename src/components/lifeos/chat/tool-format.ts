const VERB_LABELS: Record<string, string> = {
  list: 'Check',
  get: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  log: 'Log',
  start: 'Start',
  stop: 'Stop',
  search: 'Search',
  stats: 'Stats',
  export: 'Export',
}

const SINGULAR_NOUNS: Record<string, string> = {
  tasks: 'Task',
  projects: 'Project',
  notes: 'Note',
  events: 'Event',
  habits: 'Habit',
  goals: 'Goal',
  courses: 'Course',
  tags: 'Tag',
  budgets: 'Budget',
  accounts: 'Account',
  categories: 'Category',
  transactions: 'Transaction',
}

const KEY_LABELS: Record<string, string> = {
  title: 'Title',
  name: 'Name',
  description: 'Description',
  content: 'Content',
  status: 'Status',
  priority: 'Priority',
  frequency: 'Frequency',
  targetCount: 'Target',
  unit: 'Unit',
  dueDate: 'Due',
  startDate: 'Start',
  endDate: 'End',
  targetDate: 'Target Date',
  date: 'Date',
  allDay: 'All Day',
  location: 'Location',
  category: 'Category',
  estimatedMinutes: 'Estimate',
  mood: 'Mood',
  moodScore: 'Mood Score',
  amount: 'Amount',
  type: 'Type',
  progress: 'Progress',
  id: 'ID',
  q: 'Query',
  query: 'Query',
}

const VALUE_LABELS: Record<string, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
  'not-started': 'Not started',
}

function tryParseJson(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return input
  try {
    return JSON.parse(trimmed)
  } catch {
    return input
  }
}

function titleCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (key === 'estimatedMinutes') return `${value} min`
    if (key === 'progress') return `${value}%`
    return String(value)
  }
  if (typeof value === 'string') {
    if (VALUE_LABELS[value]) return VALUE_LABELS[value]
    // Format ISO-8601 dates/datetimes concisely
    if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        const hasTime = /T(?!00:00:00)/.test(value)
        return d.toLocaleString(undefined, hasTime
          ? { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
          : { month: 'short', day: 'numeric', year: 'numeric' })
      }
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(key, v)).filter(Boolean).join(', ')
  }
  return JSON.stringify(value)
}

export function formatToolLabel(toolName?: string, rawInput?: unknown): string {
  if (!toolName) return 'Life OS'
  if (toolName === 'ExecuteExtraTool') {
    const parsed = tryParseJson(rawInput)
    if (parsed && typeof parsed === 'object' && 'tool_name' in parsed) {
      const inner = (parsed as { tool_name?: unknown }).tool_name
      if (typeof inner === 'string' && inner) return formatToolLabel(inner)
    }
    return 'Run tool'
  }
  if (toolName === 'SearchExtraTools') return 'Find tools'
  if (toolName === 'RecallMemory') return 'Recall memory'
  if (toolName === 'RecordMemory') return 'Save memory'

  if (!toolName.startsWith('lifeos_')) return titleCase(toolName)

  const parts = toolName.slice('lifeos_'.length).split('_').filter(Boolean)
  if (parts.length === 1) {
    return titleCase(parts[0])
  }

  const last = parts[parts.length - 1]
  const verb = VERB_LABELS[last]
  if (!verb) {
    return parts.map(titleCase).join(' ')
  }

  const nouns = parts.slice(0, -1)
  const isSingularVerb = verb === 'Create' || verb === 'Update' || verb === 'Delete' || verb === 'Log'
  const formattedNouns = nouns
    .map((n, i) => {
      const isLastNoun = i === nouns.length - 1
      if (isSingularVerb && isLastNoun && SINGULAR_NOUNS[n]) {
        return SINGULAR_NOUNS[n]
      }
      return titleCase(n)
    })
    .join(' ')

  if (formattedNouns === 'Journal' && isSingularVerb) {
    return `${verb} Journal Entry`
  }
  return `${verb} ${formattedNouns}`
}

export function parseToolPayload(input: unknown): {
  fields: Array<{ label: string; value: string }>
  raw: string
} {
  const parsed = tryParseJson(input)
  const raw =
    typeof input === 'string'
      ? parsed && typeof parsed === 'object'
        ? JSON.stringify(parsed, null, 2)
        : input
      : JSON.stringify(input ?? {}, null, 2)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { fields: [], raw }
  }

  const obj = parsed as Record<string, unknown>
  let target: Record<string, unknown> = obj

  if (obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)) {
    target = obj.params as Record<string, unknown>
  }

  const nestedBody =
    target.body && typeof target.body === 'object' && !Array.isArray(target.body)
      ? (target.body as Record<string, unknown>)
      : null
  const nestedQuery =
    target.query && typeof target.query === 'object' && !Array.isArray(target.query)
      ? (target.query as Record<string, unknown>)
      : null

  const flattened: Record<string, unknown> = nestedBody
    ? { ...(target.id !== undefined ? { id: target.id } : {}), ...nestedBody }
    : nestedQuery
      ? { ...nestedQuery }
      : target

  const priorityOrder = ['title', 'name', 'startDate', 'dueDate', 'endDate', 'priority', 'status', 'frequency', 'targetCount', 'unit', 'category', 'location', 'description', 'content']
  const entries = Object.entries(flattened).filter(([k, v]) => {
    if (k === 'reason') return false
    if (v === undefined || v === null || v === '') return false
    return true
  })

  // Fall back to reason only if no other user-facing fields exist
  const finalEntries =
    entries.length > 0
      ? entries
      : Object.entries(flattened).filter(([, v]) => v !== undefined && v !== null && v !== '')

  finalEntries.sort(([a], [b]) => {
    const ia = priorityOrder.indexOf(a)
    const ib = priorityOrder.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return 0
  })

  const fields = finalEntries
    .map(([k, v]) => ({
      label: KEY_LABELS[k] || titleCase(k),
      value: formatFieldValue(k, v),
    }))
    .filter((f) => f.value !== '')

  return { fields, raw }
}
