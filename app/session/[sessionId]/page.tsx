"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessages, ChatInput } from "@/components/chat";

// Custom hooks
import { useChatStore } from "@/stores/chat-store";
import { useSessions } from "@/hooks/use-sessions";
import { useChatMessages } from "@/hooks/use-chat";
import { useSendMessage } from "@/hooks/use-send-message";

export default function SessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;

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
  const { sessions } = useSessions();
  const { messages, clearMessages } = useChatMessages(
    currentSessionId,
    !isTemporaryMode
  );

  // Streaming and sending
  const { sendMessage, isLoading } = useSendMessage(messages, {
    onSessionCreated: (newSessionId) => {
      router.push(`/session/${newSessionId}`);
    },
  });

  // Sync URL sessionId with store (URL is the source of truth)
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
      setCurrentSessionId(sessionId);
      setIsTemporaryMode(false); // Disable temporary mode when viewing a session
    }
  }, [sessionId, currentSessionId, setCurrentSessionId, setIsTemporaryMode]);

  const handleToggleTemporaryMode = () => {
    const newMode = !isTemporaryMode;
    setIsTemporaryMode(newMode);
    clearMessages();
    clearStreaming();

    if (!newMode && !currentSessionId) {
      router.push("/");
      resetSession();
      clearMessages();
    }
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
    <>
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
      <div className="shrink-0 bg-background max-w-3xl w-full mx-auto px-6 pb-6">
        <ChatInput isLoading={isLoading} onSubmit={handleSubmit} />
      </div>
    </>
  );
}
