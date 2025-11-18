"use client";

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
import { Sparkles } from "lucide-react";
import { ChatMessage } from "./types";

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
  );
}
