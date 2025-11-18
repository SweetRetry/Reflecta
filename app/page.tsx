"use client";

import { useState, useRef, useEffect } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse
} from "@/components/ai-elements/message";
import { Loader } from "@/components/ai-elements/loader";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Sparkles, Terminal } from "lucide-react";
import { nanoid } from "nanoid";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sessionId] = useState(() => {
    // Generate or retrieve sessionId from localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chat_session_id");
      if (stored) {
        return stored;
      }
      const newSessionId = nanoid();
      localStorage.setItem("chat_session_id", newSessionId);
      return newSessionId;
    }
    return nanoid();
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const sendMessage = async (messageData: { text: string }) => {
    const userInput = messageData.text;
    if (!userInput.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: userInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userInput,
          sessionId: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: accumulatedContent,
                    timestamp: new Date(),
                  },
                ]);
                setStreamingContent("");
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulatedContent += parsed.content;
                  setStreamingContent(accumulatedContent);
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (e) {
                if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                  console.error("Parse error:", e);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, an error occurred. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Terminal className="w-5 h-5" />
              <Sparkles className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-primary animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-serif tracking-tight">Claude Memchat</h1>
              <p className="text-xs text-muted-foreground font-mono">
                Powered by LangChain × Anthropic
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 container mx-auto px-6 flex flex-col max-w-4xl">
        <Conversation className="flex-1 py-4">
          <ConversationContent>
            {messages.length === 0 && !streamingContent && (
              <ConversationEmptyState
                icon={<Sparkles className="w-12 h-12 text-primary" />}
                title="Start a conversation"
                description="Ask anything. This AI assistant uses advanced language models to provide thoughtful, contextual responses."
              />
            )}

            {messages.map((message, index) => (
              <Message key={index} from={message.role}>
                <MessageContent>
                  <div className="flex items-center gap-2 mb-2 opacity-70">
                    <span className="text-xs font-mono uppercase">
                      {message.role === "user" ? "You" : "Assistant"}
                    </span>
                    <span className="text-xs opacity-60">
                      {message.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <MessageResponse>{message.content}</MessageResponse>
                </MessageContent>
              </Message>
            ))}

            {(isLoading && !streamingContent) && (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex items-center gap-2 mb-2 opacity-70">
                    <span className="text-xs font-mono uppercase">Assistant</span>
                  </div>
                  <div className="flex items-center gap-2 py-2">
                    <Loader size={16} />
                    <span className="text-sm text-muted-foreground">正在思考中...</span>
                  </div>
                </MessageContent>
              </Message>
            )}

            {streamingContent && (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex items-center gap-2 mb-2 opacity-70">
                    <span className="text-xs font-mono uppercase">Assistant</span>
                    <div className="flex gap-1">
                      <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                      <div className="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:200ms]" />
                      <div className="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:400ms]" />
                    </div>
                  </div>
                  <MessageResponse>{streamingContent}</MessageResponse>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input Area */}
        <div className="py-6">
          <PromptInput onSubmit={sendMessage}>
            <PromptInputTextarea
              placeholder="Type your message..."
              disabled={isLoading}
            />
            <PromptInputFooter>
              <div className="flex-1" />
              <PromptInputSubmit
                status={isLoading ? "streaming" : undefined}
                disabled={isLoading}
              />
            </PromptInputFooter>
          </PromptInput>
          <p className="text-xs text-muted-foreground text-center mt-3 font-mono">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd> to
            send • <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}
