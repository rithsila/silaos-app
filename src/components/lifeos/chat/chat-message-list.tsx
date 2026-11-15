'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Sparkles, User, Wrench } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import type { ChatMessage, ChatToolTrace } from '@/lib/api/chat'
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
}: ChatMessageListProps) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

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
    <ScrollArea className="flex-1 px-4 py-6">
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
              return (
                <div
                  key={`${msg.role}-${idx}`}
                  className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}
                >
                  {!isUser && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] space-y-2',
                      isUser ? 'items-end' : 'items-start',
                    )}
                  >
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolTraceList tools={msg.toolCalls} />
                    )}
                    {msg.text && (
                      <div
                        className={cn(
                          'rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed',
                          isUser
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted/50 text-foreground border border-border/60',
                        )}
                      >
                        {msg.text}
                      </div>
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
                    <div className="rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed bg-muted/50 text-foreground border border-border/60">
                      {streamingText}
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
