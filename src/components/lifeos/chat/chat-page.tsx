'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, PanelLeft, Send, SlidersHorizontal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useTranslation } from '@/lib/i18n'
import { useChatStore } from '@/stores/chat-store'
import { LIFEOS_QUERY_KEYS, useChatRuntimeStore } from '@/stores/chat-runtime'
import {
  createChatSession,
  deleteChatSession,
  fetchChatConfig,
  fetchChatInstructions,
  fetchChatSession,
  fetchChatSessions,
  renameChatSession,
  type ChatMessage,
  type ChatToolTrace,
} from '@/lib/api/chat'
import { ChatThreadList } from './chat-thread-list'
import { ChatMessageList } from './chat-message-list'
import { CustomInstructionsDialog } from './custom-instructions-dialog'
import type { PendingApproval } from './tool-approval-card'

const EMPTY_TOOLS: ChatToolTrace[] = []
const EMPTY_APPROVALS: PendingApproval[] = []

export function ChatPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { activeSessionId, setActiveSessionId } = useChatStore()

  const runtime = useChatRuntimeStore((s) =>
    activeSessionId ? s.runtimes[activeSessionId] : undefined,
  )
  const serverApprovalMap = useChatRuntimeStore((s) =>
    activeSessionId ? s.serverApprovals[activeSessionId] : undefined,
  )
  const startStream = useChatRuntimeStore((s) => s.startStream)
  const stopStream = useChatRuntimeStore((s) => s.stopStream)
  const resolveApproval = useChatRuntimeStore((s) => s.resolveApproval)
  const clearSessionError = useChatRuntimeStore((s) => s.clearSessionError)
  const clearSessionRuntime = useChatRuntimeStore((s) => s.clearSessionRuntime)
  const clearServerApprovals = useChatRuntimeStore((s) => s.clearServerApprovals)

  const [input, setInput] = useState('')
  const [threadsOpen, setThreadsOpen] = useState(true)
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [localErrorText, setLocalErrorText] = useState<string | null>(null)

  const isLocalStreaming = runtime?.isStreaming ?? false
  const prevServerBusyRef = useRef<{ id: string | null; busy: boolean }>({ id: null, busy: false })

  const { data: config } = useQuery({
    queryKey: ['chat', 'config'],
    queryFn: fetchChatConfig,
    retry: false,
  })

  const { data: instructionsData } = useQuery({
    queryKey: ['chat', 'instructions'],
    queryFn: fetchChatInstructions,
    retry: false,
  })

  const hasActiveInstructions = Boolean(
    instructionsData?.enabled && instructionsData.instructions.trim(),
  )

  const { data: sessions = [] } = useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: fetchChatSessions,
  })

  const { data: sessionDetail } = useQuery({
    queryKey: ['chat', 'session', activeSessionId],
    queryFn: () => fetchChatSession(activeSessionId!),
    enabled: !!activeSessionId,
    refetchInterval: (query) =>
      query.state.data?.busy && !isLocalStreaming ? 1500 : false,
  })

  useEffect(() => {
    const busyNow = Boolean(sessionDetail?.busy)
    const prev = prevServerBusyRef.current
    if (
      activeSessionId &&
      prev.id === activeSessionId &&
      prev.busy &&
      !busyNow &&
      !isLocalStreaming
    ) {
      clearServerApprovals(activeSessionId)
      void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      void Promise.all(
        LIFEOS_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
    }
    prevServerBusyRef.current = { id: activeSessionId, busy: busyNow }
  }, [activeSessionId, clearServerApprovals, isLocalStreaming, queryClient, sessionDetail?.busy])

  useEffect(() => {
    if (activeSessionId && sessions.length > 0 && !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions, setActiveSessionId])

  const isBusy = isLocalStreaming || Boolean(sessionDetail?.busy)
  const streamingText = runtime?.streamingText ?? ''
  const streamingThinking = runtime?.streamingThinking ?? ''
  const streamingTools = runtime?.streamingTools ?? EMPTY_TOOLS
  const errorText = runtime?.errorText ?? localErrorText

  const approvals = useMemo<PendingApproval[]>(() => {
    if (runtime && (runtime.isStreaming || runtime.approvals.length > 0)) {
      return runtime.approvals
    }
    const serverPending = sessionDetail?.pendingApprovals
    if (!serverPending || serverPending.length === 0) {
      return EMPTY_APPROVALS
    }
    return serverPending.map((apr) => ({
      ...apr,
      status: serverApprovalMap?.[apr.toolUseId]?.status ?? 'pending',
      submitting: serverApprovalMap?.[apr.toolUseId]?.submitting ?? false,
    }))
  }, [runtime, serverApprovalMap, sessionDetail?.pendingApprovals])

  const handleSelectSession = useCallback(
    (id: string) => {
      setLocalErrorText(null)
      clearSessionError(id)
      setActiveSessionId(id)
      if (isMobile) setMobileThreadsOpen(false)
    },
    [clearSessionError, isMobile, setActiveSessionId],
  )

  const handleNewChat = useCallback(async () => {
    setLocalErrorText(null)
    const created = await createChatSession()
    await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    setActiveSessionId(created.id)
    if (isMobile) setMobileThreadsOpen(false)
  }, [isMobile, queryClient, setActiveSessionId])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteChatSession(id)
      clearSessionRuntime(id)
      if (activeSessionId === id) {
        setActiveSessionId(null)
      }
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    },
    [activeSessionId, clearSessionRuntime, queryClient, setActiveSessionId],
  )

  const handleRenameSession = useCallback(
    async (id: string, title: string) => {
      await renameChatSession(id, title)
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      if (activeSessionId === id) {
        await queryClient.invalidateQueries({ queryKey: ['chat', 'session', id] })
      }
    },
    [activeSessionId, queryClient],
  )

  const sendPrompt = useCallback(
    async (
      promptText: string,
      opts?: { rewindFromIndex?: number; preserveInput?: boolean },
    ) => {
      const trimmed = promptText.trim()
      if (!trimmed || isBusy) return

      setLocalErrorText(null)
      let targetId = activeSessionId
      if (!targetId) {
        try {
          const created = await createChatSession()
          targetId = created.id
          setActiveSessionId(targetId)
          await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
        } catch (err) {
          setLocalErrorText((err as Error)?.message || 'Failed to create chat session')
          return
        }
      }

      const baseMessages =
        sessionDetail?.id === targetId && Array.isArray(sessionDetail.messages)
          ? sessionDetail.messages
          : []
      const rewindIdx = opts?.rewindFromIndex
      const prefix = typeof rewindIdx === 'number' ? baseMessages.slice(0, rewindIdx) : baseMessages
      const optimisticMessages: ChatMessage[] = [...prefix, { role: 'user', text: trimmed }]
      if (!opts?.preserveInput) {
        setInput('')
      }

      await startStream({
        sessionId: targetId,
        prompt: trimmed,
        rewindFromIndex: rewindIdx,
        optimisticMessages,
        queryClient,
      })
    },
    [
      activeSessionId,
      isBusy,
      queryClient,
      sessionDetail,
      setActiveSessionId,
      startStream,
    ],
  )

  const handleEditPrompt = useCallback(
    async (index: number, newText: string) => {
      await sendPrompt(newText, { rewindFromIndex: index, preserveInput: true })
    },
    [sendPrompt],
  )

  const handleRegenerate = useCallback(
    async (assistantIndex: number) => {
      const msgs = Array.isArray(sessionDetail?.messages) ? sessionDetail.messages : []
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (msgs[i]?.role === 'user' && msgs[i].text.trim()) {
          await sendPrompt(msgs[i].text, { rewindFromIndex: i, preserveInput: true })
          return
        }
      }
    },
    [sendPrompt, sessionDetail],
  )

  const handleResolveApproval = useCallback(
    async (toolUseId: string, allow: boolean) => {
      if (!activeSessionId) return
      await resolveApproval(activeSessionId, toolUseId, allow, queryClient)
    },
    [activeSessionId, queryClient, resolveApproval],
  )

  const displayedMessages =
    runtime?.optimisticMessages ??
    (Array.isArray(sessionDetail?.messages) ? sessionDetail.messages : [])

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {!isMobile && threadsOpen && (
        <aside className="w-64 shrink-0 h-full min-h-0 overflow-hidden">
          <ChatThreadList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewChat}
            onRename={handleRenameSession}
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
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
            />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-col flex-1 min-w-0 min-h-0 h-full">
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
            onClick={() => setInstructionsOpen(true)}
            aria-label={t('chat.customInstructions')}
            data-active={hasActiveInstructions ? 'true' : 'false'}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">{t('chat.customInstructions')}</span>
            {hasActiveInstructions && (
              <span
                className="h-2 w-2 rounded-full bg-primary"
                aria-label={t('chat.customInstructionsActive')}
              />
            )}
          </Button>
        </div>

        <CustomInstructionsDialog
          open={instructionsOpen}
          onOpenChange={setInstructionsOpen}
          initialData={instructionsData}
        />

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
          isStreaming={isBusy}
          onResolveApproval={handleResolveApproval}
          onStarterPrompt={(prompt) => void sendPrompt(prompt)}
          onEditPrompt={handleEditPrompt}
          onRegenerate={handleRegenerate}
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
            />
            {isBusy ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => activeSessionId && void stopStream(activeSessionId, queryClient)}
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
