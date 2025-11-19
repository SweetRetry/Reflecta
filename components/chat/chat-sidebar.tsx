"use client";

import { Terminal, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
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
  const { state } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-3 justify-between">
          {state !== "collapsed" ? (
            <Terminal className="w-5 h-5 ml-2" />
          ) : (
            <SidebarTrigger />
          )}

          <SidebarTrigger className="group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onNewChat}
                  tooltip="新对话"
                  className="rounded-xl transition-all duration-200"
                >
                  <Plus className="w-5 h-5" />
                  <span>新对话</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-muted-foreground">
            对话历史
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {sessionsLoading ? (
              <SidebarMenu className="space-y-1">
                {[1, 2, 3].map((i) => (
                  <SidebarMenuItem key={i}>
                    <div className="px-3 py-3 rounded-xl">
                      <Skeleton className="h-4 w-full mb-2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : sessions.length > 0 ? (
              <SidebarMenu className="space-y-1">
                {sessions.map((session) => (
                  <SidebarMenuItem key={session.sessionId}>
                    <SidebarMenuButton
                      onClick={() => onSelectSession(session.sessionId)}
                      isActive={
                        currentSessionId === session.sessionId &&
                        !isTemporaryMode
                      }
                      tooltip={session.title || "新对话"}
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
                            <span>{session.messageCount} 条消息</span>
                          )}
                        </div>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center group-data-[collapsible=icon]:hidden">
                <Terminal className="w-10 h-10 mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  准备好开始对话了吗？
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  点击上方按钮创建新对话
                </p>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
