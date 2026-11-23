export type { ModuleId } from '@/stores/app-store'

export type BookmarkImportance = 'low' | 'normal' | 'high'
export type BookmarkStatus = 'inbox' | 'filed' | 'archived'

export interface BookmarkTagItem {
  id: string
  name: string
  color: string
  createdAt?: string
  updatedAt?: string
}

export interface BookmarkTag {
  id: string
  bookmarkId: string
  tagId: string
  tag: BookmarkTagItem
}

export interface BookmarkFolderMini {
  id: string
  name: string
  icon?: string | null
  color?: string | null
}

export interface Bookmark {
  id: string
  url: string
  title: string
  description?: string | null
  favicon?: string | null
  userNote?: string | null
  importance: BookmarkImportance
  status: BookmarkStatus
  folderId?: string | null
  projectId?: string | null
  noteId?: string | null
  suggestedFolderId?: string | null
  suggestedImportance?: BookmarkImportance | null
  suggestionReason?: string | null
  createdAt: string
  updatedAt: string
  tags?: BookmarkTag[]
  folder?: BookmarkFolderMini | null
  project?: { id: string; name: string; color: string } | null
  note?: { id: string; title: string } | null
}

export interface BookmarkFolderCount {
  bookmarks: number
}

export interface BookmarkFolder {
  id: string
  name: string
  icon?: string | null
  color?: string | null
  order: number
  createdAt: string
  updatedAt: string
  _count?: BookmarkFolderCount
}
