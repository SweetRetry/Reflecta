"use client";

import { useRouter } from "next/navigation";
import { MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/chat";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";

// Custom hooks
import { useChatStore } from "@/stores/chat-store";
import { useChatMessages } from "@/hooks/use-chat";
import { useSendMessage } from "@/hooks/use-send-message";

import { nanoid } from "nanoid";

export default function ChatPage() {
  const router = useRouter();

  // For the home page, sessionId is always null (new conversation)
  const currentSessionId = null;

  // Zustand store
  const {
    isTemporaryMode,
    setIsTemporaryMode,
    clearStreaming,
    resetSession,
    setPendingMessage,
  } = useChatStore();

  // React Query hooks
  const { messages, clearMessages } = useChatMessages(currentSessionId);

  // Streaming and sending
  const { isLoading } = useSendMessage(currentSessionId, messages);

  const handleToggleTemporaryMode = () => {
    const newMode = !isTemporaryMode;
    setIsTemporaryMode(newMode);
    clearMessages();
    clearStreaming();

    if (!newMode) {
      router.push("/", { scroll: false });
      resetSession();
      clearMessages();
    }
  };

  const handleSubmit = async (messageData: { text: string }) => {
    if (!messageData.text.trim()) return;

    if (isTemporaryMode) {
      // Temporary mode handling (existing logic)
      // Note: If temporary mode needs to support initial redirect too, we can adapt it.
      // For now, let's assume temporary mode works within the same page or handles its own logic?
      // Wait, temporary mode in original code was also navigating?
      // Actually, temporary mode usually stays on the same page or uses a specific route.
      // Looking at useSendMessage, temporary mode uses /api/chat/temporary.
      // Let's stick to the plan:
      // For normal mode: generate ID -> setPendingMessage -> navigate
      const sessionId = nanoid();
      setPendingMessage(messageData.text);
      router.push(`/session/${sessionId}`);
    } else {
      const sessionId = nanoid();
      setPendingMessage(messageData.text);
      router.push(`/session/${sessionId}`);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 ">
        <div className="text-xl font-bold">Reflecta</div>
        <div className="flex items-center gap-2">
          <Button
            variant={isTemporaryMode ? "default" : "ghost"}
            size="icon"
            onClick={handleToggleTemporaryMode}
            className="rounded-xl transition-all duration-200"
            title={isTemporaryMode ? "切换到持久对话" : "切换到临时对话"}
          >
            <MessageCircle className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col min-h-0 px-6">
        <ConversationEmptyState
          icon={
            <div className="relative">
              <Sparkles className="w-16 h-16 text-primary animate-pulse" />
              <div className="absolute inset-0 blur-xl bg-primary/20 animate-pulse" />
            </div>
          }
          title="准备好创作了吗？"
          description="这里是一个安静的思考空间。问任何问题，获得深度回应。"
        />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-background max-w-3xl w-full mx-auto px-6 pb-6">
        <ChatInput isLoading={isLoading} onSubmit={handleSubmit} />
      </div>
    </>
  );
}
