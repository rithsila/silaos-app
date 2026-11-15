'use client'

import { ShieldAlert, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/i18n'
import type { ChatApprovalRequest } from '@/lib/api/chat'

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
  const formattedInput =
    typeof approval.input === 'string'
      ? approval.input
      : JSON.stringify(approval.input ?? {}, null, 2)

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{t('chat.approvalTitle')}</span>
        </div>
        <Badge variant="outline" className="font-mono text-[11px]">
          {approval.toolName}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{t('chat.approvalHint')}</p>

      <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 text-[11px] font-mono text-foreground">
        {formattedInput}
      </pre>

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
