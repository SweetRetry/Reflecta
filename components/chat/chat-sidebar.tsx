"use client";

import { Terminal, Sparkles, Plus } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
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
    <Sidebar>
      <SidebarHeader className="pb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Terminal className="w-5 h-5" />

            <Sparkles className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-primary animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-serif font-semibold tracking-tight">
              Claude Memchat
            </h1>
            <p className="text-xs text-muted-foreground">Recent Chats</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <Button
              onClick={onNewChat}
              className="w-full justify-start"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader size={24} />
              </div>
            ) : (
              <SidebarMenu>
                {sessions.map((session) => (
                  <SidebarMenuItem key={session.sessionId}>
                    <SidebarMenuButton
                      onClick={() => onSelectSession(session.sessionId)}
                      isActive={currentSessionId === session.sessionId}
                      size="lg"
                      className="transition-all duration-150 hover:translate-x-0.5 active:scale-[0.98]"
                    >
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm truncate font-medium">
                          {session.title || "New Chat"}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>
                            {formatRelativeTime(session.lastMessageTimestamp)}
                          </span>
                          {session.messageCount !== undefined && (
                            <>
                              <span>•</span>
                              <span>
                                {session.messageCount} msg
                                {session.messageCount !== 1 ? "s" : ""}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
