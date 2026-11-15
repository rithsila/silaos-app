import { describe, it, expect, vi, afterEach } from 'vitest'
import { streamChatMessage, type ChatStreamEvent } from '@/lib/api/chat'

describe('streamChatMessage SSE parser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses split SSE chunks including text, tool_use, approval_required, and done', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      'event: text\ndata: {"type":"text","text":"Hello "}\n\n',
      'event: tool_use\ndata: {"type":"tool_use","tool":{"id":"t1","name":"lifeos_tasks_list"}}\n\n',
      'event: approval_required\ndata: {"type":"approval_required","approval":{"toolUseId":"t2","toolName":"lifeos_tasks_create","input":{"body":{"title":"Test"}}}}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ]

    // Split across arbitrary boundaries to test partial line buffering.
    const raw = chunks.join('')
    const part1 = raw.slice(0, 42)
    const part2 = raw.slice(42, 175)
    const part3 = raw.slice(175)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1))
        controller.enqueue(encoder.encode(part2))
        controller.enqueue(encoder.encode(part3))
        controller.close()
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const received: ChatStreamEvent[] = []
    await streamChatMessage('sess-1', 'Hi', (ev) => received.push(ev))

    expect(received.map((e) => e.type)).toEqual([
      'text',
      'tool_use',
      'approval_required',
      'done',
    ])
    expect(received[0].text).toBe('Hello ')
    expect(received[1].tool?.name).toBe('lifeos_tasks_list')
    expect(received[2].approval?.toolUseId).toBe('t2')
    expect(received[2].approval?.toolName).toBe('lifeos_tasks_create')
  })

  it('throws backend error message when HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'LLM API key is not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(streamChatMessage('sess-1', 'Hi', () => {})).rejects.toThrow(
      'LLM API key is not configured',
    )
  })
})
