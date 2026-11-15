'use client'

import { useState } from 'react'
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import type { ChatSessionSummary } from '@/lib/api/chat'

interface ChatThreadListProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename?: (id: string, title: string) => void | Promise<void>
  onDelete: (id: string) => void
}

export function ChatThreadList({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ChatThreadListProps) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const startRename = (s: ChatSessionSummary) => {
    setEditingId(s.id)
    setDraftTitle(s.title)
  }

  const submitRename = async (s: ChatSessionSummary) => {
    const trimmed = draftTitle.trim()
    setEditingId(null)
    if (!trimmed || trimmed === s.title || !onRename) return
    await onRename(s.id, trimmed)
  }

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-border bg-muted/10">
      <div className="p-3 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('chat.threads')}
        </span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={onNew}>
          <Plus className="h-3.5 w-3.5" />
          {t('chat.newChat')}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 p-2 [&_[data-slot=scroll-area-viewport]>div]:!block">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('chat.emptyThreads')}
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => {
              const active = s.id === activeSessionId
              const isEditing = editingId === s.id
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void submitRename(s)
                      }}
                      className="flex items-center gap-1 flex-1 min-w-0"
                    >
                      <Input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditingId(null)
                          }
                        }}
                        autoFocus
                        className="h-6 px-1.5 text-xs"
                        aria-label={t('chat.renameThread')}
                      />
                      <button
                        type="submit"
                        aria-label={t('chat.saveAndSend')}
                        className="p-1 rounded hover:bg-accent text-foreground"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('chat.cancel')}
                        onClick={() => setEditingId(null)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelect(s.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-xs">{s.title}</span>
                      </button>
                      {onRename && (
                        <button
                          type="button"
                          aria-label={t('chat.renameThread')}
                          onClick={() => startRename(s)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-accent hover:text-foreground transition-opacity"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={t('chat.deleteThread')}
                        onClick={() => onDelete(s.id)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
