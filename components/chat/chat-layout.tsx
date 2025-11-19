"use client";

import { useRouter, useParams } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ChatSidebar } from "./chat-sidebar";

// Custom hooks
import { useChatStore } from "@/stores/chat-store";
import { useSessions } from "@/hooks/use-sessions";
import { useChatMessages } from "@/hooks/use-chat";

export function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();

  // Get currentSessionId from URL params (single source of truth)
  const currentSessionId = (params.sessionId as string) || null;

  // Zustand store
  const { isTemporaryMode, resetSession } = useChatStore();

  // React Query hooks
  const { sessions, isLoading: sessionsLoading, deleteSession } = useSessions();
  const { clearMessages } = useChatMessages(currentSessionId, !isTemporaryMode);

  const handleNewChat = () => {
    router.push("/", { scroll: false });
    resetSession();
    clearMessages();
  };

  const handleSelectSession = (selectedSessionId: string) => {
    router.push(`/session/${selectedSessionId}`);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);

      // If the deleted session is the current session, navigate to home
      if (currentSessionId === sessionId) {
        router.push("/", { scroll: false });
        resetSession();
        clearMessages();
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
      throw error; // Re-throw to allow the UI to handle it
    }
  };

  return (
    <SidebarProvider>
      <ChatSidebar
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        currentSessionId={currentSessionId}
        isTemporaryMode={isTemporaryMode}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />
      <SidebarInset
        className={`flex flex-col h-screen overflow-hidden transition-all duration-300 ${
          isTemporaryMode ? "bg-muted/20" : ""
        }`}
      >
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
