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
    <div className="py-6">
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
      <p className="text-xs text-muted-foreground text-center mt-3 font-mono">
        Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Enter</kbd> to
        send • <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
