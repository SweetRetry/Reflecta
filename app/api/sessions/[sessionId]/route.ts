import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/sessions/[sessionId]
 * 删除指定的 session，包括所有关联的数据：
 * - ChatMessage（消息）
 * - MessageEmbedding（消息的 embedding）
 * - UserMemory（提取的记忆）
 * - MemoryEmbedding（记忆的 embedding）
 *
 * 由于 Prisma schema 中配置了 onDelete: Cascade，
 * 删除 ChatSession 会自动级联删除所有关联数据
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // 验证 sessionId 是否存在
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Invalid session ID" },
        { status: 400 }
      );
    }

    // 检查 session 是否存在
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // 删除 session（级联删除所有关联数据）
    await prisma.chatSession.delete({
      where: { id: sessionId },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Session and all associated data deleted successfully",
        sessionId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting session:", error);

    return NextResponse.json(
      {
        error: "Failed to delete session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
