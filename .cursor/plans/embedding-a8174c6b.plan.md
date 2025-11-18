<!-- a8174c6b-b9f0-497b-bd9e-fcea339e78a0 a3c69979-165b-4577-908a-b84cc100856c -->
# 本地 Embedding 和全局上下文实现方案

## 架构设计

### MVP 阶段（快速实现）

- **Embedding 模型**: 使用 `@xenova/transformers` 的本地模型（`Xenova/all-MiniLM-L6-v2`），完全本地化
- **向量存储**: SQLite + `sqlite-vss` extension，与现有 Prisma 数据库集成
- **检索策略**: 语义相似度检索 + 时间衰减（优先最近的消息）

### 生产级架构（可扩展）

- 抽象 Embedding 服务接口，支持本地模型和 API（OpenAI/Anthropic）切换
- 抽象向量存储接口，方便未来迁移到 Chroma/Qdrant/Pinecone
- 配置驱动的实现切换

## 实现步骤

### 1. 数据库扩展

- 在 `prisma/schema.prisma` 中添加 `MessageEmbedding` 模型存储向量
- 创建迁移脚本初始化 sqlite-vss extension
- 添加向量索引表（sqlite-vss 需要）

### 2. Embedding 服务层 (`lib/chat-embedding.ts`)

- 创建 `EmbeddingService` 抽象接口
- 实现 `LocalEmbeddingService`（使用 @xenova/transformers）
- 支持未来扩展 `APIEmbeddingService`
- 配置管理（模型选择、维度等）

### 3. 向量存储层 (`lib/chat-vector-store.ts`)

- 创建 `VectorStore` 抽象接口
- 实现 `SQLiteVectorStore`（使用 sqlite-vss）
- 提供 `addEmbedding()`, `searchSimilar()`, `deleteEmbedding()` 方法
- 支持未来扩展其他向量数据库实现

### 4. 集成到记忆系统 (`lib/chat-memory.ts`)

- 修改 `saveToMemory()` 函数，保存消息时自动生成 embedding
- 新增 `searchRelevantContext()` 函数，跨会话检索相关历史
- 新增 `buildMessagesWithRAG()` 函数，结合当前会话历史和全局上下文

### 5. API 路由更新 (`app/api/chat/route.ts`)

- 修改 `buildMessageHistory()` 函数，使用 RAG 检索相关上下文
- 添加配置选项控制检索数量（top-k）和相似度阈值
- 在消息构建时注入检索到的全局上下文

### 6. 配置管理 (`lib/chat-config.ts`)

- 添加 embedding 相关配置（模型、维度、检索参数）
- 添加向量存储配置选项

### 7. 依赖安装

- `@xenova/transformers`: 本地 embedding 模型
- `sqlite-vss`: SQLite 向量搜索扩展（需要编译或使用预编译版本）

## 关键文件修改

- `prisma/schema.prisma`: 添加 MessageEmbedding 模型
- `lib/chat-embedding.ts`: 新建 Embedding 服务
- `lib/chat-vector-store.ts`: 新建向量存储抽象层
- `lib/chat-memory.ts`: 集成 RAG 检索功能
- `app/api/chat/route.ts`: 使用 RAG 构建消息历史
- `lib/chat-config.ts`: 添加 embedding 配置
- `package.json`: 添加新依赖

## 检索策略

1. **相似度检索**: 使用余弦相似度查找最相关的历史消息（跨所有会话）
2. **时间衰减**: 对较新的消息给予更高权重（可配置衰减因子）
3. **会话隔离**: 可选按用户或会话组隔离检索范围（未来扩展）
4. **上下文窗口**: 限制检索结果数量（top-k），避免 token 超限
5. **去重机制**: 避免重复检索当前会话中已有的消息

## 模型选择说明

**推荐模型：`Xenova/multilingual-e5-small`**

- 参数量：~134M（适中，本地可运行）
- 支持语言：100+ 语言，中英文表现良好
- 向量维度：384（存储效率高）
- 性能：在 MTEB 基准测试中表现优秀

**备选方案**：

- `Xenova/bge-small-zh-v1.5`：中文优化，~33M，384 维（如果主要处理中文）
- `Xenova/bge-small-en-v1.5`：英文优化，~33M，384 维（如果主要处理英文）
- 未来可无缝切换到 OpenAI `text-embedding-3-small`（1536 维）或 `text-embedding-3-large`（3072 维）

### To-dos

- [ ] 安装依赖：@xenova/transformers 和 sqlite-vss（或替代方案）
- [ ] 扩展 Prisma schema 添加 MessageEmbedding 模型和向量存储表
- [ ] 创建 lib/chat-embedding.ts 实现本地 embedding 服务（抽象接口 + 本地实现）
- [ ] 创建 lib/chat-vector-store.ts 实现向量存储抽象层（SQLite + sqlite-vss）
- [ ] 修改 lib/chat-memory.ts 集成 RAG：保存时生成 embedding，新增检索函数
- [ ] 修改 app/api/chat/route.ts 使用 RAG 检索全局上下文构建消息历史
- [ ] 在 lib/chat-config.ts 添加 embedding 和向量存储配置选项