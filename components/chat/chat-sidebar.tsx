"use client";

import { Terminal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  onDeleteSession: (sessionId: string) => void;
}

export function ChatSidebar({
  sessions,
  sessionsLoading,
  currentSessionId,
  isTemporaryMode,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: ChatSidebarProps) {
  const { state } = useSidebar();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation(); // 防止触发 onSelectSession
    setSessionToDelete(session);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!sessionToDelete) return;

    setIsDeleting(true);
    try {
      await onDeleteSession(sessionToDelete.sessionId);
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      console.error("删除 session 失败:", error);
    } finally {
      setIsDeleting(false);
    }
  };

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
                  <SidebarMenuItem
                    key={session.sessionId}
                    className="group/session-item"
                  >
                    <div className="relative group">
                      <SidebarMenuButton
                        onClick={() => onSelectSession(session.sessionId)}
                        isActive={
                          currentSessionId === session.sessionId &&
                          !isTemporaryMode
                        }
                        tooltip={session.title || "新对话"}
                        size="lg"
                        className="rounded-xl  transition-all duration-200 hover:translate-x-1 active:scale-[0.98] pr-12"
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute group-hover/session-item:opacity-100 opacity-0 right-2 top-1/2 -translate-y-1/2 h-8 w-8  transition-opacity"
                        onClick={(e) => handleDeleteClick(e, session)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>确认删除对话</DialogTitle>
            <DialogDescription>
              确定要删除对话{" "}
              <span className="font-semibold">
                &quot;{sessionToDelete?.title || "新对话"}&quot;
              </span>{" "}
              吗？
              <br />
              <br />
              此操作将永久删除该对话的所有内容，包括：
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>所有聊天消息</li>
                <li>提取的记忆和知识</li>
                <li>相关的向量数据</li>
              </ul>
              <br />
              此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
