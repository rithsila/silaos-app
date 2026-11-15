import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export interface ChatSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatToolTrace {
  id: string
  name?: string
  input?: string
  result?: string
  isError?: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant' | string
  text: string
  toolCalls?: ChatToolTrace[]
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatMessage[]
}

export interface ChatConfigStatus {
  llmConfigured: boolean
  provider: string
  model: string
}

export interface ChatApprovalRequest {
  toolUseId: string
  toolName: string
  input: unknown
}

export interface ChatUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface ChatStreamEvent {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'approval_required' | 'usage' | 'done' | 'error'
  text?: string
  tool?: ChatToolTrace
  approval?: ChatApprovalRequest
  usage?: ChatUsage
  error?: string
}

export async function fetchChatConfig(): Promise<ChatConfigStatus> {
  return apiGet<ChatConfigStatus>('/api/chat/config')
}

export async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
  const data = await apiGet<{ sessions: ChatSessionSummary[] }>('/api/chat/sessions')
  return data.sessions ?? []
}

export async function createChatSession(title?: string): Promise<ChatSessionSummary> {
  return apiPost<ChatSessionSummary>('/api/chat/sessions', title ? { title } : {})
}

export async function fetchChatSession(id: string): Promise<ChatSessionDetail> {
  const data = await apiGet<ChatSessionDetail>(`/api/chat/sessions/${encodeURIComponent(id)}`)
  return {
    ...data,
    messages: Array.isArray(data.messages) ? data.messages : [],
  }
}

export async function renameChatSession(id: string, title: string): Promise<ChatSessionSummary> {
  return apiPatch<ChatSessionSummary>(`/api/chat/sessions/${encodeURIComponent(id)}`, { title })
}

export async function deleteChatSession(id: string): Promise<void> {
  await apiDelete(`/api/chat/sessions/${encodeURIComponent(id)}`)
}

export async function approveToolCall(
  sessionId: string,
  toolUseId: string,
  allow: boolean,
): Promise<void> {
  await apiPost(`/api/chat/sessions/${encodeURIComponent(sessionId)}/approve`, {
    toolUseId,
    allow,
  })
}

export async function streamChatMessage(
  sessionId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  rewindFromIndex?: number,
): Promise<void> {
  const payload: { message: string; rewindFromIndex?: number } = { message }
  if (typeof rewindFromIndex === 'number') {
    payload.rewindFromIndex = rewindFromIndex
  }
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  })

  if (!res.ok) {
    let errMsg = `API error: ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) errMsg = data.error
    } catch {
      // non-JSON error body
    }
    throw new Error(errMsg)
  }

  if (!res.body) {
    throw new Error('Streaming response body is missing')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processFrame = (frame: string) => {
    const lines = frame.split(/\r?\n/)
    let eventName = ''
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) return
    const rawData = dataLines.join('\n')
    const parsed = JSON.parse(rawData) as ChatStreamEvent
    if (!parsed.type && eventName) {
      parsed.type = eventName as ChatStreamEvent['type']
    }
    onEvent(parsed)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sepIdx = buffer.indexOf('\n\n')
    while (sepIdx !== -1) {
      const frame = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)
      if (frame.trim()) {
        processFrame(frame)
      }
      sepIdx = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    processFrame(buffer)
  }
}
