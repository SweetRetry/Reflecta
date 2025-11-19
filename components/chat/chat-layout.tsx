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
  const { sessions, isLoading: sessionsLoading } = useSessions();
  const { clearMessages } = useChatMessages(currentSessionId, !isTemporaryMode);

  const handleNewChat = () => {
    router.push("/", { scroll: false });
    resetSession();
    clearMessages();
  };

  const handleSelectSession = (selectedSessionId: string) => {
    router.push(`/session/${selectedSessionId}`);
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
