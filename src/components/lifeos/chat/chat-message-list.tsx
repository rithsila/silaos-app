'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, ChevronRight, Copy, Loader2, Pencil, RotateCcw, Sparkles, User, Wrench } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import type { ChatMessage, ChatToolTrace } from '@/lib/api/chat'
import { ChatMarkdown } from './chat-markdown'
import { formatProgressLabel, formatToolLabel, parseToolPayload } from './tool-format'
import { ToolApprovalCard, type PendingApproval } from './tool-approval-card'

interface ChatMessageListProps {
  messages: ChatMessage[]
  streamingText: string
  streamingThinking: string
  streamingTools: ChatToolTrace[]
  approvals: PendingApproval[]
  isStreaming: boolean
  onResolveApproval: (toolUseId: string, allow: boolean) => void
  onStarterPrompt: (prompt: string) => void
  onEditPrompt?: (index: number, newText: string) => void | Promise<void>
  onRegenerate?: (index: number) => void | Promise<void>
}

function CopyTextButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard unavailable in restricted contexts
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? t('chat.copied') : label || t('chat.copy')}
      title={copied ? t('chat.copied') : label || t('chat.copy')}
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
    </button>
  )
}

type GroupedTurn =
  | { kind: 'user'; text: string; sourceIndex: number }
  | {
      kind: 'assistant'
      text: string
      toolCalls: ChatToolTrace[]
      thinking?: string
      isLive?: boolean
      lastIndex: number | null
    }

function groupChatTurns(
  messages: ChatMessage[],
  live?: {
    isStreaming: boolean
    text: string
    thinking: string
    tools: ChatToolTrace[]
  },
): GroupedTurn[] {
  const turns: GroupedTurn[] = []

  messages.forEach((msg, idx) => {
    if (msg.role === 'user') {
      turns.push({ kind: 'user', text: msg.text, sourceIndex: idx })
      return
    }
    const prev = turns[turns.length - 1]
    if (prev && prev.kind === 'assistant') {
      if (msg.toolCalls?.length) {
        prev.toolCalls.push(...msg.toolCalls)
      }
      if (msg.text) {
        prev.text = prev.text ? `${prev.text}\n\n${msg.text}` : msg.text
      }
      prev.lastIndex = idx
    } else {
      turns.push({
        kind: 'assistant',
        text: msg.text,
        toolCalls: msg.toolCalls ? [...msg.toolCalls] : [],
        lastIndex: idx,
      })
    }
  })

  const hasLive =
    live && (live.isStreaming || live.text || live.thinking || live.tools.length > 0)
  if (hasLive) {
    const prev = turns[turns.length - 1]
    if (prev && prev.kind === 'assistant') {
      prev.toolCalls = [...prev.toolCalls, ...live.tools]
      if (live.text) {
        prev.text = prev.text ? `${prev.text}\n\n${live.text}` : live.text
      }
      prev.thinking = live.thinking || prev.thinking
      prev.isLive = live.isStreaming
    } else {
      turns.push({
        kind: 'assistant',
        text: live.text,
        toolCalls: [...live.tools],
        thinking: live.thinking,
        isLive: live.isStreaming,
        lastIndex: null,
      })
    }
  }

  return turns
}

function ToolTraceList({
  tools,
  active = false,
  thinking,
}: {
  tools: ChatToolTrace[]
  active?: boolean
  thinking?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (tools.length === 0 && !active && !thinking) return null

  const labels = tools.map((tl) => formatToolLabel(tl.name, tl.input))
  const uniqueLabels = Array.from(new Set(labels))
  const primaryLabel =
    uniqueLabels.find((l) => l !== 'Find tools' && l !== 'Search') ?? uniqueLabels[0]

  const latestTool = tools[tools.length - 1]
  const headerText = active
    ? latestTool
      ? formatProgressLabel(latestTool.name, latestTool.input)
      : `${t('chat.thinking')}...`
    : primaryLabel
      ? tools.length > 1
        ? `${primaryLabel} +${tools.length - 1}`
        : primaryLabel
      : t('chat.thinking')

  const hasDetails = tools.length > 0 || Boolean(thinking)

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/25 px-3 py-1.5 text-xs">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground w-full min-w-0 text-left disabled:cursor-default disabled:hover:text-muted-foreground"
      >
        {hasDetails ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )
        ) : null}
        {active ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : (
          <Wrench className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate font-medium text-foreground/85 min-w-0">{headerText}</span>
        {tools.length > 1 && (
          <span className="shrink-0 text-[11px] text-muted-foreground">({tools.length})</span>
        )}
      </button>
      {open && hasDetails && (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2 min-w-0">
          {thinking && (
            <p className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {thinking}
            </p>
          )}
          {tools.map((tl) => {
            const label = formatToolLabel(tl.name, tl.input)
            const { fields } = parseToolPayload(tl.input)
            return (
              <div key={tl.id} className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge
                    variant={tl.isError ? 'destructive' : 'secondary'}
                    className="text-[11px] max-w-full truncate"
                  >
                    {label}
                  </Badge>
                </div>
                {fields.length > 0 && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 rounded bg-background/70 px-2.5 py-1.5 text-[11px] min-w-0 overflow-hidden">
                    {fields.map((field) => (
                      <div key={field.label} className="contents">
                        <dt className="text-muted-foreground shrink-0">{field.label}</dt>
                        <dd className="text-foreground min-w-0 break-words [overflow-wrap:anywhere]">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {tl.result && tl.isError && (
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded bg-destructive/10 p-1.5 text-[11px] text-destructive">
                    {tl.result}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ChatMessageList({
  messages,
  streamingText,
  streamingThinking,
  streamingTools,
  approvals,
  isStreaming,
  onResolveApproval,
  onStarterPrompt,
  onEditPrompt,
  onRegenerate,
}: ChatMessageListProps) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    if (isStreaming) {
      setEditingIndex(null)
    }
  }, [isStreaming])

  const submitEdit = async (idx: number) => {
    const trimmed = editDraft.trim()
    if (!trimmed || !onEditPrompt) return
    setEditingIndex(null)
    await onEditPrompt(idx, trimmed)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages.length, streamingText, approvals.length])

  const starters = [
    t('chat.starterTasks'),
    t('chat.starterHabits'),
    t('chat.starterFinance'),
  ]

  const isEmpty =
    messages.length === 0 &&
    !streamingText &&
    !streamingThinking &&
    streamingTools.length === 0 &&
    approvals.length === 0

  const turns = useMemo(
    () =>
      groupChatTurns(messages, {
        isStreaming,
        text: streamingText,
        thinking: streamingThinking,
        tools: streamingTools,
      }),
    [isStreaming, messages, streamingText, streamingThinking, streamingTools],
  )

  return (
    <ScrollArea className="flex-1 min-h-0 px-4 py-6 [&_[data-slot=scroll-area-viewport]>div]:!block">
      <div className="mx-auto max-w-3xl space-y-5">
        {isEmpty ? (
          <div className="py-12 text-center space-y-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">{t('chat.emptyTitle')}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t('chat.emptySubtitle')}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => onStarterPrompt(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {turns.map((turn, tIdx) => {
              if (turn.kind === 'user') {
                const isEditing = editingIndex === turn.sourceIndex
                return (
                  <div
                    key={`user-${turn.sourceIndex}`}
                    className="group flex gap-3 justify-end"
                  >
                    <div
                      className={cn(
                        'max-w-[85%] min-w-0 space-y-1.5 flex flex-col items-end',
                        isEditing && 'w-full',
                      )}
                    >
                      {isEditing ? (
                        <div className="w-full space-y-2 rounded-xl border border-border bg-muted/40 p-2.5">
                          <Textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void submitEdit(turn.sourceIndex)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingIndex(null)
                              }
                            }}
                            rows={3}
                            autoFocus
                            className="min-h-[60px] text-sm bg-background"
                            aria-label={t('chat.editPrompt')}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => setEditingIndex(null)}
                            >
                              {t('chat.cancel')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              disabled={!editDraft.trim() || isStreaming}
                              onClick={() => void submitEdit(turn.sourceIndex)}
                            >
                              {t('chat.saveAndSend')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        turn.text && (
                          <>
                            <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground whitespace-pre-wrap break-words max-w-full">
                              {turn.text}
                            </div>
                            <div className="flex items-center gap-1 transition-opacity opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                              <CopyTextButton text={turn.text} />
                              {onEditPrompt && !isStreaming && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingIndex(turn.sourceIndex)
                                    setEditDraft(turn.text)
                                  }}
                                  aria-label={t('chat.editPrompt')}
                                  title={t('chat.editPrompt')}
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span>{t('chat.editPrompt')}</span>
                                </button>
                              )}
                            </div>
                          </>
                        )
                      )}
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-0.5">
                      <User className="h-4 w-4" />
                    </div>
                  </div>
                )
              }

              const hasPrecedingUser = turns.slice(0, tIdx).some((m) => m.kind === 'user')
              const showProgressActive = Boolean(turn.isLive && !turn.text && approvals.length === 0)

              return (
                <div
                  key={`assistant-${turn.lastIndex ?? 'live'}-${tIdx}`}
                  className="group flex gap-3 justify-start"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="max-w-[85%] min-w-0 space-y-2 flex flex-col items-start flex-1">
                    {(turn.toolCalls.length > 0 || showProgressActive || Boolean(turn.thinking)) && (
                      <ToolTraceList
                        tools={turn.toolCalls}
                        active={showProgressActive}
                        thinking={turn.thinking}
                      />
                    )}
                    {turn.text && (
                      <>
                        <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-muted/50 text-foreground border border-border/60 w-full min-w-0 overflow-hidden break-words">
                          <ChatMarkdown content={turn.text} />
                        </div>
                        {!turn.isLive && turn.lastIndex !== null && (
                          <div className="flex items-center gap-1 transition-opacity opacity-75 hover:opacity-100">
                            <CopyTextButton text={turn.text} />
                            {hasPrecedingUser && onRegenerate && !isStreaming && (
                              <button
                                type="button"
                                onClick={() => void onRegenerate(turn.lastIndex!)}
                                aria-label={t('chat.regenerate')}
                                title={t('chat.regenerate')}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>{t('chat.regenerate')}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {approvals.map((apr) => (
              <ToolApprovalCard
                key={apr.toolUseId}
                approval={apr}
                onResolve={onResolveApproval}
              />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
