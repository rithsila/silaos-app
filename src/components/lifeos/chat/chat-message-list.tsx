'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, ChevronRight, Copy, Pencil, RotateCcw, Sparkles, User, Wrench } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import type { ChatMessage, ChatToolTrace } from '@/lib/api/chat'
import { ChatMarkdown } from './chat-markdown'
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

function ToolTraceList({ tools }: { tools: ChatToolTrace[] }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  if (tools.length === 0) return null

  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground w-full text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Wrench className="h-3 w-3" />
        <span>
          {t('chat.toolCall')} ({tools.length})
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          {tools.map((tl) => (
            <div key={tl.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Badge variant={tl.isError ? 'destructive' : 'secondary'} className="font-mono text-[10px]">
                  {tl.name || tl.id}
                </Badge>
              </div>
              {tl.input && (
                <pre className="max-h-24 overflow-auto rounded bg-background/70 p-1.5 text-[10px] font-mono">
                  {tl.input}
                </pre>
              )}
              {tl.result && (
                <pre className="max-h-28 overflow-auto rounded bg-background/70 p-1.5 text-[10px] font-mono text-muted-foreground">
                  {tl.result}
                </pre>
              )}
            </div>
          ))}
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
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user'
              const isEditing = isUser && editingIndex === idx
              const hasPrecedingUser = !isUser && messages.slice(0, idx).some((m) => m.role === 'user')
              return (
                <div
                  key={`${msg.role}-${idx}`}
                  className={cn('group flex gap-3', isUser ? 'justify-end' : 'justify-start')}
                >
                  {!isUser && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] space-y-1.5 flex flex-col',
                      isUser ? 'items-end' : 'items-start',
                      isEditing && 'w-full max-w-[85%]',
                    )}
                  >
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolTraceList tools={msg.toolCalls} />
                    )}
                    {isEditing ? (
                      <div className="w-full space-y-2 rounded-xl border border-border bg-muted/40 p-2.5">
                        <Textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void submitEdit(idx)
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
                            onClick={() => void submitEdit(idx)}
                          >
                            {t('chat.saveAndSend')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      msg.text && (
                        <>
                          <div
                            className={cn(
                              'rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                              isUser
                                ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
                                : 'bg-muted/50 text-foreground border border-border/60 w-full',
                            )}
                          >
                            {isUser ? msg.text : <ChatMarkdown content={msg.text} />}
                          </div>
                          <div
                            className={cn(
                              'flex items-center gap-1 transition-opacity',
                              isUser
                                ? 'opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100'
                                : 'opacity-75 hover:opacity-100',
                            )}
                          >
                            <CopyTextButton text={msg.text} />
                            {isUser && onEditPrompt && !isStreaming && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingIndex(idx)
                                  setEditDraft(msg.text)
                                }}
                                aria-label={t('chat.editPrompt')}
                                title={t('chat.editPrompt')}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span>{t('chat.editPrompt')}</span>
                              </button>
                            )}
                            {!isUser && hasPrecedingUser && onRegenerate && !isStreaming && (
                              <button
                                type="button"
                                onClick={() => void onRegenerate(idx)}
                                aria-label={t('chat.regenerate')}
                                title={t('chat.regenerate')}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>{t('chat.regenerate')}</span>
                              </button>
                            )}
                          </div>
                        </>
                      )
                    )}
                  </div>
                  {isUser && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-0.5">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              )
            })}

            {(isStreaming || streamingText || streamingThinking || streamingTools.length > 0) && (
              <div className="flex gap-3 justify-start">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="max-w-[85%] space-y-2 flex-1">
                  {streamingThinking && (
                    <details className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none">{t('chat.thinking')}</summary>
                      <p className="mt-1.5 whitespace-pre-wrap">{streamingThinking}</p>
                    </details>
                  )}
                  {streamingTools.length > 0 && <ToolTraceList tools={streamingTools} />}
                  {streamingText ? (
                    <div className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-muted/50 text-foreground border border-border/60">
                      <ChatMarkdown content={streamingText} />
                    </div>
                  ) : (
                    isStreaming && (
                      <div className="rounded-xl px-3.5 py-2.5 text-xs text-muted-foreground bg-muted/30 border border-border/40 inline-block animate-pulse">
                        {t('chat.thinking')}...
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

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
