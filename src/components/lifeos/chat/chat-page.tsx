'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, PanelLeft, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useTranslation } from '@/lib/i18n'
import { useChatStore } from '@/stores/chat-store'
import {
  approveToolCall,
  createChatSession,
  deleteChatSession,
  fetchChatConfig,
  fetchChatSession,
  fetchChatSessions,
  streamChatMessage,
  type ChatMessage,
  type ChatToolTrace,
} from '@/lib/api/chat'
import { ChatThreadList } from './chat-thread-list'
import { ChatMessageList } from './chat-message-list'
import type { PendingApproval } from './tool-approval-card'

const LIFEOS_QUERY_KEYS = [
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
]

export function ChatPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { activeSessionId, setActiveSessionId } = useChatStore()

  const [input, setInput] = useState('')
  const [threadsOpen, setThreadsOpen] = useState(true)
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingTools, setStreamingTools] = useState<ChatToolTrace[]>([])
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[] | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const { data: config } = useQuery({
    queryKey: ['chat', 'config'],
    queryFn: fetchChatConfig,
    retry: false,
  })

  const { data: sessions = [] } = useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: fetchChatSessions,
  })

  const { data: sessionDetail } = useQuery({
    queryKey: ['chat', 'session', activeSessionId],
    queryFn: () => fetchChatSession(activeSessionId!),
    enabled: !!activeSessionId,
  })

  useEffect(() => {
    if (activeSessionId && sessions.length > 0 && !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions, setActiveSessionId])

  const resetStreamState = useCallback(() => {
    setStreamingText('')
    setStreamingThinking('')
    setStreamingTools([])
    setApprovals([])
    setOptimisticMessages(null)
  }, [])

  const handleSelectSession = useCallback(
    (id: string) => {
      if (isStreaming) return
      setErrorText(null)
      resetStreamState()
      setActiveSessionId(id)
      if (isMobile) setMobileThreadsOpen(false)
    },
    [isMobile, isStreaming, resetStreamState, setActiveSessionId],
  )

  const handleNewChat = useCallback(async () => {
    if (isStreaming) return
    setErrorText(null)
    resetStreamState()
    const created = await createChatSession()
    await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    setActiveSessionId(created.id)
    if (isMobile) setMobileThreadsOpen(false)
  }, [isMobile, isStreaming, queryClient, resetStreamState, setActiveSessionId])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteChatSession(id)
      if (activeSessionId === id) {
        setActiveSessionId(null)
        resetStreamState()
      }
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    },
    [activeSessionId, queryClient, resetStreamState, setActiveSessionId],
  )

  const sendPrompt = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim()
      if (!trimmed || isStreaming) return

      setErrorText(null)
      let targetId = activeSessionId
      if (!targetId) {
        const created = await createChatSession()
        targetId = created.id
        setActiveSessionId(targetId)
        await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      }

      const baseMessages = sessionDetail?.id === targetId ? sessionDetail.messages : []
      setOptimisticMessages([...baseMessages, { role: 'user', text: trimmed }])
      setInput('')
      setIsStreaming(true)
      setStreamingText('')
      setStreamingThinking('')
      setStreamingTools([])
      setApprovals([])

      const ctrl = new AbortController()
      abortRef.current = ctrl
      let hadApprovedOrMutated = false

      try {
        await streamChatMessage(
          targetId,
          trimmed,
          (ev) => {
            switch (ev.type) {
              case 'text':
                if (ev.text) setStreamingText((prev) => prev + ev.text)
                break
              case 'thinking':
                if (ev.text) setStreamingThinking((prev) => prev + ev.text)
                break
              case 'tool_use':
                if (ev.tool) {
                  setStreamingTools((prev) => [...prev, ev.tool!])
                }
                break
              case 'tool_result':
                if (ev.tool) {
                  if (!ev.tool.isError) hadApprovedOrMutated = true
                  setStreamingTools((prev) =>
                    prev.map((item) =>
                      item.id === ev.tool!.id
                        ? { ...item, result: ev.tool!.result, isError: ev.tool!.isError }
                        : item,
                    ),
                  )
                }
                break
              case 'approval_required':
                if (ev.approval) {
                  setApprovals((prev) => [
                    ...prev,
                    { ...ev.approval!, status: 'pending' },
                  ])
                }
                break
              case 'error':
                if (ev.error) setErrorText(ev.error)
                break
              case 'done':
                break
            }
          },
          ctrl.signal,
        )
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setErrorText((err as Error)?.message || 'Chat request failed')
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
        await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
        await queryClient.invalidateQueries({ queryKey: ['chat', 'session', targetId] })
        if (hadApprovedOrMutated) {
          await Promise.all(
            LIFEOS_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
          )
        }
        resetStreamState()
      }
    },
    [
      activeSessionId,
      isStreaming,
      queryClient,
      resetStreamState,
      sessionDetail,
      setActiveSessionId,
    ],
  )

  const handleResolveApproval = useCallback(
    async (toolUseId: string, allow: boolean) => {
      if (!activeSessionId) return
      setApprovals((prev) =>
        prev.map((a) => (a.toolUseId === toolUseId ? { ...a, submitting: true } : a)),
      )
      try {
        await approveToolCall(activeSessionId, toolUseId, allow)
        setApprovals((prev) =>
          prev.map((a) =>
            a.toolUseId === toolUseId
              ? { ...a, status: allow ? 'approved' : 'denied', submitting: false }
              : a,
          ),
        )
        if (allow) {
          await Promise.all(
            LIFEOS_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
          )
        }
      } catch (err) {
        setErrorText((err as Error)?.message || 'Failed to submit approval')
        setApprovals((prev) =>
          prev.map((a) => (a.toolUseId === toolUseId ? { ...a, submitting: false } : a)),
        )
      }
    },
    [activeSessionId, queryClient],
  )

  const displayedMessages = optimisticMessages ?? sessionDetail?.messages ?? []

  return (
    <div className="flex h-full overflow-hidden">
      {!isMobile && threadsOpen && (
        <aside className="w-64 shrink-0 h-full">
          <ChatThreadList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewChat}
            onDelete={handleDeleteSession}
          />
        </aside>
      )}

      {isMobile && (
        <Sheet open={mobileThreadsOpen} onOpenChange={setMobileThreadsOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('chat.threads')}</SheetTitle>
            </SheetHeader>
            <ChatThreadList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onNew={handleNewChat}
              onDelete={handleDeleteSession}
            />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-col flex-1 min-w-0 h-full">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() =>
                isMobile ? setMobileThreadsOpen((v) => !v) : setThreadsOpen((v) => !v)
              }
              aria-label={t('chat.threads')}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{t('chat.title')}</h1>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {t('chat.subtitle')}
              </p>
            </div>
          </div>
          {config?.model && (
            <Badge variant="outline" className="font-mono text-[11px] shrink-0">
              {config.provider}/{config.model}
            </Badge>
          )}
        </div>

        {config && !config.llmConfigured && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('chat.missingKeyWarning')}</span>
          </div>
        )}

        {errorText && (
          <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorText}
          </div>
        )}

        <ChatMessageList
          messages={displayedMessages}
          streamingText={streamingText}
          streamingThinking={streamingThinking}
          streamingTools={streamingTools}
          approvals={approvals}
          isStreaming={isStreaming}
          onResolveApproval={handleResolveApproval}
          onStarterPrompt={(prompt) => void sendPrompt(prompt)}
        />

        <div className="border-t border-border p-3 shrink-0 bg-background">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendPrompt(input)
            }}
            className="mx-auto max-w-3xl flex items-end gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendPrompt(input)
                }
              }}
              placeholder={t('chat.placeholder')}
              rows={2}
              className="min-h-[44px] max-h-40 resize-none text-sm"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => abortRef.current?.abort()}
                aria-label={t('chat.stop')}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={!input.trim()}
                aria-label={t('chat.send')}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
