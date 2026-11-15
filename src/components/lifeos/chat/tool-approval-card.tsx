'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/i18n'
import type { ChatApprovalRequest } from '@/lib/api/chat'
import { formatToolLabel, parseToolPayload } from './tool-format'

export interface PendingApproval extends ChatApprovalRequest {
  status: 'pending' | 'approved' | 'denied'
  submitting?: boolean
}

interface ToolApprovalCardProps {
  approval: PendingApproval
  onResolve: (toolUseId: string, allow: boolean) => void
}

export function ToolApprovalCard({ approval, onResolve }: ToolApprovalCardProps) {
  const { t } = useTranslation()
  const [showRaw, setShowRaw] = useState(false)
  const label = formatToolLabel(approval.toolName, approval.input)
  const { fields, raw } = parseToolPayload(approval.input)

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{t('chat.approvalTitle')}</span>
        </div>
        <Badge variant="secondary" className="text-[11px] font-medium">
          {label}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{t('chat.approvalHint')}</p>

      {fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs">
          {fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-muted-foreground font-medium">{field.label}</dt>
              <dd className="text-foreground break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 text-[11px] font-mono text-foreground">
          {raw}
        </pre>
      )}

      {fields.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span>{t('chat.details')}</span>
          </button>
          {showRaw && (
            <div className="mt-1.5 space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground">{approval.toolName}</div>
              <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 text-[11px] font-mono text-foreground">
                {raw}
              </pre>
            </div>
          )}
        </div>
      )}

      {approval.status === 'pending' ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => onResolve(approval.toolUseId, true)}
            disabled={approval.submitting}
            className="h-7 px-3 text-xs gap-1"
          >
            <Check className="h-3.5 w-3.5" />
            {t('chat.approve')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onResolve(approval.toolUseId, false)}
            disabled={approval.submitting}
            className="h-7 px-3 text-xs gap-1"
          >
            <X className="h-3.5 w-3.5" />
            {t('chat.deny')}
          </Button>
        </div>
      ) : (
        <Badge
          variant={approval.status === 'approved' ? 'default' : 'secondary'}
          className="text-[11px]"
        >
          {approval.status === 'approved' ? t('chat.approved') : t('chat.denied')}
        </Badge>
      )}
    </div>
  )
}
