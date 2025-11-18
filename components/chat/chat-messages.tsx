"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Loader } from "@/components/ai-elements/loader";
import { Sparkles } from "lucide-react";
import { ChatMessage } from "./types";
import { motion, AnimatePresence } from "framer-motion";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingContent: string;
}

export function ChatMessages({
  messages,
  isLoading,
  streamingContent,
}: ChatMessagesProps) {
  return (
    <Conversation className="flex-1 py-8">
      <ConversationContent>
        {isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full animate-in fade-in duration-300">
            <Loader size={32} />
          </div>
        )}

        {!isLoading && messages.length === 0 && !streamingContent && (
          <div className="py-20 animate-in fade-in duration-500">
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
        )}

        <div className="space-y-6">
          <AnimatePresence mode="popLayout">
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <Message from={message.role}>
                  <MessageContent>
                    <div className="flex items-center gap-2 mb-2 opacity-70">
                      <span className="text-xs font-medium uppercase tracking-wide">
                        {message.role === "user" ? "You" : "Assistant"}
                      </span>
                      <span className="text-xs font-mono opacity-60">
                        {message.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <MessageResponse>{message.content}</MessageResponse>
                  </MessageContent>
                </Message>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {isLoading && !streamingContent && messages.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 mb-2 opacity-70">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Assistant
                  </span>
                </div>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    正在思考中...
                  </span>
                </div>
              </MessageContent>
            </Message>
          </div>
        )}

        {streamingContent && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 mb-2 opacity-70">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Assistant
                  </span>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
                <MessageResponse>{streamingContent}</MessageResponse>
              </MessageContent>
            </Message>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
