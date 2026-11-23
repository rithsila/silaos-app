'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { CommandPalette } from './command-palette'
import { GlobalSearchPanel } from './global-search-panel'
import { SetupWizard } from './setup/setup-wizard'
import { WelcomeScreen } from './welcome/welcome-screen'
import { DashboardPage } from './dashboard/dashboard-page'
import { TasksPage } from './tasks/tasks-page'
import { NotesPage } from './notes/notes-page'
import { BookmarksView } from './bookmarks/bookmarks-view'
import { HabitsPage } from './habits/habits-page'
import { JournalPage } from './journal/journal-page'
import { FinancePage } from './finance/finance-page'
import { GoalsPage } from './goals/goals-page'
import { LearningPage } from './learning/learning-page'
import { CalendarPage } from './calendar/calendar-page'
import { TimePage } from './time/time-page'
import { SettingsPage } from './settings/settings-page'
import { WeeklyReviewPage } from './dashboard/weekly-review'
import { ChatPage } from './chat/chat-page'
import { KeyboardShortcutsHelp, useKeyboardShortcuts } from './keyboard-shortcuts'
import { FocusModeOverlay } from './focus-mode-overlay'
import { motion, AnimatePresence } from 'framer-motion'
import { useIsMobile } from '@/hooks/use-mobile'

const moduleComponents: Record<string, React.ComponentType> = {
  dashboard: DashboardPage,
  chat: ChatPage,
  tasks: TasksPage,
  notes: NotesPage,
  bookmarks: BookmarksView,
  habits: HabitsPage,
  journal: JournalPage,
  finance: FinancePage,
  goals: GoalsPage,
  learning: LearningPage,
  calendar: CalendarPage,
  time: TimePage,
  settings: SettingsPage,
  'weekly-review': WeeklyReviewPage,
}

export function AppShell() {
  const { activeModule, welcomeSeen, setupComplete, focusMode } = useAppStore()
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const isMobile = useIsMobile()

  // Register global keyboard shortcuts
  useKeyboardShortcuts()

  // Listen for the custom event from keyboard shortcuts
  useEffect(() => {
    const handler = () => setShortcutsHelpOpen(true)
    window.addEventListener('lifeos:show-shortcuts', handler)
    return () => window.removeEventListener('lifeos:show-shortcuts', handler)
  }, [])

  if (!setupComplete && !welcomeSeen) {
    return <WelcomeScreen />
  }
  if (!setupComplete) {
    return <SetupWizard />
  }

  const ActiveComponent = moduleComponents[activeModule] || DashboardPage

  // Page transition variants
  const pageVariants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop sidebar — hidden on mobile */}
        {!focusMode && !isMobile && <Sidebar />}

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {!focusMode && <Header />}
          <main className="flex-1 min-h-0 overflow-auto relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeModule}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full min-h-0"
              >
                <ActiveComponent />
              </motion.div>
            </AnimatePresence>
            {focusMode && <FocusModeOverlay />}
          </main>
        </div>
      </div>

      {/* Mobile sidebar Sheet — rendered outside the layout flow */}
      {!focusMode && isMobile && <Sidebar />}

      <CommandPalette />
      <GlobalSearchPanel />
      <KeyboardShortcutsHelp open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
    </div>
  )
}
