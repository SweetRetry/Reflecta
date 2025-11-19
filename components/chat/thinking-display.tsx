"use client";

import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";
import { BrainIcon } from "lucide-react";

interface ThinkingDisplayProps {
  thinking: string;
  isStreaming?: boolean;
  defaultOpen?: boolean;
}

export function ThinkingDisplay({
  thinking,
  isStreaming = false,
  defaultOpen,
}: ThinkingDisplayProps) {
  // If streaming, default to open. Otherwise, use the provided defaultOpen value or default to false
  const shouldDefaultOpen = defaultOpen ?? isStreaming;

  return (
    <div className="mb-3">
      <ChainOfThought defaultOpen={shouldDefaultOpen}>
        <ChainOfThoughtHeader>
          <div className="flex items-center gap-2">
            <BrainIcon className="w-4 h-4" />
            <span>{isStreaming ? "思考中..." : "思考过程"}</span>
            {isStreaming && (
              <div className="flex gap-1 ml-2">
                <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                <div className="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
                <div className="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
              </div>
            )}
          </div>
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed p-3 rounded-lg bg-muted/30 border border-border/30">
            {thinking}
          </div>
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  );
}
