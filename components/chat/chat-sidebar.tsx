"use client";

import { Terminal, Sparkles, Plus, MessageSquare } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import { ChatSession } from "./types";
import { formatRelativeTime } from "./utils";

interface ChatSidebarProps {
  sessions: ChatSession[];
  sessionsLoading: boolean;
  currentSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function ChatSidebar({
  sessions,
  sessionsLoading,
  currentSessionId,
  onNewChat,
  onSelectSession,
}: ChatSidebarProps) {
  return (
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
        onClick={onNewChat}
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
                  onClick={() => onSelectSession(session.sessionId)}
                  className={`w-full text-left p-2 rounded-md text-sm transition-colors flex items-start gap-2 ${
                    currentSessionId === session.sessionId
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
  );
}
