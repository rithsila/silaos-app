'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Globe,
  ExternalLink,
  Edit3,
  Trash2,
  Check,
  X,
  Archive,
  Inbox,
  Folder as FolderIcon,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import type { Bookmark, BookmarkFolder } from '@/types'

interface BookmarkCardProps {
  bookmark: Bookmark
  folders: BookmarkFolder[]
  onEdit: (bookmark: Bookmark) => void
  onDelete: (id: string) => void
  onAcceptSuggestion: (bookmark: Bookmark) => void
  onDismissSuggestion: (bookmark: Bookmark) => void
}

function getDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return rawUrl
  }
}

export function BookmarkCard({
  bookmark,
  folders,
  onEdit,
  onDelete,
  onAcceptSuggestion,
  onDismissSuggestion,
}: BookmarkCardProps) {
  const { t } = useTranslation()
  const [imgError, setImgError] = useState(false)

  const domain = getDomain(bookmark.url)
  const faviconUrl =
    bookmark.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  const folder =
    folders.find((f) => f.id === bookmark.folderId) ||
    (bookmark.folder ? { id: bookmark.folder.id, name: bookmark.folder.name, color: bookmark.folder.color } : null)

  const suggestedFolder = bookmark.suggestedFolderId
    ? folders.find((f) => f.id === bookmark.suggestedFolderId)
    : null

  const importanceBadgeClasses: Record<string, string> = {
    high: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
    normal: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    low: 'border-muted-foreground/30 bg-muted/60 text-muted-foreground',
  }

  const importanceLabels: Record<string, string> = {
    high: t('bookmarks.importanceHigh'),
    normal: t('bookmarks.importanceNormal'),
    low: t('bookmarks.importanceLow'),
  }

  const noteSnippet = bookmark.userNote || bookmark.description

  const hasSuggestion = Boolean(
    bookmark.suggestedFolderId || bookmark.suggestedImportance
  )

  let suggestionText = ''
  if (suggestedFolder && bookmark.suggestedImportance) {
    suggestionText = `Move to "${suggestedFolder.name}" • ${importanceLabels[bookmark.suggestedImportance] || bookmark.suggestedImportance}`
  } else if (suggestedFolder) {
    suggestionText = `Move to "${suggestedFolder.name}"`
  } else if (bookmark.suggestedImportance) {
    suggestionText = `Set importance to ${importanceLabels[bookmark.suggestedImportance] || bookmark.suggestedImportance}`
  }

  return (
    <Card
      className="group relative flex flex-col justify-between border-border/60 hover:border-border transition-all hover:shadow-sm bg-card/60 backdrop-blur-sm"
      data-testid={`bookmark-card-${bookmark.id}`}
    >
      <CardContent className="p-4 flex-1 flex flex-col">
        {/* Top header: Favicon, domain, status & action buttons */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded-md bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden border border-border/40">
              {!imgError ? (
                <img
                  src={faviconUrl}
                  alt=""
                  className="h-4 w-4 object-contain"
                  onError={() => setImgError(true)}
                />
              ) : (
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
              {domain}
            </span>
          </div>

          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(bookmark)}
              title={t('edit')}
              data-testid={`bookmark-edit-${bookmark.id}`}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
              onClick={() => onDelete(bookmark.id)}
              title={t('delete')}
              data-testid={`bookmark-delete-${bookmark.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Title link */}
        <div className="mt-2.5">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm text-foreground hover:text-primary transition-colors line-clamp-2 inline-flex items-baseline gap-1"
            title={bookmark.title}
          >
            <span>{bookmark.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity translate-y-0.5" />
          </a>
        </div>

        {/* User Note / Description snippet */}
        {noteSnippet && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2 italic bg-muted/30 p-1.5 rounded border border-border/30">
            {noteSnippet}
          </p>
        )}

        {/* Tags */}
        {bookmark.tags && bookmark.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {bookmark.tags.map((bt) => (
              <span
                key={bt.id || bt.tagId}
                className="text-[10px] px-1.5 py-0.5 rounded-full border"
                style={{
                  backgroundColor: `${bt.tag.color}15`,
                  borderColor: `${bt.tag.color}40`,
                  color: bt.tag.color,
                }}
              >
                #{bt.tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Bottom meta badges: Importance, Folder, Status */}
        <div className="mt-auto pt-3 flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={`text-[10px] uppercase font-semibold px-1.5 py-0 ${
                importanceBadgeClasses[bookmark.importance] ||
                importanceBadgeClasses.normal
              }`}
            >
              {importanceLabels[bookmark.importance] || bookmark.importance}
            </Badge>

            {folder && (
              <Badge
                variant="outline"
                className="text-[11px] font-normal gap-1 bg-accent/30 text-foreground border-border/60"
              >
                <FolderIcon
                  className="h-3 w-3"
                  style={{ color: folder.color || undefined }}
                />
                <span className="truncate max-w-[100px]">{folder.name}</span>
              </Badge>
            )}
          </div>

          {bookmark.status === 'archived' && (
            <Badge
              variant="secondary"
              className="text-[10px] gap-1 px-1.5 py-0 text-muted-foreground"
            >
              <Archive className="h-3 w-3" />
              <span>{t('bookmarks.statusArchived')}</span>
            </Badge>
          )}
          {bookmark.status === 'inbox' && (
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5">
              <Inbox className="h-3 w-3" />
              <span>{t('bookmarks.statusInbox')}</span>
            </span>
          )}
        </div>

        {/* Norma AI Suggestion Banner */}
        {hasSuggestion && (
          <div
            className="mt-3 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 text-xs flex items-center justify-between gap-2"
            data-testid="norma-suggestion-banner"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 text-sm">💡</span>
              <div className="min-w-0">
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {t('bookmarks.normaSuggestion')}:{' '}
                </span>
                <span className="text-muted-foreground truncate block text-[11px]">
                  {suggestionText}
                </span>
                {bookmark.suggestionReason && (
                  <span className="text-[10px] text-muted-foreground/80 block italic truncate">
                    Reason: {bookmark.suggestionReason}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 font-medium"
                onClick={() => onAcceptSuggestion(bookmark)}
                title={t('bookmarks.acceptSuggestion')}
                data-testid={`accept-suggestion-${bookmark.id}`}
              >
                <Check className="h-3.5 w-3.5 mr-0.5" />
                {t('bookmarks.acceptSuggestion')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted"
                onClick={() => onDismissSuggestion(bookmark)}
                title={t('bookmarks.dismissSuggestion')}
                data-testid={`dismiss-suggestion-${bookmark.id}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
