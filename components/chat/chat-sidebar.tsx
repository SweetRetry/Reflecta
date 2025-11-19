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
  isTemporaryMode: boolean;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function ChatSidebar({
  sessions,
  sessionsLoading,
  currentSessionId,
  isTemporaryMode,
  onNewChat,
  onSelectSession,
}: ChatSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader className="pb-8">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-muted/50">
            <Terminal className="w-5 h-5" />
            <Sparkles className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-primary animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Reflecta
            </h1>
            <p className="text-xs text-muted-foreground tracking-wide">Think Deeper</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <Button
              onClick={onNewChat}
              className="w-full justify-start rounded-xl transition-all duration-200"
              size="sm"
            >
              <Plus className="w-5 h-5 mr-2" />
              新对话
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground">对话历史</SidebarGroupLabel>
          <SidebarGroupContent>
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader size={24} />
              </div>
            ) : sessions.length > 0 ? (
              <SidebarMenu className="space-y-1">
                {sessions.map((session) => (
                  <SidebarMenuItem key={session.sessionId}>
                    <SidebarMenuButton
                      onClick={() => onSelectSession(session.sessionId)}
                      isActive={currentSessionId === session.sessionId && !isTemporaryMode}
                      size="lg"
                      className="rounded-xl transition-all duration-200 hover:translate-x-1 active:scale-[0.98]"
                    >
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm truncate font-medium">
                          {session.title || "新对话"}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <span>
                            {formatRelativeTime(session.lastMessageTimestamp)}
                          </span>
                          {session.messageCount !== undefined && (
                            <>
                              <span>•</span>
                              <span>
                                {session.messageCount} 条消息
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Terminal className="w-10 h-10 mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">准备好开始对话了吗？</p>
                <p className="text-xs text-muted-foreground mt-1">点击上方按钮创建新对话</p>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
