# 石刻文化发现应用（开发版）

## 快速开始

```bash
cd app
python3 scripts/build_artifacts.py
npm install
npm run dev:server
# 新开一个终端
npm run dev
```

## 当前已实现

- 首页 / 发掘 / 文物库 / 文物详情 / AI导游 / 展厅模式 路由
- 基于本地资料自动生成 `src/data/artifacts.json`
- 发掘页升级为 Three.js 单窗流程（先选→再挖→欣赏），完整土层包裹、随机土块点击掉落、4-6次轻触完成
- 发掘流程支持盲盒随机、单件欣赏后再开下一件
- 发掘页支持「AI许愿抽盲盒」（走后端 `/api/ai/wish`，失败自动降级本地关键词匹配）
- 发掘页支持手机体感视角（DeviceOrientation，含 iOS 手动授权兜底）
- AI 导游支持「全馆问询/展品问询」双模式，展品详情支持即时问询
- AI 问答支持流式增量显示，回答 Markdown（标题/引用/列表/代码块）会被解析渲染
- AI 问答新增“模型驱动推荐与引用”：可根据提问返回相关展品图卡（1-3个）与回答依据片段
- 现已支持“答案内嵌展品卡片标记”解析：`[展品卡片:artifact-xxx|说明]` 会在对应段落就地渲染卡片
- AI 问答增强健壮性：后端会校验展品卡片引用ID（非法ID自动清洗），并在推荐类问题按候选匹配补充卡片标记
- AI 聊天记录支持本地留存（最近会话 + 7天有效期），刷新后可继续对话；输入支持 Enter 发送、Shift+Enter 换行
- 新增图片性能链路：构建阶段生成 WebP 缩略图/中图，前端 `picture + srcset` 自适应加载
- 新增 PDF 阅读页：页码跳转、展品详情直达 PDF、PDF 本页反向跳展品；移动端改为 PDF.js Canvas 即时预览
- 新增展厅模式：横屏单页整合展品陈列、书籍阅读、AI问询
- 展厅模式列表加入虚拟滚动，长列表横屏渲染更稳定
- 响应式专项：竖屏优先、低高度横屏压缩布局、馆内大屏断点优化
- 视觉主题增强：支持系统暗黑模式并优化文本/按钮/卡片对比度
- 新增 Service Worker 缓存：静态资源与 `/materials/*` 素材离线可复用，减少刷新重复加载
- 构建包体优化：PDF 预览引擎改为按需加载，并进行更细粒度 vendor 分包

## 缓存说明

- 生产环境默认启用 Service Worker（`public/sw.js`）。
- 开发环境默认关闭，避免影响热更新；如需测试缓存，可在 `.env` 中设置：

```bash
VITE_ENABLE_SW_IN_DEV=true
```

## 后端 AI 接入（BigModel / GLM-4.7-Flash）

1. 复制配置模板并填写真实密钥（仅后端保存）：

```bash
cp server/.env.example server/.env
```

2. 启动后端：

```bash
npm run dev:server
```

3. 再启动前端（开发环境会把 `/api/*` 代理到 `127.0.0.1:8787`）：

```bash
npm run dev
```

4. 可用健康检查：

```bash
curl http://127.0.0.1:8787/api/ai/health
```

已实现接口：
- `POST /api/ai/chat`
- `POST /api/ai/chat-stream`（流式增量返回，NDJSON）
- `POST /api/ai/enrich`（基于模型生成推荐展品与引用依据）
- `POST /api/ai/wish`

可选调优参数（`server/.env`）：
- `AI_HISTORY_MAX_ITEMS`：送入模型的历史消息条数上限
- `AI_HISTORY_ITEM_MAX_CHARS`：单条历史消息截断长度

## 局域网手机访问（MacBook）

- 前端 Vite 已配置 `host: true`，后端 AI 服务监听 `0.0.0.0:8787`
- 前端开发端口固定为 `5173`（`strictPort: true`，被占用会直接报错而不是悄悄换端口）
- 启动：
  - 终端1：`npm run dev:server`
  - 终端2：`npm run dev:lan`（或 `npm run dev`）
- 查 Mac 局域网 IP：`ifconfig | awk '/inet / {print $2}'`
- 手机访问：`http://<Mac局域网IP>:5173`
- 若手机无法访问，检查 macOS 防火墙是否允许 Node/Vite 入站连接

## 数据来源

- `相关材料/来自武氏墓群石刻博物馆/展品图片`
- `相关材料/来自武氏墓群石刻博物馆/展品信息图片`
- `相关材料/来自《鲁迅藏汉画珍赏》/章节（一）武氏祠汉画-逐页介绍`
- `相关材料/PDF与展品信息双向索引.md`

> 说明：`public/materials/raw` 是到 `../相关材料` 的符号链接，便于开发阶段直接预览本地素材。
