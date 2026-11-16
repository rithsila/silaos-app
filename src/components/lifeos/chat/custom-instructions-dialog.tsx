'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/lib/i18n'
import {
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  updateChatInstructions,
  type ChatInstructions,
} from '@/lib/api/chat'

interface CustomInstructionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: ChatInstructions
}

export function CustomInstructionsDialog({
  open,
  onOpenChange,
  initialData,
}: CustomInstructionsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEnabled(Boolean(initialData?.enabled))
      setInstructions(initialData?.instructions ?? '')
      setErrorMsg(null)
    }
  }, [open, initialData])

  const mutation = useMutation({
    mutationFn: updateChatInstructions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chat', 'instructions'] })
      onOpenChange(false)
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save custom instructions')
    },
  })

  const starters = [
    {
      label: t('chat.customInstructionsStarterSimple'),
      text: t('chat.customInstructionsStarterSimpleText'),
    },
    {
      label: t('chat.customInstructionsStarterShort'),
      text: t('chat.customInstructionsStarterShortText'),
    },
    {
      label: t('chat.customInstructionsStarterTone'),
      text: t('chat.customInstructionsStarterToneText'),
    },
  ]

  const applyStarter = (starterText: string) => {
    setErrorMsg(null)
    setInstructions((prev) => {
      const trimmedPrev = prev.trim()
      if (!trimmedPrev) return starterText
      if (trimmedPrev.includes(starterText)) return prev
      const combined = `${trimmedPrev}\n${starterText}`
      return combined.slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH)
    })
  }

  const trimmedLength = instructions.trim().length
  const overLimit = instructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH || trimmedLength > MAX_CUSTOM_INSTRUCTIONS_LENGTH

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (overLimit || mutation.isPending) return
    setErrorMsg(null)
    mutation.mutate({
      enabled,
      instructions: instructions.trim(),
    })
  }

  const handleClear = () => {
    if (mutation.isPending) return
    setErrorMsg(null)
    setEnabled(false)
    setInstructions('')
    mutation.mutate({
      enabled: false,
      instructions: '',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSave} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('chat.customInstructions')}</DialogTitle>
            <DialogDescription>{t('chat.customInstructionsDesc')}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <Label htmlFor="custom-instructions-enabled" className="cursor-pointer text-sm">
              {t('chat.customInstructionsEnable')}
            </Label>
            <Switch
              id="custom-instructions-enabled"
              checked={enabled}
              onCheckedChange={(checked) => {
                setErrorMsg(null)
                setEnabled(checked)
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="custom-instructions-textarea" className="text-xs font-medium">
                {t('chat.customInstructionsLabel')}
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {instructions.length} / {MAX_CUSTOM_INSTRUCTIONS_LENGTH}
              </span>
            </div>

            <Textarea
              id="custom-instructions-textarea"
              value={instructions}
              onChange={(e) => {
                setErrorMsg(null)
                setInstructions(e.target.value)
              }}
              maxLength={MAX_CUSTOM_INSTRUCTIONS_LENGTH}
              rows={5}
              placeholder={t('chat.customInstructionsPlaceholder')}
              className="resize-none text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('chat.customInstructionsStarters')}</p>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((s) => (
                <Button
                  key={s.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => applyStarter(s.text)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t('chat.customInstructionsNote')}</p>

          {errorMsg && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMsg}
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={mutation.isPending}
            >
              {t('chat.customInstructionsClear')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || overLimit}>
              {mutation.isPending ? t('chat.customInstructionsSaving') : t('chat.customInstructionsSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
