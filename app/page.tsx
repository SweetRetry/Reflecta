"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChatSidebar,
  ChatMessages,
  ChatInput,
} from "@/components/chat";

// Custom hooks
import { useChatStore } from "@/stores/chat-store";
import { useSessions } from "@/hooks/use-sessions";
import { useChatMessages } from "@/hooks/use-chat";
import { useSendMessage } from "@/hooks/use-send-message";

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Zustand store
  const {
    currentSessionId,
    isTemporaryMode,
    streamingContent,
    streamingThinking,
    setCurrentSessionId,
    setIsTemporaryMode,
    clearStreaming,
    resetSession,
  } = useChatStore();

  // React Query hooks
  const { sessions, isLoading: sessionsLoading } = useSessions();
  const { messages, clearMessages } = useChatMessages(
    currentSessionId,
    !isTemporaryMode
  );

  // Streaming and sending
  const { sendMessage, isLoading } = useSendMessage(messages, {
    onSessionCreated: (sessionId) => {
      router.push(`?sessionId=${sessionId}`, { scroll: false });
    },
  });

  // Get sessionId from URL
  const urlSessionId = searchParams.get("sessionId");

  // Sync URL sessionId with store (URL is the source of truth)
  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId);
    }
  }, [urlSessionId, currentSessionId, setCurrentSessionId]);

  // Initialize to first session if no URL sessionId
  useEffect(() => {
    if (!urlSessionId && !isTemporaryMode && sessions.length > 0) {
      // Navigate to the most recent session (first in list)
      router.push(`?sessionId=${sessions[0].sessionId}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, isTemporaryMode]);

  const handleNewChat = () => {
    router.push("/", { scroll: false });
    resetSession();
    clearMessages();
  };

  const handleToggleTemporaryMode = () => {
    const newMode = !isTemporaryMode;
    setIsTemporaryMode(newMode);
    clearMessages();
    clearStreaming();

    if (!newMode && !currentSessionId) {
      handleNewChat();
    }
  };

  const handleSelectSession = (selectedSessionId: string) => {
    router.push(`?sessionId=${selectedSessionId}`, { scroll: false });
    setCurrentSessionId(selectedSessionId);
  };

  const handleSubmit = async (messageData: { text: string }) => {
    await sendMessage(messageData.text);
  };

  // Get current session title
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const currentTitle = isTemporaryMode
    ? "临时对话"
    : currentSession?.title || "新对话";

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
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border/50">
          <h2 className="text-lg font-medium truncate">{currentTitle}</h2>
          <div className="flex items-center gap-2">
            {(!currentSessionId || isTemporaryMode) && (
              <Button
                variant={isTemporaryMode ? "default" : "ghost"}
                size="icon"
                onClick={handleToggleTemporaryMode}
                className="rounded-xl transition-all duration-200"
                title={isTemporaryMode ? "切换到持久对话" : "切换到临时对话"}
              >
                <Clock className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 flex flex-col min-h-0 px-6">
          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
          />
        </div>

        {/* Input */}
        <div className="shrink-0 bg-background w-3xl mx-auto px-6 pb-6">
          <ChatInput isLoading={isLoading} onSubmit={handleSubmit} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          Loading...
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
