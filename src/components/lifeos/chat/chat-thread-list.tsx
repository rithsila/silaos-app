'use client'

import { Plus, MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import type { ChatSessionSummary } from '@/lib/api/chat'

interface ChatThreadListProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function ChatThreadList({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
}: ChatThreadListProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full border-r border-border bg-muted/10">
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('chat.threads')}
        </span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={onNew}>
          <Plus className="h-3.5 w-3.5" />
          {t('chat.newChat')}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('chat.emptyThreads')}
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => {
              const active = s.id === activeSessionId
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs">{s.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.deleteThread')}
                    onClick={() => onDelete(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
