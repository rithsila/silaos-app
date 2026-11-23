'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Bookmark, Copy, Check, HelpCircle } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'

interface BookmarkletModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookmarkletModal({ open, onOpenChange }: BookmarkletModalProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('http://localhost:3000')
  const dragLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      setOrigin(window.location.origin)
    }
  }, [])

  const bookmarkletCode = `javascript:(function(){var u=encodeURIComponent(location.href);var t=encodeURIComponent(document.title);var s=encodeURIComponent(window.getSelection?window.getSelection().toString():'');window.open('${origin}/?quickBookmark=1&url='+u+'&title='+t+'&note='+s,'LifeOSBookmark','width=560,height=620,status=no,toolbar=no');})();`

  // Set href directly on DOM element to bypass React's javascript: URL protection
  useEffect(() => {
    if (dragLinkRef.current) {
      dragLinkRef.current.setAttribute('href', bookmarkletCode)
    }
  }, [bookmarkletCode, open])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode)
      setCopied(true)
      showToast.success('Bookmarklet code copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast.error('Failed to copy code')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="bookmarklet-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Bookmark className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{t('bookmarks.bookmarkletTitle')}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {t('bookmarks.bookmarkletDesc')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Draggable button */}
          <div className="p-6 rounded-xl border-2 border-dashed border-border/80 bg-accent/20 flex flex-col items-center justify-center text-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t('bookmarks.bookmarkletInstructions')}
            </span>

            <a
              ref={dragLinkRef}
              onClick={(e) => {
                // If clicked rather than dragged, show tip
                e.preventDefault()
                showToast.info('Drag this button to your browser bookmarks bar!')
              }}
              draggable="true"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm shadow-sm transition-all hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing select-none"
              title="Drag me to your bookmarks bar"
              data-testid="bookmarklet-drag-link"
            >
              <Bookmark className="h-4 w-4" />
              <span>{t('bookmarks.bookmarkletButton')}</span>
            </a>
            <span className="text-[11px] text-muted-foreground/75">
              Tip: Press <kbd className="px-1.5 py-0.5 text-[10px] rounded border bg-muted">Ctrl+Shift+B</kbd> or{' '}
              <kbd className="px-1.5 py-0.5 text-[10px] rounded border bg-muted">Cmd+Shift+B</kbd> to reveal the bookmarks bar.
            </span>
          </div>

          {/* How to use */}
          <div className="rounded-lg bg-muted/40 p-3 space-y-2 text-xs">
            <div className="font-semibold flex items-center gap-1.5 text-foreground">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              <span>How it works</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Drag the green button onto your browser&apos;s bookmarks bar.</li>
              <li>When browsing any article, press the bookmarklet in your toolbar.</li>
              <li>Life OS will open with the URL, title, and selected text pre-filled.</li>
            </ol>
          </div>

          {/* Copy script fallback */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Prefer manual bookmark creation?
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5 text-xs h-8"
              data-testid="bookmarklet-copy-button"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy JavaScript'}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

