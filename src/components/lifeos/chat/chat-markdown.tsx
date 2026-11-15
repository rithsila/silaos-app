'use client'

import { Children, isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

function extractCodeText(node: ReactNode): { code: string; lang: string } {
  const arr = Children.toArray(node)
  for (const child of arr) {
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const cls = child.props.className || ''
      const match = /language-([^\s]+)/.exec(cls)
      const raw = child.props.children
      const text = Array.isArray(raw) ? raw.join('') : typeof raw === 'string' ? raw : String(raw ?? '')
      return {
        code: text.replace(/\n$/, ''),
        lang: match?.[1] || '',
      }
    }
  }
  return { code: '', lang: '' }
}

function CodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const { code, lang } = extractCodeText(children)

  const handleCopy = async () => {
    if (!code) return
    try {
      await navigator.clipboard?.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard unavailable in restricted contexts
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/70 bg-background/80">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono uppercase tracking-wider">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
          aria-label={copied ? t('chat.copied') : t('chat.copyCode')}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono leading-relaxed">{children}</pre>
    </div>
  )
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed space-y-2 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children }) => {
            if (className?.includes('language-')) {
              return <code className={className}>{children}</code>
            }
            return (
              <code className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-xs border border-border/50">
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-md border border-border/60">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-muted/50 px-2.5 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-border/40 px-2.5 py-1.5">{children}</td>,
          hr: () => <hr className="border-border/60 my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
