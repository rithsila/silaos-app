'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Bookmark,
  Plus,
  Search,
  FolderPlus,
  Folder as FolderIcon,
  FolderOpen,
  SlidersHorizontal,
  BookmarkCheck,
  Inbox,
  AlertCircle,
  Archive,
  MoreVertical,
  Trash2,
  Edit,
  Sparkles,
  Link as LinkIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import {
  useBookmarks,
  useBookmarkFolders,
  useDeleteBookmark,
  useUpdateBookmark,
  useDeleteBookmarkFolder,
} from '@/lib/api/hooks'
import { BookmarkCard } from './bookmark-card'
import { BookmarkDialog } from './bookmark-dialog'
import { FolderDialog } from './folder-dialog'
import { BookmarkletModal } from './bookmarklet-modal'
import type { Bookmark as BookmarkType, BookmarkFolder } from '@/types'

type FilterTab = 'all' | 'inbox' | 'high' | 'archived'

export function BookmarksView() {
  const { t } = useTranslation()

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  // Modals
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [editingBookmark, setEditingBookmark] = useState<BookmarkType | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<BookmarkFolder | null>(null)
  const [bookmarkletModalOpen, setBookmarkletModalOpen] = useState(false)

  // Delete confirmations
  const [deletingBookmarkId, setDeletingBookmarkId] = useState<string | null>(null)
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)

  // URL quick-bookmark params detection
  const [initialPrefill, setInitialPrefill] = useState<{
    url?: string
    title?: string
    userNote?: string
  }>({})

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const quickBookmark = params.get('quickBookmark')
      const paramUrl = params.get('url')
      const paramTitle = params.get('title')
      const paramNote = params.get('note')

      if (quickBookmark === '1' || paramUrl) {
        setInitialPrefill({
          url: paramUrl || '',
          title: paramTitle || '',
          userNote: paramNote || '',
        })
        setBookmarkDialogOpen(true)
      }
    }
  }, [])

  // Data fetching
  const { data: bookmarks = [], isLoading: isLoadingBookmarks } = useBookmarks()
  const { data: folders = [], isLoading: isLoadingFolders } = useBookmarkFolders()

  // Mutations
  const updateBookmarkMutation = useUpdateBookmark()
  const deleteBookmarkMutation = useDeleteBookmark()
  const deleteFolderMutation = useDeleteBookmarkFolder()

  // Folder counts mapping
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const b of bookmarks) {
      if (b.folderId) {
        counts[b.folderId] = (counts[b.folderId] || 0) + 1
      }
    }
    return counts
  }, [bookmarks])

  // Filtered bookmarks
  const filteredBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      // 1. Folder filter
      if (selectedFolderId && b.folderId !== selectedFolderId) {
        return false
      }

      // 2. Tab filter
      if (activeTab === 'inbox' && b.status !== 'inbox') {
        return false
      }
      if (activeTab === 'high' && b.importance !== 'high') {
        return false
      }
      if (activeTab === 'archived' && b.status !== 'archived') {
        return false
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const matchesTitle = b.title.toLowerCase().includes(query)
        const matchesUrl = b.url.toLowerCase().includes(query)
        const matchesNote =
          (b.userNote && b.userNote.toLowerCase().includes(query)) ||
          (b.description && b.description.toLowerCase().includes(query))
        const matchesTags = b.tags?.some((t) =>
          t.tag.name.toLowerCase().includes(query)
        )
        if (!matchesTitle && !matchesUrl && !matchesNote && !matchesTags) {
          return false
        }
      }

      return true
    })
  }, [bookmarks, selectedFolderId, activeTab, searchQuery])

  // Handlers
  const handleEditBookmark = (bookmark: BookmarkType) => {
    setEditingBookmark(bookmark)
    setBookmarkDialogOpen(true)
  }

  const handleDeleteBookmarkConfirm = async () => {
    if (!deletingBookmarkId) return
    try {
      await deleteBookmarkMutation.mutateAsync(deletingBookmarkId)
      showToast.success('Bookmark deleted')
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to delete bookmark')
    } finally {
      setDeletingBookmarkId(null)
    }
  }

  const handleDeleteFolderConfirm = async () => {
    if (!deletingFolderId) return
    try {
      await deleteFolderMutation.mutateAsync(deletingFolderId)
      if (selectedFolderId === deletingFolderId) {
        setSelectedFolderId(null)
      }
      showToast.success('Folder deleted')
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to delete folder')
    } finally {
      setDeletingFolderId(null)
    }
  }

  const handleAcceptSuggestion = async (bookmark: BookmarkType) => {
    try {
      await updateBookmarkMutation.mutateAsync({
        id: bookmark.id,
        folderId: bookmark.suggestedFolderId || bookmark.folderId,
        importance: bookmark.suggestedImportance || bookmark.importance,
        suggestedFolderId: null,
        suggestedImportance: null,
        suggestionReason: null,
      })
      showToast.success('Norma suggestion applied!')
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to apply suggestion')
    }
  }

  const handleDismissSuggestion = async (bookmark: BookmarkType) => {
    try {
      await updateBookmarkMutation.mutateAsync({
        id: bookmark.id,
        suggestedFolderId: null,
        suggestedImportance: null,
        suggestionReason: null,
      })
      showToast.info('Suggestion dismissed')
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to dismiss suggestion')
    }
  }

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden" data-testid="bookmarks-view">
      {/* Top Header Bar */}
      <div className="border-b border-border/60 bg-background/95 backdrop-blur px-6 py-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Bookmark className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              {t('bookmarks.title')}
              <Badge variant="secondary" className="text-xs font-normal">
                {bookmarks.length}
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              {t('bookmarks.noBookmarksDesc')}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBookmarkletModalOpen(true)}
            className="text-xs h-9 gap-1.5"
            data-testid="install-bookmarklet-button"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>{t('bookmarks.installBookmarklet')}</span>
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setEditingBookmark(null)
              setInitialPrefill({})
              setBookmarkDialogOpen(true)
            }}
            className="text-xs h-9 gap-1.5"
            data-testid="add-bookmark-button"
          >
            <Plus className="h-4 w-4" />
            <span>{t('bookmarks.addBookmark')}</span>
          </Button>
        </div>
      </div>

      {/* Controls bar: Search, Status Filters, & Horizontal Folder Pills */}
      <div className="border-b border-border/60 bg-background/50 flex flex-col gap-3 p-4 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t('bookmarks.searchBookmarks')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs bg-card"
              data-testid="bookmarks-search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg shrink-0 overflow-x-auto">
            <Button
              variant={activeTab === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('all')}
              className="text-xs h-7 px-2.5"
              data-testid="filter-tab-all"
            >
              {t('bookmarks.allBookmarks')}
            </Button>
            <Button
              variant={activeTab === 'inbox' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('inbox')}
              className="text-xs h-7 px-2.5 gap-1"
              data-testid="filter-tab-inbox"
            >
              <Inbox className="h-3 w-3" />
              <span>{t('bookmarks.inbox')}</span>
            </Button>
            <Button
              variant={activeTab === 'high' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('high')}
              className="text-xs h-7 px-2.5 gap-1 text-red-600 dark:text-red-400"
              data-testid="filter-tab-high"
            >
              <AlertCircle className="h-3 w-3" />
              <span>{t('bookmarks.highImportance')}</span>
            </Button>
            <Button
              variant={activeTab === 'archived' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('archived')}
              className="text-xs h-7 px-2.5 gap-1"
              data-testid="filter-tab-archived"
            >
              <Archive className="h-3 w-3" />
              <span>{t('bookmarks.archived')}</span>
            </Button>
          </div>
        </div>

        {/* Horizontal Folder Pills Row */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
          <Button
            variant={selectedFolderId === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedFolderId(null)}
            className="h-7 text-xs rounded-full px-3 gap-1.5 shrink-0"
            data-testid="folder-tab-all"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{t('bookmarks.allBookmarks')}</span>
            <span className="text-[10px] ml-0.5 opacity-75 font-mono">({bookmarks.length})</span>
          </Button>

          {isLoadingFolders ? (
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          ) : (
            folders.map((f) => {
              const isSelected = selectedFolderId === f.id
              const count = folderCounts[f.id] || f._count?.bookmarks || 0

              return (
                <div key={f.id} className="relative group inline-flex items-center shrink-0">
                  <Button
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedFolderId(f.id)}
                    className="h-7 text-xs rounded-full pl-3 pr-2 gap-1.5"
                    data-testid={`folder-item-${f.id}`}
                  >
                    <FolderIcon
                      className="h-3.5 w-3.5"
                      style={{ color: isSelected ? 'currentColor' : f.color || undefined }}
                    />
                    <span>{f.name}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      >
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="text-xs">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingFolder(f)
                          setFolderDialogOpen(true)
                        }}
                        className="gap-2"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        <span>{t('edit')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeletingFolderId(f.id)}
                        className="gap-2 text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{t('delete')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingFolder(null)
              setFolderDialogOpen(true)
            }}
            className="h-7 text-xs rounded-full px-2.5 gap-1 text-muted-foreground hover:text-foreground border border-dashed border-border shrink-0"
            data-testid="add-folder-button"
          >
            <Plus className="h-3 w-3" />
            <span>{t('bookmarks.addFolder')}</span>
          </Button>
        </div>
      </div>

      {/* Main Full-Width Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Cards Grid Area */}
        <ScrollArea className="flex-1 p-6">
            {isLoadingBookmarks ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-36 rounded-xl" />
                ))}
              </div>
            ) : filteredBookmarks.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-16 text-center max-w-sm mx-auto"
                data-testid="bookmarks-empty-state"
              >
                <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
                  <Bookmark className="h-6 w-6 opacity-60" />
                </div>
                <h3 className="font-semibold text-base text-foreground">
                  {searchQuery || selectedFolderId || activeTab !== 'all'
                    ? 'No matching bookmarks'
                    : t('bookmarks.noBookmarks')}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  {searchQuery || selectedFolderId || activeTab !== 'all'
                    ? 'Try adjusting your search query or active filters.'
                    : t('bookmarks.noBookmarksDesc')}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingBookmark(null)
                    setInitialPrefill({})
                    setBookmarkDialogOpen(true)
                  }}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="h-4 w-4" />
                  <span>{t('bookmarks.addBookmark')}</span>
                </Button>
              </div>
            ) : (
              <div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                data-testid="bookmarks-grid"
              >
                {filteredBookmarks.map((bookmark) => (
                  <BookmarkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    folders={folders}
                    onEdit={handleEditBookmark}
                    onDelete={(id) => setDeletingBookmarkId(id)}
                    onAcceptSuggestion={handleAcceptSuggestion}
                    onDismissSuggestion={handleDismissSuggestion}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

      {/* Dialogs */}
      <BookmarkDialog
        open={bookmarkDialogOpen}
        onOpenChange={setBookmarkDialogOpen}
        bookmark={editingBookmark}
        folders={folders}
        defaultFolderId={selectedFolderId}
        initialValues={initialPrefill}
      />

      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        folder={editingFolder}
      />

      <BookmarkletModal
        open={bookmarkletModalOpen}
        onOpenChange={setBookmarkletModalOpen}
      />

      {/* Bookmark Delete Confirmation */}
      <AlertDialog
        open={Boolean(deletingBookmarkId)}
        onOpenChange={(open) => !open && setDeletingBookmarkId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bookmarks.deleteBookmark')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bookmarks.deleteBookmarkConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBookmarkConfirm}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="confirm-delete-bookmark-button"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Folder Delete Confirmation */}
      <AlertDialog
        open={Boolean(deletingFolderId)}
        onOpenChange={(open) => !open && setDeletingFolderId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bookmarks.deleteFolder')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bookmarks.deleteFolderConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolderConfirm}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="confirm-delete-folder-button"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
