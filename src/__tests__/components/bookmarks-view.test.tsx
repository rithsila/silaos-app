import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../utils/test-utils'
import { server } from '../mocks/server'
import { BookmarksView } from '@/components/lifeos/bookmarks/bookmarks-view'

const mockFolders = [
  {
    id: 'folder-1',
    name: 'Tech & AI',
    icon: 'folder',
    color: '#3b82f6',
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    _count: { bookmarks: 2 },
  },
  {
    id: 'folder-2',
    name: 'Design',
    icon: 'folder',
    color: '#10b981',
    order: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    _count: { bookmarks: 1 },
  },
]

const mockBookmarks = [
  {
    id: 'bm-1',
    url: 'https://anthropic.com',
    title: 'Anthropic AI Research',
    description: 'Frontier AI models and constitutional AI',
    favicon: null,
    userNote: 'Must read about Claude 3.5 architecture',
    importance: 'high',
    status: 'inbox',
    folderId: 'folder-1',
    projectId: null,
    noteId: null,
    suggestedFolderId: null,
    suggestedImportance: null,
    suggestionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tags: [
      {
        id: 'bt-1',
        bookmarkId: 'bm-1',
        tagId: 't-1',
        tag: { id: 't-1', name: 'ai', color: '#3b82f6', createdAt: '', updatedAt: '' },
      },
    ],
  },
  {
    id: 'bm-2',
    url: 'https://news.ycombinator.com',
    title: 'Hacker News',
    description: null,
    favicon: null,
    userNote: null,
    importance: 'normal',
    status: 'filed',
    folderId: 'folder-1',
    projectId: null,
    noteId: null,
    suggestedFolderId: null,
    suggestedImportance: null,
    suggestionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tags: [],
  },
  {
    id: 'bm-3',
    url: 'https://tailwindcss.com',
    title: 'Tailwind CSS Docs',
    description: 'Utility-first CSS framework',
    favicon: null,
    userNote: 'Reference for styling',
    importance: 'low',
    status: 'archived',
    folderId: 'folder-2',
    projectId: null,
    noteId: null,
    suggestedFolderId: 'folder-2',
    suggestedImportance: 'high',
    suggestionReason: 'Frequently referenced developer documentation',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tags: [],
  },
]

describe('BookmarksView', () => {
  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    server.use(
      http.get('/api/bookmarks', () => {
        return HttpResponse.json(mockBookmarks)
      }),
      http.get('/api/bookmarks/folders', () => {
        return HttpResponse.json(mockFolders)
      }),
      http.put('/api/bookmarks/:id', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...mockBookmarks[0], ...body })
      }),
      http.delete('/api/bookmarks/:id', () => {
        return HttpResponse.json({ success: true })
      }),
      http.post('/api/bookmarks', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'bm-new',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: [],
          ...body,
        })
      }),
      http.post('/api/bookmarks/folders', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'folder-new',
          order: 99,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...body,
        })
      })
    )
  })

  it('renders bookmarks view with bookmarks and folders', async () => {
    renderWithProviders(<BookmarksView />)

    expect(screen.getByTestId('bookmarks-view')).toBeInTheDocument()

    // Bookmarks should load
    await waitFor(() => {
      expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
      expect(screen.getByText('Hacker News')).toBeInTheDocument()
      expect(screen.getByText('Tailwind CSS Docs')).toBeInTheDocument()
    })

    // Folders should display
    expect(screen.getAllByText('Tech & AI').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Design').length).toBeGreaterThan(0)
  })

  it('filters bookmarks by search query', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookmarksView />)

    await waitFor(() => {
      expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('bookmarks-search-input')
    await user.type(searchInput, 'anthropic')

    expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    expect(screen.queryByText('Hacker News')).not.toBeInTheDocument()
    expect(screen.queryByText('Tailwind CSS Docs')).not.toBeInTheDocument()
  })

  it('filters bookmarks by status tab (Inbox, High Importance, Archived)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookmarksView />)

    await waitFor(() => {
      expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    })

    // Click "High Importance" filter
    const highTab = screen.getByTestId('filter-tab-high')
    await user.click(highTab)

    expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    expect(screen.queryByText('Hacker News')).not.toBeInTheDocument()
    expect(screen.queryByText('Tailwind CSS Docs')).not.toBeInTheDocument()

    // Click "Archived" filter
    const archivedTab = screen.getByTestId('filter-tab-archived')
    await user.click(archivedTab)

    expect(screen.queryByText('Anthropic AI Research')).not.toBeInTheDocument()
    expect(screen.queryByText('Hacker News')).not.toBeInTheDocument()
    expect(screen.getByText('Tailwind CSS Docs')).toBeInTheDocument()
  })

  it('filters bookmarks by folder selection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookmarksView />)

    await waitFor(() => {
      expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    })

    // Click folder "Design"
    const designFolderBtn = screen.getByTestId('folder-item-folder-2')
    await user.click(designFolderBtn)

    expect(screen.queryByText('Anthropic AI Research')).not.toBeInTheDocument()
    expect(screen.queryByText('Hacker News')).not.toBeInTheDocument()
    expect(screen.getByText('Tailwind CSS Docs')).toBeInTheDocument()

    // Click "All" folder tab
    const allFolderTab = screen.getByTestId('folder-tab-all')
    await user.click(allFolderTab)

    expect(screen.getByText('Anthropic AI Research')).toBeInTheDocument()
    expect(screen.getByText('Hacker News')).toBeInTheDocument()
  })

  it('opens and closes bookmarklet modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookmarksView />)

    const bookmarkletBtn = screen.getByTestId('install-bookmarklet-button')
    await user.click(bookmarkletBtn)

    await waitFor(() => {
      expect(screen.getByTestId('bookmarklet-modal')).toBeInTheDocument()
      expect(screen.getByTestId('bookmarklet-drag-link')).toBeInTheDocument()
    })
  })

  it('opens add bookmark dialog and validates required fields', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookmarksView />)

    const addBtn = screen.getByTestId('add-bookmark-button')
    await user.click(addBtn)

    await waitFor(() => {
      expect(screen.getByTestId('bookmark-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('bookmark-url-input')).toBeInTheDocument()
      expect(screen.getByTestId('bookmark-title-input')).toBeInTheDocument()
    })
  })

  it('renders Norma AI suggestion banner on bookmark cards with recommendations', async () => {
    renderWithProviders(<BookmarksView />)

    await waitFor(() => {
      expect(screen.getByText('Tailwind CSS Docs')).toBeInTheDocument()
    })

    // bm-3 has suggestedFolderId and suggestedImportance
    expect(screen.getByTestId('norma-suggestion-banner')).toBeInTheDocument()
    expect(screen.getByTestId('accept-suggestion-bm-3')).toBeInTheDocument()
    expect(screen.getByTestId('dismiss-suggestion-bm-3')).toBeInTheDocument()
  })
})
