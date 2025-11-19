"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  ChatSidebar, ChatMessages,
  ChatInput,
  type ChatMessage,
  type ChatSession
} from "@/components/chat";

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Get sessionId from URL query params
  const sessionId = searchParams.get("sessionId");

  // Refresh sessions function
  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch("/api/sessions");
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

  // Update URL when sessionId changes
  const updateSessionIdInUrl = (newSessionId: string | null) => {
    if (newSessionId) {
      router.push(`?sessionId=${newSessionId}`, { scroll: false });
    } else {
      router.push("/", { scroll: false });
    }
  };

  const handleNewChat = () => {
    const newSessionId = nanoid();
    updateSessionIdInUrl(newSessionId);
    localStorage.setItem("chat_session_id", newSessionId);
    // Optimistically add new session to top of list
    setSessions((prev) => [
      {
        sessionId: newSessionId,
        title: null,
        lastMessageTimestamp: Date.now(),
        messageCount: 0,
      },
      ...prev,
    ]);
  };

  // Fetch sessions on mount
  useEffect(() => {
    const fetchSessions = async () => {
      setSessionsLoading(true);
      try {
        const response = await fetch("/api/sessions");
        if (response.ok) {
          const data = await response.json();
          setSessions(data.sessions || []);

          // Initialize sessionId from URL or fallback to stored/default
          if (!sessionId) {
            const storedSessionId = localStorage.getItem("chat_session_id");
            if (
              storedSessionId &&
              data.sessions.some(
                (s: ChatSession) => s.sessionId === storedSessionId
              )
            ) {
              updateSessionIdInUrl(storedSessionId);
            } else if (data.sessions.length > 0) {
              updateSessionIdInUrl(data.sessions[0].sessionId);
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
    setStreamingThinking("");
    setIsLoading(false);

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`);
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

  const handleSelectSession = (selectedSessionId: string) => {
    updateSessionIdInUrl(selectedSessionId);
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
    setStreamingThinking("");

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
                      thinking: streamingThinking || undefined,
                    },
                  ]);
                  setStreamingContent("");
                  setStreamingThinking("");

                  // Optimistically update current session in sidebar
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.sessionId === sessionId
                        ? {
                            ...s,
                            lastMessageTimestamp: Date.now(),
                            messageCount: (s.messageCount || 0) + 2, // user + assistant
                            title: s.title || userInput.substring(0, 100),
                          }
                        : s
                    )
                  );

                  // Refresh sessions to get accurate data from backend
                  refreshSessions();

                  continue;
                }

                // Parse JSON data
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.thinking) {
                    setStreamingThinking(parsed.thinking);
                  }
                  if (parsed.content) {
                    accumulatedContent += parsed.content;
                    setStreamingContent(accumulatedContent);
                  }
                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }
                } catch (e) {
                  if (
                    e instanceof Error &&
                    e.message !== "Unexpected end of JSON input"
                  ) {
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
    <SidebarProvider>
      <ChatSidebar
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        currentSessionId={sessionId}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
      />

      <SidebarInset className="flex flex-col p-8 space-y-8">
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          streamingThinking={streamingThinking}
        />

        <ChatInput isLoading={isLoading} onSubmit={sendMessage} />
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  );
}
