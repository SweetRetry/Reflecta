"use client";

import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

interface ChatInputProps {
  isLoading: boolean;
  onSubmit: (messageData: { text: string }) => void;
}

export function ChatInput({ isLoading, onSubmit }: ChatInputProps) {
  return (
    <PromptInput onSubmit={onSubmit}>
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
  );
}
