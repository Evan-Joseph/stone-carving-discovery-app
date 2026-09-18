# 石刻文化发现应用（重构版）

## 快速开始

```bash
cd app
python3 scripts/build_artifacts.py
npm install

# 终端1：启动本地 AI 服务（读取 server/.env）
cp server/.env.example server/.env
npm run dev:server

# 终端2：启动前端
npm run dev
```

## 本次重构完成项

- AI 导游界面简化为消费级交互：仅保留对话历史、输入框、发送按钮、拍照按钮。
- 移除用户可见的“全馆/展品模式切换”，改为后端自动意图识别。
- 首页新增“一步发问”入口：可直接输入问题并跳转到 AI 会话自动发问。
- AI 聊天图片附件持久化：刷新后仍可显示，支持容量控制和降级策略。
- AI 供应商迁移到 SiliconFlow，默认文本模型改为 `deepseek-ai/DeepSeek-V4-Flash`，视觉模型改为 `Qwen/Qwen3-VL-32B-Instruct`。
- 联网搜索改为博查（Bocha），由后端按意图自动触发。
- 拍照识别链路升级：
  - 前端先做非 LLM 图像相似候选召回（dHash + 汉明距离）。
  - 后端将候选 + 图片交给 VLM 识别与讲解。
  - 支持用户纠错（例如“不是这个，是XX”）后重答。

## AI 架构（当前）

### 1) 前端（低负担交互）

- `src/pages/AiGuidePage.tsx`
  - 单入口自然对话。
  - 支持首页 `q` 参数自动发问。
- `src/pages/HomePage.tsx`
  - 首页内置问题输入入口，直接进入 AI 会话。
- `src/lib/chatAttachmentStore.ts`
  - 主存储：IndexedDB（上限 24MB，最多 80 项，LRU+TTL 清理）。
  - 降级：localStorage 小缓存（约 1.2MB，最多 6 项）。
- `src/lib/visionRecall.ts`
  - 本地图像相似候选召回（非 LLM）。

### 2) 后端（自动路由 + 工具编排）

- `functions/api/ai/routing.ts`
  - 自动意图识别（展品/全馆、是否联网、上下文继承）。
  - 纠错语句识别。
- `functions/api/ai/bocha.ts`
  - Bocha 搜索调用与结果标准化。
- `functions/api/ai/_shared.ts`
  - 编排入口 `prepareChatRequest`：
    - grounding（候选召回）
    - intent routing（自动判别）
    - web tool（博查）
    - prompt 组装（文本模型 / 视觉模型）

## 服务端配置

在 `server/.env`（本地）或 Cloudflare Pages 环境变量中配置：

```bash
# 必填
SILICONFLOW_API_KEY=

# 可选（有默认值）
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V4-Flash
SILICONFLOW_VLM_MODEL=Qwen/Qwen3-VL-32B-Instruct

# 博查联网搜索（推荐）
BOCHA_API_KEY=
BOCHA_BASE_URL=https://api.bochaai.com
BOCHA_SEARCH_COUNT=5
BOCHA_TIMEOUT_MS=12000
AI_ENABLE_WEB_SEARCH=true

# 通用
AI_MAX_RETRIES=3
AI_TIMEOUT_MS=45000
AI_HISTORY_MAX_ITEMS=10
AI_HISTORY_ITEM_MAX_CHARS=800
```

## 关键接口

- `POST /api/ai/chat`
- `POST /api/ai/chat-stream`（NDJSON 流式）
- `POST /api/ai/enrich`
- `POST /api/ai/wish`
- `GET /api/ai/health`

`chat/chat-stream` 支持字段（节选）：

- `question`
- `artifactId` / `artifactName` / `contextText`（可选上下文提示）
- `imageDataUrl`（拍照）
- `visionCandidates`（前端非 LLM 候选召回）
- `history`

## 迁移说明（BigModel -> SiliconFlow）

- 已完成默认提供商切换，BigModel 变量仅做兼容回退。
- 新部署请使用 `SILICONFLOW_*` + `BOCHA_*`。
- UI 已移除专业模式开关，改为自动意图识别。

## 可执行验证

```bash
npm run check
npm run build
```

健康检查：

```bash
curl http://127.0.0.1:8787/api/ai/health
```

## 数据来源

- `相关材料/来自武氏墓群石刻博物馆/展品图片`
- `相关材料/来自武氏墓群石刻博物馆/展品信息图片`
- `相关材料/来自《鲁迅藏汉画珍赏》/章节（一）武氏祠汉画-逐页介绍`
- `相关材料/PDF与展品信息双向索引.md`
