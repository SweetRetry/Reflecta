"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ChatMessages, ChatInput, ChatMessagesRef } from "@/components/chat";

// Custom hooks
import { useChatStore } from "@/stores/chat-store";
import { useSessions } from "@/hooks/use-sessions";
import { useChatMessages } from "@/hooks/use-chat";
import { useSendMessage } from "@/hooks/use-send-message";

export default function SessionPage() {
  const router = useRouter();

  const chatMessagesRef = useRef<ChatMessagesRef>(null);

  // Zustand store
  const {
    currentSessionId,
    isTemporaryMode,
    streamingContent,
    streamingThinking,
  } = useChatStore();

  // React Query hooks
  const { sessions } = useSessions();
  const { messages } = useChatMessages(currentSessionId, !isTemporaryMode);

  // Streaming and sending
  const { sendMessage, isLoading } = useSendMessage(messages, {
    onSessionCreated: (newSessionId) => {
      router.push(`/session/${newSessionId}`);
    },
  });

  const handleSubmit = async (messageData: { text: string }) => {
    await sendMessage(messageData.text);
    chatMessagesRef.current?.scrollToBottom();
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
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col min-h-0 px-6">
        <ChatMessages
          ref={chatMessagesRef}
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
