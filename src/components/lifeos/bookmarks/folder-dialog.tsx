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
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { useCreateBookmarkFolder, useUpdateBookmarkFolder } from '@/lib/api/hooks'
import type { BookmarkFolder } from '@/types'

interface FolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder?: BookmarkFolder | null
}

const FOLDER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#6b7280', // gray
]

export function FolderDialog({ open, onOpenChange, folder }: FolderDialogProps) {
  const { t } = useTranslation()
  const isEditing = Boolean(folder)

  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const createMutation = useCreateBookmarkFolder()
  const updateMutation = useUpdateBookmarkFolder()

  useEffect(() => {
    if (open) {
      if (folder) {
        setName(folder.name || '')
        setColor(folder.color || '#3b82f6')
      } else {
        setName('')
        setColor('#3b82f6')
      }
    }
  }, [open, folder])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      showToast.error('Folder name is required')
      return
    }

    setIsSubmitting(true)
    try {
      if (isEditing && folder) {
        await updateMutation.mutateAsync({
          id: folder.id,
          name: name.trim(),
          color,
        })
        showToast.success('Folder updated')
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          color,
          icon: 'folder',
        })
        showToast.success('Folder created')
      }
      onOpenChange(false)
    } catch (err) {
      showToast.error(
        err instanceof Error ? err.message : 'Failed to save folder'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="folder-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? t('bookmarks.editFolder') : t('bookmarks.newFolder')}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isEditing
                ? 'Rename or change the color of this bookmark folder.'
                : 'Create a new folder to organize your bookmarks.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t('bookmarks.folderName')} <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g. AI Tools, Reading, Dev, Design"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                data-testid="folder-name-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Folder Color
              </label>
              <div className="flex items-center gap-2 pt-1">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? 'white' : 'transparent',
                      outline: color === c ? `2px solid ${c}` : 'none',
                    }}
                  />
                ))}
              </div>
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
              data-testid="folder-submit-button"
            >
              {isSubmitting ? 'Saving...' : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
