import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatUiState {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
}

export const useChatStore = create<ChatUiState>()(
  persist(
    (set) => ({
      activeSessionId: null,
      setActiveSessionId: (id) => set({ activeSessionId: id }),
    }),
    {
      name: 'lifeos-chat-store',
    },
  ),
)
