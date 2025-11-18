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
import { Sparkles, Terminal, Plus, MessageSquare } from "lucide-react";
import { nanoid } from "nanoid";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatSession {
  sessionId: string;
  title: string | null;
  lastMessageTimestamp: number;
  messageCount?: number;
}

// Simple time formatting helper
function formatRelativeTime(timestamp: number) {
  const now = new Date();
  const date = new Date(timestamp);
  const diff = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diff / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Refresh sessions function
  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch("/api/chat?listSessions=true");
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    } finally {
      setSessionsLoading(false);
    }
  };

  // Fetch sessions on mount
  useEffect(() => {
    const fetchSessions = async () => {
      setSessionsLoading(true);
      try {
        const response = await fetch("/api/chat?listSessions=true");
        if (response.ok) {
          const data = await response.json();
          setSessions(data.sessions || []);

          // Initialize sessionId after fetching sessions
          if (!sessionId) {
            const storedSessionId = localStorage.getItem("chat_session_id");
            if (storedSessionId && data.sessions.some((s: ChatSession) => s.sessionId === storedSessionId)) {
              setSessionId(storedSessionId);
            } else if (data.sessions.length > 0) {
              setSessionId(data.sessions[0].sessionId);
            } else {
              handleNewChat();
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
      } finally {
        setSessionsLoading(false);
      }
    };
    fetchSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load chat history when sessionId changes
  useEffect(() => {
    if (!sessionId) return;

    // Reset state for new session
    setMessages([]);
    setStreamingContent("");
    setIsLoading(false);

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/chat?sessionId=${sessionId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.messages && Array.isArray(data.messages)) {
          const historyMessages: ChatMessage[] = data.messages.map(
            (msg: { role: string; content: string; timestamp?: number }) => ({
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            })
          );
          setMessages(historyMessages);
        }
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleNewChat = () => {
    const newSessionId = nanoid();
    setSessionId(newSessionId);
    localStorage.setItem("chat_session_id", newSessionId);
    // Optimistically add new session to top of list
    setSessions(prev => [{
      sessionId: newSessionId,
      title: null,
      lastMessageTimestamp: Date.now(),
      messageCount: 0
    }, ...prev]);
  };

  const handleSelectSession = (selectedSessionId: string) => {
    setSessionId(selectedSessionId);
    localStorage.setItem("chat_session_id", selectedSessionId);
  };
  
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
      let buffer = ""; // Buffer for incomplete SSE events

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Split by double newline (SSE event separator)
          const events = buffer.split("\n\n");
          
          // Keep the last incomplete event in buffer
          buffer = events.pop() || "";

          // Process complete events
          for (const event of events) {
            if (!event.trim()) continue;

            const lines = event.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                
                // Handle completion marker
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

                  // Optimistically update current session in sidebar
                  setSessions(prev => prev.map(s =>
                    s.sessionId === sessionId
                      ? {
                          ...s,
                          lastMessageTimestamp: Date.now(),
                          messageCount: (s.messageCount || 0) + 2, // user + assistant
                          title: s.title || userInput.substring(0, 100)
                        }
                      : s
                  ));

                  // Refresh sessions to get accurate data from backend
                  refreshSessions();

                  continue;
                }

                // Parse JSON data
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
                    console.error("Parse error:", e, "Raw data:", data);
                  }
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
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r border-border bg-card/50 p-2">
        <div className="p-2 mb-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Terminal className="w-5 h-5" />
              <Sparkles className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-primary animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-serif tracking-tight">Claude Memchat</h1>
              <p className="text-xs text-muted-foreground font-mono">
                Recent Chats
              </p>
            </div>
          </div>
        </div>
        
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 w-full p-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>

        <div className="flex-1 mt-4 overflow-y-auto">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader size={24} />
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => (
                <li key={session.sessionId}>
                  <button
                    onClick={() => handleSelectSession(session.sessionId)}
                    className={`w-full text-left p-2 rounded-md text-sm transition-colors flex items-start gap-2 ${
                      sessionId === session.sessionId
                        ? "bg-muted"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate font-medium">
                        {session.title || "New Chat"}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{formatRelativeTime(session.lastMessageTimestamp)}</span>
                        {session.messageCount !== undefined && (
                          <>
                            <span>•</span>
                            <span>{session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-6 py-4">
              <p className="text-xs text-muted-foreground font-mono">
                Session ID: {sessionId || "..."}
              </p>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 container mx-auto px-6 flex flex-col max-w-4xl">
          <Conversation className="flex-1 py-4">
            <ConversationContent>
              {isLoading && messages.length === 0 && (
                 <div className="flex items-center justify-center h-full">
                    <Loader size={32} />
                 </div>
              )}

              {!isLoading && messages.length === 0 && !streamingContent && (
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

              {(isLoading && !streamingContent && messages.length > 0) && (
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
      </main>
    </div>
  );
}
