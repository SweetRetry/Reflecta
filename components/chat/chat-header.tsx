"use client";

interface ChatHeaderProps {
  sessionId: string | null;
}

export function ChatHeader({ sessionId }: ChatHeaderProps) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-6 py-4">
        <p className="text-xs text-muted-foreground font-mono">
          Session ID: {sessionId || "..."}
        </p>
      </div>
    </header>
  );
}
