import { create } from 'zustand'
import type { QueryClient } from '@tanstack/react-query'
import {
  approveToolCall,
  cancelChatSession,
  streamChatMessage,
  type ChatMessage,
  type ChatToolTrace,
} from '@/lib/api/chat'
import type { PendingApproval } from '@/components/lifeos/chat/tool-approval-card'

export const LIFEOS_QUERY_KEYS = [
  ['tasks'],
  ['events'],
  ['habits'],
  ['notes'],
  ['projects'],
  ['goals'],
  ['finance'],
  ['dashboard'],
  ['journal'],
  ['courses'],
] as const

export interface SessionStreamRuntime {
  isStreaming: boolean
  streamingText: string
  streamingThinking: string
  streamingTools: ChatToolTrace[]
  approvals: PendingApproval[]
  optimisticMessages: ChatMessage[] | null
  errorText: string | null
}

export interface ServerApprovalStatus {
  status: 'pending' | 'approved' | 'denied'
  submitting?: boolean
}

const emptyRuntime = (): SessionStreamRuntime => ({
  isStreaming: false,
  streamingText: '',
  streamingThinking: '',
  streamingTools: [],
  approvals: [],
  optimisticMessages: null,
  errorText: null,
})

// Module-level controllers keep SSE streams alive across page navigation inside AppShell.
const abortControllers = new Map<string, AbortController>()
const sessionMutatedFlags = new Map<string, boolean>()

interface ChatRuntimeStore {
  runtimes: Record<string, SessionStreamRuntime>
  serverApprovals: Record<string, Record<string, ServerApprovalStatus>>
  clearSessionError: (sessionId: string) => void
  clearSessionRuntime: (sessionId: string) => void
  clearServerApprovals: (sessionId: string) => void
  startStream: (params: {
    sessionId: string
    prompt: string
    rewindFromIndex?: number
    optimisticMessages: ChatMessage[]
    queryClient: QueryClient
  }) => Promise<void>
  stopStream: (sessionId: string, queryClient: QueryClient) => Promise<void>
  resolveApproval: (
    sessionId: string,
    toolUseId: string,
    allow: boolean,
    queryClient: QueryClient,
  ) => Promise<void>
}

function invalidateLifeOSQueries(queryClient: QueryClient) {
  return Promise.all(
    LIFEOS_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}

export const useChatRuntimeStore = create<ChatRuntimeStore>()((set, get) => {
  const updateRuntime = (
    sessionId: string,
    updater: (prev: SessionStreamRuntime) => SessionStreamRuntime,
  ) => {
    set((state) => {
      const prev = state.runtimes[sessionId] ?? emptyRuntime()
      return {
        runtimes: {
          ...state.runtimes,
          [sessionId]: updater(prev),
        },
      }
    })
  }

  return {
    runtimes: {},
    serverApprovals: {},

    clearSessionError: (sessionId) => {
      set((state) => {
        const cur = state.runtimes[sessionId]
        if (!cur || !cur.errorText) return state
        return {
          runtimes: {
            ...state.runtimes,
            [sessionId]: { ...cur, errorText: null },
          },
        }
      })
    },

    clearSessionRuntime: (sessionId) => {
      abortControllers.get(sessionId)?.abort()
      abortControllers.delete(sessionId)
      sessionMutatedFlags.delete(sessionId)
      set((state) => {
        if (!state.runtimes[sessionId] && !state.serverApprovals[sessionId]) return state
        const runtimes = { ...state.runtimes }
        const serverApprovals = { ...state.serverApprovals }
        delete runtimes[sessionId]
        delete serverApprovals[sessionId]
        return { runtimes, serverApprovals }
      })
    },

    clearServerApprovals: (sessionId) => {
      set((state) => {
        if (!state.serverApprovals[sessionId]) return state
        const serverApprovals = { ...state.serverApprovals }
        delete serverApprovals[sessionId]
        return { serverApprovals }
      })
    },

    startStream: async ({
      sessionId,
      prompt,
      rewindFromIndex,
      optimisticMessages,
      queryClient,
    }) => {
      if (abortControllers.has(sessionId) || get().runtimes[sessionId]?.isStreaming) {
        return
      }

      const ctrl = new AbortController()
      abortControllers.set(sessionId, ctrl)
      sessionMutatedFlags.set(sessionId, false)

      set((state) => {
        const serverApprovals = { ...state.serverApprovals }
        delete serverApprovals[sessionId]
        return {
          serverApprovals,
          runtimes: {
            ...state.runtimes,
            [sessionId]: {
              isStreaming: true,
              streamingText: '',
              streamingThinking: '',
              streamingTools: [],
              approvals: [],
              optimisticMessages,
              errorText: null,
            },
          },
        }
      })

      try {
        await streamChatMessage(
          sessionId,
          prompt,
          (ev) => {
            switch (ev.type) {
              case 'text':
                if (ev.text) {
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    streamingText: prev.streamingText + ev.text,
                  }))
                }
                break
              case 'thinking':
                if (ev.text) {
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    streamingThinking: prev.streamingThinking + ev.text,
                  }))
                }
                break
              case 'tool_use':
                if (ev.tool) {
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    streamingTools: [...prev.streamingTools, ev.tool!],
                  }))
                }
                break
              case 'tool_result':
                if (ev.tool) {
                  if (!ev.tool.isError) {
                    sessionMutatedFlags.set(sessionId, true)
                  }
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    streamingTools: prev.streamingTools.map((item) =>
                      item.id === ev.tool!.id
                        ? { ...item, result: ev.tool!.result, isError: ev.tool!.isError }
                        : item,
                    ),
                  }))
                }
                break
              case 'approval_required':
                if (ev.approval) {
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    approvals: [
                      ...prev.approvals,
                      { ...ev.approval!, status: 'pending' },
                    ],
                  }))
                }
                break
              case 'error':
                if (ev.error) {
                  updateRuntime(sessionId, (prev) => ({
                    ...prev,
                    errorText: ev.error ?? null,
                  }))
                }
                break
              case 'done':
                break
            }
          },
          ctrl.signal,
          rewindFromIndex,
        )
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          const msg = (err as Error)?.message || 'Chat request failed'
          updateRuntime(sessionId, (prev) => ({ ...prev, errorText: msg }))
        }
      } finally {
        abortControllers.delete(sessionId)
        const mutated = sessionMutatedFlags.get(sessionId) ?? false
        sessionMutatedFlags.delete(sessionId)

        updateRuntime(sessionId, (prev) => ({ ...prev, isStreaming: false }))

        await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
        await queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] })
        if (mutated) {
          await invalidateLifeOSQueries(queryClient)
        }

        set((state) => {
          const cur = state.runtimes[sessionId]
          if (!cur || cur.isStreaming) return state
          const runtimes = { ...state.runtimes }
          if (cur.errorText) {
            runtimes[sessionId] = {
              ...emptyRuntime(),
              errorText: cur.errorText,
            }
          } else {
            delete runtimes[sessionId]
          }
          return { runtimes }
        })
      }
    },

    stopStream: async (sessionId, queryClient) => {
      abortControllers.get(sessionId)?.abort()
      try {
        await cancelChatSession(sessionId)
      } catch {
        // Ignore cancel errors if turn already ended.
      }
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] })
    },

    resolveApproval: async (sessionId, toolUseId, allow, queryClient) => {
      const hasLocalApproval = Boolean(
        get().runtimes[sessionId]?.approvals.some((a) => a.toolUseId === toolUseId),
      )

      if (hasLocalApproval) {
        updateRuntime(sessionId, (prev) => ({
          ...prev,
          approvals: prev.approvals.map((a) =>
            a.toolUseId === toolUseId ? { ...a, submitting: true } : a,
          ),
        }))
        try {
          await approveToolCall(sessionId, toolUseId, allow)
          if (allow) sessionMutatedFlags.set(sessionId, true)
          updateRuntime(sessionId, (prev) => ({
            ...prev,
            approvals: prev.approvals.map((a) =>
              a.toolUseId === toolUseId
                ? { ...a, status: allow ? 'approved' : 'denied', submitting: false }
                : a,
            ),
          }))
          if (allow) {
            await invalidateLifeOSQueries(queryClient)
          }
        } catch (err) {
          const msg = (err as Error)?.message || 'Failed to submit approval'
          updateRuntime(sessionId, (prev) => ({
            ...prev,
            errorText: msg,
            approvals: prev.approvals.map((a) =>
              a.toolUseId === toolUseId ? { ...a, submitting: false } : a,
            ),
          }))
        }
        return
      }

      // Server-restored approval (e.g. after browser refresh while awaiting user input).
      set((state) => ({
        serverApprovals: {
          ...state.serverApprovals,
          [sessionId]: {
            ...state.serverApprovals[sessionId],
            [toolUseId]: { status: 'pending', submitting: true },
          },
        },
      }))
      try {
        await approveToolCall(sessionId, toolUseId, allow)
        set((state) => ({
          serverApprovals: {
            ...state.serverApprovals,
            [sessionId]: {
              ...state.serverApprovals[sessionId],
              [toolUseId]: { status: allow ? 'approved' : 'denied', submitting: false },
            },
          },
        }))
        await queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] })
        await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
        if (allow) {
          await invalidateLifeOSQueries(queryClient)
        }
      } catch (err) {
        const msg = (err as Error)?.message || 'Failed to submit approval'
        updateRuntime(sessionId, (prev) => ({ ...prev, errorText: msg }))
        set((state) => ({
          serverApprovals: {
            ...state.serverApprovals,
            [sessionId]: {
              ...state.serverApprovals[sessionId],
              [toolUseId]: { status: 'pending', submitting: false },
            },
          },
        }))
      }
    },
  }
})

/** Aborts in-flight streams and resets transient runtime state (for unit tests). */
export function resetAllChatRuntimes() {
  for (const ctrl of abortControllers.values()) {
    ctrl.abort()
  }
  abortControllers.clear()
  sessionMutatedFlags.clear()
  useChatRuntimeStore.setState({ runtimes: {}, serverApprovals: {} })
}
