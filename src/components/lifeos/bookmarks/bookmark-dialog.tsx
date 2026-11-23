'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { useCreateBookmark, useUpdateBookmark } from '@/lib/api/hooks'
import type { Bookmark, BookmarkFolder, BookmarkImportance, BookmarkStatus } from '@/types'

interface BookmarkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookmark?: Bookmark | null
  folders: BookmarkFolder[]
  defaultFolderId?: string | null
  initialValues?: {
    url?: string
    title?: string
    userNote?: string
  }
}

export function BookmarkDialog({
  open,
  onOpenChange,
  bookmark,
  folders,
  defaultFolderId,
  initialValues,
}: BookmarkDialogProps) {
  const { t } = useTranslation()
  const isEditing = Boolean(bookmark)

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [userNote, setUserNote] = useState('')
  const [folderId, setFolderId] = useState<string>('none')
  const [importance, setImportance] = useState<BookmarkImportance>('normal')
  const [status, setStatus] = useState<BookmarkStatus>('inbox')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const createMutation = useCreateBookmark()
  const updateMutation = useUpdateBookmark()

  useEffect(() => {
    if (open) {
      if (bookmark) {
        setUrl(bookmark.url || '')
        setTitle(bookmark.title || '')
        setUserNote(bookmark.userNote || bookmark.description || '')
        setFolderId(bookmark.folderId || 'none')
        setImportance(bookmark.importance || 'normal')
        setStatus(bookmark.status || 'inbox')
      } else {
        setUrl(initialValues?.url || '')
        setTitle(initialValues?.title || '')
        setUserNote(initialValues?.userNote || '')
        setFolderId(defaultFolderId || 'none')
        setImportance('normal')
        setStatus('inbox')
      }
    }
  }, [open, bookmark, defaultFolderId, initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      showToast.error('URL is required')
      return
    }
    if (!title.trim()) {
      showToast.error('Title is required')
      return
    }

    // Basic URL validation
    let validUrl = url.trim()
    if (!/^https?:\/\//i.test(validUrl)) {
      validUrl = `https://${validUrl}`
    }

    setIsSubmitting(true)
    const folderIdValue = folderId === 'none' ? null : folderId

    try {
      if (isEditing && bookmark) {
        await updateMutation.mutateAsync({
          id: bookmark.id,
          url: validUrl,
          title: title.trim(),
          userNote: userNote.trim() || null,
          description: userNote.trim() || null,
          folderId: folderIdValue,
          importance,
          status,
        })
        showToast.success('Bookmark updated')
      } else {
        await createMutation.mutateAsync({
          url: validUrl,
          title: title.trim(),
          userNote: userNote.trim() || null,
          description: userNote.trim() || null,
          folderId: folderIdValue,
          importance,
          status,
        })
        showToast.success('Bookmark saved')
      }
      onOpenChange(false)
    } catch (err) {
      showToast.error(
        err instanceof Error ? err.message : 'Failed to save bookmark'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="bookmark-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? t('bookmarks.editBookmark') : t('bookmarks.addBookmark')}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isEditing
                ? 'Update bookmark information and categorization.'
                : 'Save a link to your library with notes and priority.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* URL */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t('bookmarks.url')} <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder={t('bookmarks.urlPlaceholder')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                data-testid="bookmark-url-input"
              />
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t('bookmarks.bookmarkTitle')} <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder={t('bookmarks.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                data-testid="bookmark-title-input"
              />
            </div>

            {/* Folder & Importance row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {t('bookmarks.folders')}
                </label>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger data-testid="bookmark-folder-select">
                    <SelectValue placeholder={t('bookmarks.selectFolder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('bookmarks.noFolder')}</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        📁 {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {t('bookmarks.importance')}
                </label>
                <Select
                  value={importance}
                  onValueChange={(v) => setImportance(v as BookmarkImportance)}
                >
                  <SelectTrigger data-testid="bookmark-importance-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">
                      ⚪ {t('bookmarks.importanceLow')}
                    </SelectItem>
                    <SelectItem value="normal">
                      🟡 {t('bookmarks.importanceNormal')}
                    </SelectItem>
                    <SelectItem value="high">
                      🔴 {t('bookmarks.importanceHigh')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t('bookmarks.status')}
              </label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as BookmarkStatus)}
              >
                <SelectTrigger data-testid="bookmark-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbox">📥 {t('bookmarks.statusInbox')}</SelectItem>
                  <SelectItem value="filed">📁 {t('bookmarks.statusFiled')}</SelectItem>
                  <SelectItem value="archived">📦 {t('bookmarks.statusArchived')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description / User note */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t('bookmarks.description')}
              </label>
              <Textarea
                placeholder={t('bookmarks.descriptionPlaceholder')}
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                rows={3}
                data-testid="bookmark-note-input"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="bookmark-submit-button"
            >
              {isSubmitting ? 'Saving...' : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
