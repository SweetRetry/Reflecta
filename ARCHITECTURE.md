# 架构文档

## 概述

LangChain MemChat 是一个基于 Next.js 的智能聊天应用，集成了 LangChain、Anthropic API、向量数据库和记忆管理功能。该应用提供了对话记忆、RAG（检索增强生成）、反射记忆提取等高级功能。

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **数据库**: PostgreSQL + Prisma ORM
- **向量数据库**: pgvector (PostgreSQL 扩展)
- **LLM**: Anthropic Claude (通过 LangChain)
- **Embedding**: Xenova Transformers (本地模型)
- **状态管理**: LangGraph (用于记忆提取工作流)
- **UI**: React 19 + Tailwind CSS + Radix UI

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Chat UI    │  │  Components  │  │   Themes     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Route (/api/chat)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Request Flow:                                        │  │
│  │  1. Validation (ChatValidator)                        │  │
│  │  2. Rate Limiting (RateLimiter)                       │  │
│  │  3. Memory Retrieval (chat-memory)                     │  │
│  │  4. LLM Streaming (ChatAnthropic)                     │  │
│  │  5. Background Memory Processing                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│   Memory     │  │   Vector     │  │   Memory Graph       │
│  Management  │  │   Store      │  │   (LangGraph)        │
│              │  │              │  │                      │
│ - Save       │  │ - Semantic   │  │ - Extract Facts     │
│ - Retrieve   │  │   Search     │  │ - Validate           │
│ - History    │  │ - RAG        │  │ - Consolidate       │
└──────────────┘  └──────────────┘  └──────────────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL + pgvector Database                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ChatSession  │  │ ChatMessage  │  │ UserMemory   │      │
│  │              │  │              │  │              │      │
│  │ - id         │  │ - id         │  │ - id         │      │
│  │ - title      │  │ - sessionId  │  │ - sessionId  │      │
│  │ - timestamps │  │ - role       │  │ - content    │      │
│  │              │  │ - content    │  │ - category   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │MessageEmbed │  │MemoryEmbed  │                          │
│  │              │  │              │                          │
│  │ - vector     │  │ - vector     │                          │
│  └──────────────┘  └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. API 路由 (`app/api/chat/route.ts`)

主要的 HTTP 端点，处理聊天请求。

**功能**:
- POST: 处理聊天请求，返回 SSE 流式响应
- GET: 获取聊天历史或 API 统计信息

**请求流程**:
1. 配置验证
2. 请求验证和清理
3. 速率限制检查
4. 构建消息历史（包含 RAG 检索）
5. 流式 LLM 响应
6. 后台记忆处理

### 2. 记忆管理 (`lib/chat-memory.ts`)

管理对话历史和上下文检索。

**主要函数**:
- `getMemoryForSession()`: 获取会话的所有消息
- `saveToMemory()`: 保存对话到数据库
- `processMemoryInBackground()`: 后台处理记忆（保存 + 记忆图）
- `searchRelevantContext()`: RAG 检索相关上下文
- `buildMessagesWithMemory()`: 构建完整的消息数组（包含 RAG + 历史 + 当前消息）
- `getHistoryWithTimestamps()`: 获取带时间戳的历史记录
- `getRecentSessions()`: 获取最近的会话列表

### 3. 记忆图 (`lib/agents/memory-graph.ts`)

使用 LangGraph 实现的反射记忆提取工作流。

**工作流节点**:
1. **Extract**: 从对话中提取事实、偏好、约束
2. **Validate**: 去重和验证（避免重复记忆）
3. **Consolidate**: 检测冲突并合并相似事实
4. **Save**: 保存到数据库并生成嵌入向量

**状态结构**:
```typescript
{
  sessionId: string;
  recentMessages: BaseMessage[];
  extractedFacts: string[];
}
```

### 4. 向量存储 (`lib/chat-vector-store.ts`)

基于 Prisma 和 pgvector 的语义搜索实现。

**功能**:
- `searchSimilarMessages()`: 搜索相似的历史消息（跨会话 RAG）
- `searchSimilarMemories()`: 搜索相似的记忆（用户偏好/事实）

**搜索参数**:
- `queryVector`: 查询向量
- `topK`: 返回结果数量
- `excludeSessionId`: 排除的会话 ID
- `minScore`: 最小相似度分数

### 5. 嵌入服务 (`lib/chat-embedding.ts`)

本地嵌入生成服务，使用 Xenova Transformers。

**特点**:
- 无需外部 API 调用
- 使用 `multilingual-e5-small` 模型（默认）
- 单例模式，延迟加载模型

### 6. Token 管理 (`lib/token-manager.ts`)

上下文窗口优化和 Token 计数。

**功能**:
- `countMessagesTokens()`: 计算消息的 Token 数量
- `getMaxContextTokens()`: 获取最大上下文 Token 数
- `smartTruncateMessages()`: 智能截断消息（保留系统消息和最近消息）
- `getTokenStats()`: 获取 Token 统计信息（用于调试）

**Token 限制**:
- 默认模型: 200,000 tokens
- 响应缓冲区: 4,096 tokens
- 可用上下文: 195,904 tokens

### 7. 请求验证 (`lib/chat-validator.ts`)

输入验证和清理。

**功能**:
- `validateRequest()`: 验证请求数据（使用 Zod）
- `sanitizeMessage()`: 清理消息（移除控制字符）

**验证规则**:
- 消息长度: 1-10,000 字符
- sessionId: 必需
- userId: 可选

### 8. 配置管理 (`lib/chat-config.ts`)

单例配置管理器。

**配置类型**:
- **EmbeddingConfig**: 嵌入模型配置
- **ChatConfig**: LLM 模型配置
- **RateLimitConfig**: 速率限制配置

**环境变量**:
- `ANTHROPIC_API_KEY`: Anthropic API 密钥（必需）
- `ANTHROPIC_BASE_URL`: 可选的 API 基础 URL
- `CHAT_MODEL`: 聊天模型名称（默认: "MiniMax-M2"）
- `EMBEDDING_MODEL`: 嵌入模型名称（默认: "Xenova/multilingual-e5-small"）
- `MAX_TOKENS`: 最大 Token 数（默认: 1000）
- `TEMPERATURE`: 温度参数（默认: 0.7）
- `RATE_LIMIT_PER_MINUTE`: 每分钟请求限制（默认: 20）
- `RATE_LIMIT_PER_HOUR`: 每小时请求限制（默认: 200）

### 9. 速率限制 (`lib/rate-limiter.ts`)

基于内存的速率限制实现。

**功能**:
- 按 IP 或用户 ID 跟踪请求
- 可配置的每分钟/每小时限制
- 自动清理过期条目

### 10. 指标收集 (`lib/chat-metrics.ts`)

请求性能指标跟踪。

**指标**:
- 请求 ID
- 开始/结束时间
- Token 使用量
- 模型名称
- 错误信息

**统计信息**:
- 总请求数
- 成功/失败请求数
- 平均响应时间
- Token 使用总量

### 11. 向量工具 (`lib/vector-utils.ts`)

向量操作的实用函数。

**功能**:
- `cosineSimilarity()`: 计算余弦相似度
- `parseVector()`: 解析 JSON 字符串为向量
- `serializeVector()`: 序列化向量为 JSON
- `toPgVectorString()`: 转换为 pgvector 格式（带验证）

## 数据模型

### ChatSession
```prisma
model ChatSession {
  id        String   @id
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  ChatMessage[]
  memories  UserMemory[]
}
```

### ChatMessage
```prisma
model ChatMessage {
  id        Int      @id @default(autoincrement())
  sessionId String
  role      String   // "human" or "ai"
  content   String
  createdAt DateTime @default(now())
  session   ChatSession @relation(...)
  embeddings MessageEmbedding[]
}
```

### UserMemory
```prisma
model UserMemory {
  id        Int      @id @default(autoincrement())
  sessionId String
  content   String   // Extracted fact/preference
  category  String?
  confidence Float?  @default(1.0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  session   ChatSession @relation(...)
  embedding MemoryEmbedding?
}
```

### MessageEmbedding / MemoryEmbedding
```prisma
model MessageEmbedding {
  id        Int
  messageId Int
  sessionId String
  vector    Unsupported("vector(384)")  // pgvector type
  createdAt DateTime @default(now())
}
```

## 数据流

### 聊天请求流程

1. **客户端发送请求**
   ```
   POST /api/chat
   {
     "message": "用户消息",
     "sessionId": "session_123",
     "userId": "user_456" (可选)
   }
   ```

2. **验证和速率限制**
   - 验证请求格式
   - 检查速率限制

3. **构建消息上下文**
   - 获取会话历史
   - RAG 检索相关上下文（跨会话消息 + 记忆）
   - 智能 Token 截断
   - 添加当前消息

4. **LLM 流式响应**
   - 发送消息到 Anthropic API
   - 流式返回响应（SSE）

5. **后台记忆处理**
   - 保存对话到数据库
   - 生成消息嵌入
   - 触发记忆图工作流（提取、验证、合并、保存）

### RAG 检索流程

1. **生成查询嵌入**
   - 使用 LocalEmbeddingService 生成当前消息的嵌入向量

2. **语义搜索**
   - 搜索相似的历史消息（跨会话，排除当前会话）
   - 搜索相似的记忆（用户偏好/事实）

3. **组合结果**
   - 记忆作为系统消息
   - 历史消息作为上下文示例

### 记忆提取流程（Memory Graph）

1. **提取事实**
   - LLM 分析最近对话
   - 提取值得长期记忆的事实、偏好、约束

2. **验证**
   - 检查是否已存在相同记忆
   - 去重

3. **合并**
   - 检测冲突（矛盾、更新、冗余）
   - 使用 LLM 合并相似记忆

4. **保存**
   - 创建 UserMemory 记录
   - 生成嵌入向量
   - 保存到 MemoryEmbedding 表

## 安全考虑

1. **输入验证**: 所有用户输入都经过验证和清理
2. **SQL 注入防护**: 使用 Prisma 参数化查询和向量验证
3. **速率限制**: 防止滥用和 DoS 攻击
4. **API 密钥管理**: 环境变量存储，不在代码中硬编码

## 性能优化

1. **Token 管理**: 智能截断确保不超过上下文窗口
2. **后台处理**: 记忆处理在响应发送后异步执行
3. **向量索引**: 数据库索引优化相似度搜索
4. **单例模式**: 减少重复实例化（配置、嵌入服务等）
5. **延迟加载**: 嵌入模型按需加载

## 扩展性考虑

1. **多用户支持**: 当前假设单用户，可通过添加 `userId` 字段扩展
2. **分布式速率限制**: 当前使用内存存储，可迁移到 Redis
3. **指标持久化**: 当前使用内存存储，可迁移到数据库
4. **嵌入服务**: 可替换为外部 API（OpenAI、Anthropic 等）

## 环境变量

```bash
# 必需
ANTHROPIC_API_KEY=your_api_key_here

# 可选
ANTHROPIC_BASE_URL=https://api.anthropic.com
CHAT_MODEL=MiniMax-M2
EMBEDDING_MODEL=Xenova/multilingual-e5-small
EMBEDDING_ENABLED=true
RAG_ENABLED=true
RAG_TOP_K=8
MAX_TOKENS=1000
TEMPERATURE=0.7
TOP_P=1.0
MAX_HISTORY_LENGTH=20
RATE_LIMIT_PER_MINUTE=20
RATE_LIMIT_PER_HOUR=200
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

## 部署

1. **数据库设置**
   ```bash
   # 确保 PostgreSQL 安装了 pgvector 扩展
   CREATE EXTENSION IF NOT EXISTS vector;
   
   # 运行迁移
   pnpm prisma migrate dev
   ```

2. **构建**
   ```bash
   pnpm build
   ```

3. **启动**
   ```bash
   pnpm start
   ```

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 数据库管理
pnpm prisma studio
pnpm prisma migrate dev
```

## 未来改进

1. **多用户支持**: 添加用户认证和隔离
2. **记忆分类**: 改进记忆分类系统
3. **记忆过期**: 实现记忆自动过期机制
4. **更好的错误处理**: 增强错误恢复和重试逻辑
5. **监控和日志**: 集成专业的监控和日志系统
6. **缓存**: 添加嵌入向量和检索结果缓存

