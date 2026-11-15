import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, createTestQueryClient, userEvent } from '../utils/test-utils'
import { server } from '../mocks/server'
import { ChatPage } from '@/components/lifeos/chat/chat-page'
import { useChatStore } from '@/stores/chat-store'

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(f))
      }
      controller.close()
    },
  })
  return new HttpResponse(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('ChatPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    useChatStore.setState({ activeSessionId: null })
    server.use(
      http.get('/api/chat/config', () =>
        HttpResponse.json({ llmConfigured: true, provider: 'openai', model: 'gpt-4o-mini' }),
      ),
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [] })),
    )
  })

  it('renders starter prompts and composer in empty state', async () => {
    renderWithProviders(<ChatPage />)

    expect(await screen.findByText("Summarize today's tasks and schedule")).toBeInTheDocument()
    expect(screen.getByText('Review my habit streaks and gaps')).toBeInTheDocument()
    expect(screen.getByText('Check my recent spending and budgets')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Ask about your tasks, schedule, habits, or notes...'),
    ).toBeInTheDocument()
  })

  it('creates a session, streams assistant reply, and refreshes thread list', async () => {
    const sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> = []
    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions })),
      http.post('/api/chat/sessions', async () => {
        const s = {
          id: 'sess-100',
          title: 'New Chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        sessions.push(s)
        return HttpResponse.json(s, { status: 201 })
      }),
      http.post('/api/chat/sessions/sess-100/message', () => {
        sessions[0].title = 'What are my open tasks?'
        return sseResponse([
          'event: text\ndata: {"type":"text","text":"You have 2 open tasks today."}\n\n',
          'event: done\ndata: {"type":"done"}\n\n',
        ])
      }),
      http.get('/api/chat/sessions/sess-100', () =>
        HttpResponse.json({
          ...sessions[0],
          messages: [
            { role: 'user', text: 'What are my open tasks?' },
            { role: 'assistant', text: 'You have 2 open tasks today.' },
          ],
        }),
      ),
    )

    const user = userEvent.setup()
    renderWithProviders(<ChatPage />)

    const input = await screen.findByPlaceholderText(
      'Ask about your tasks, schedule, habits, or notes...',
    )
    await user.type(input, 'What are my open tasks?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('You have 2 open tasks today.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('What are my open tasks?').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('renders tool approval card, posts approval decision, and invalidates Life OS caches', async () => {
    let approvalPayload: { toolUseId: string; allow: boolean } | null = null
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    const session = {
      id: 'sess-200',
      title: 'Task helper',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [session] })),
      http.get('/api/chat/sessions/sess-200', () =>
        HttpResponse.json({ ...session, messages: [] }),
      ),
      http.post('/api/chat/sessions/sess-200/message', () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller
            controller.enqueue(
              encoder.encode(
                'event: approval_required\ndata: {"type":"approval_required","approval":{"toolUseId":"tu-1","toolName":"lifeos_tasks_create","input":{"body":{"title":"Buy milk"}}}}\n\n',
              ),
            )
          },
        })
        return new HttpResponse(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
      http.post('/api/chat/sessions/sess-200/approve', async ({ request }) => {
        approvalPayload = (await request.json()) as { toolUseId: string; allow: boolean }
        streamController?.enqueue(
          encoder.encode(
            'event: text\ndata: {"type":"text","text":"Created task Buy milk."}\n\n',
          ),
        )
        streamController?.enqueue(
          encoder.encode('event: done\ndata: {"type":"done"}\n\n'),
        )
        streamController?.close()
        return HttpResponse.json({ ok: true })
      }),
    )

    useChatStore.setState({ activeSessionId: 'sess-200' })
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const user = userEvent.setup()
    renderWithProviders(<ChatPage />, { queryClient })

    const input = await screen.findByPlaceholderText(
      'Ask about your tasks, schedule, habits, or notes...',
    )
    await user.type(input, 'Add task Buy milk')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Create Task')).toBeInTheDocument()
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    const detailsBtn = screen.getByRole('button', { name: 'Details' })
    await user.click(detailsBtn)
    expect(screen.getByText('lifeos_tasks_create')).toBeInTheDocument()
    const approveBtn = await screen.findByRole('button', { name: 'Approve' })
    await user.click(approveBtn)

    await waitFor(() => {
      expect(approvalPayload).toEqual({ toolUseId: 'tu-1', allow: true })
    })
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('aborts active stream when component unmounts', async () => {
    let observedSignal: AbortSignal | undefined
    const session = {
      id: 'sess-300',
      title: 'Abort check',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [session] })),
      http.get('/api/chat/sessions/sess-300', () =>
        HttpResponse.json({ ...session, messages: [] }),
      ),
      http.post('/api/chat/sessions/sess-300/message', ({ request }) => {
        observedSignal = request.signal
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('event: text\ndata: {"type":"text","text":"Working..."}\n\n'),
            )
          },
        })
        return new HttpResponse(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
    )

    useChatStore.setState({ activeSessionId: 'sess-300' })
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<ChatPage />)

    const input = await screen.findByPlaceholderText(
      'Ask about your tasks, schedule, habits, or notes...',
    )
    await user.type(input, 'Long running prompt')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Working...')).toBeInTheDocument()
    expect(observedSignal).toBeDefined()
    expect(observedSignal?.aborted).toBe(false)

    unmount()
    expect(observedSignal?.aborted).toBe(true)
  })

  it('handles null messages on empty session when clicking a starter prompt', async () => {
    const session = {
      id: 'sess-empty',
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let posted = false
    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [session] })),
      http.get('/api/chat/sessions/sess-empty', () =>
        HttpResponse.json({
          ...session,
          messages: posted
            ? [
                { role: 'user', text: "Summarize today's tasks and schedule" },
                { role: 'assistant', text: 'Here is your summary.' },
              ]
            : null,
        }),
      ),
      http.post('/api/chat/sessions/sess-empty/message', () => {
        posted = true
        return sseResponse([
          'event: text\ndata: {"type":"text","text":"Here is your summary."}\n\n',
          'event: done\ndata: {"type":"done"}\n\n',
        ])
      }),
    )

    useChatStore.setState({ activeSessionId: 'sess-empty' })
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />)

    const starter = await screen.findByRole('button', {
      name: "Summarize today's tasks and schedule",
    })
    await user.click(starter)

    expect(await screen.findByText('Here is your summary.')).toBeInTheDocument()
  })

  it('renders markdown, copies messages, edits prompt, and regenerates reply', async () => {
    const session = {
      id: 'sess-edit',
      title: 'Habits thread',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    let messages = [
      { role: 'user', text: 'Original prompt' },
      { role: 'assistant', text: '**Bold answer**\n\n```ts\nconst x = 1\n```' },
    ]
    const postedPayloads: Array<{ message: string; rewindFromIndex?: number }> = []

    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [session] })),
      http.get('/api/chat/sessions/sess-edit', () =>
        HttpResponse.json({ ...session, messages }),
      ),
      http.post('/api/chat/sessions/sess-edit/message', async ({ request }) => {
        const body = (await request.json()) as { message: string; rewindFromIndex?: number }
        postedPayloads.push(body)
        messages = [
          { role: 'user', text: body.message },
          { role: 'assistant', text: `Reply for: ${body.message}` },
        ]
        return sseResponse([
          `event: text\ndata: ${JSON.stringify({ type: 'text', text: `Reply for: ${body.message}` })}\n\n`,
          'event: done\ndata: {"type":"done"}\n\n',
        ])
      }),
    )

    useChatStore.setState({ activeSessionId: 'sess-edit' })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderWithProviders(<ChatPage />)

    // Markdown bold renders cleanly (without literal **)
    expect(await screen.findByText('Bold answer')).toBeInTheDocument()

    // Copy assistant reply and code block
    const copyButtons = screen.getAllByRole('button', { name: 'Copy' })
    await user.click(copyButtons[1])
    expect(writeText).toHaveBeenCalledWith('**Bold answer**\n\n```ts\nconst x = 1\n```')

    await user.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('const x = 1')

    // Edit user prompt and resend
    await user.click(screen.getByRole('button', { name: 'Edit prompt' }))
    const editBox = screen.getByLabelText('Edit prompt')
    await user.clear(editBox)
    await user.type(editBox, 'Updated prompt')
    await user.click(screen.getByRole('button', { name: 'Save & Send' }))

    expect(await screen.findByText('Reply for: Updated prompt')).toBeInTheDocument()
    expect(postedPayloads[0]).toEqual({ message: 'Updated prompt', rewindFromIndex: 0 })

    // Regenerate assistant reply re-sends current user prompt from index 0
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(postedPayloads).toHaveLength(2))
    expect(postedPayloads[1]).toEqual({ message: 'Updated prompt', rewindFromIndex: 0 })
  })

  it('renames a conversation thread inline', async () => {
    let session = {
      id: 'sess-ren',
      title: 'Old Title',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    server.use(
      http.get('/api/chat/sessions', () => HttpResponse.json({ sessions: [session] })),
      http.get('/api/chat/sessions/sess-ren', () =>
        HttpResponse.json({ ...session, messages: [] }),
      ),
      http.patch('/api/chat/sessions/sess-ren', async ({ request }) => {
        const body = (await request.json()) as { title: string }
        session = { ...session, title: body.title }
        return HttpResponse.json(session)
      }),
    )

    useChatStore.setState({ activeSessionId: 'sess-ren' })
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />)

    expect(await screen.findByText('Old Title')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }))
    const titleInput = screen.getByLabelText('Rename conversation')
    await user.clear(titleInput)
    await user.type(titleInput, 'Weekly Goals{Enter}')

    expect(await screen.findByText('Weekly Goals')).toBeInTheDocument()
  })
})
