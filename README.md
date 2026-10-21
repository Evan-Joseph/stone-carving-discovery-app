# 石刻文化发现应用 (Stone Carving Discovery App)

<p align="center">
  <b>鲁西南汉画像石数字化研学、Three.js 模拟发掘与多模态 AI 导览 Web 应用</b><br>
  Interactive Han Stone-Relief Discovery Web App with 3D Blind-Box Excavation, Visual Recall &amp; PDF Cross-Indexing
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Three.js-0.182-black?logo=threedotjs" alt="Three.js">
  <img src="https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/PDF.js-5.4-EC1C24?logo=adobeacrobatreader&logoColor=white" alt="PDF.js">
  <img src="https://img.shields.io/badge/Cloudflare_Pages-Edge_Functions-F38020?logo=cloudflarepages&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT">
</p>

---

## 界面总览

| 汉画像石数字展厅首页 (`/`) | Three.js 模拟考古发掘 (`/excavate`) |
| :---: | :---: |
| <img src="assets/screenshots/01_home.png" width="460" alt="首页发现视图" /> | <img src="assets/screenshots/02_excavate.png" width="460" alt="Three.js 模拟考古发掘" /> |
| 汇总嘉祥武氏墓群石刻博物馆等鲁西南三馆 76 件汉画像石展品，支持一步发问直达 AI 导游与今日推荐导读。 | 基于 Three.js 构建单窗盲盒式土层敲凿交互，支持按石室系列抽取或输入关键词由 AI 匹配目标展品。 |

| 横屏三栏展厅模式 (`/hall`) | 展品考据与文献双向索引 (`/artifact/:id`) |
| :---: | :---: |
| <img src="assets/screenshots/03_hall.png" width="460" alt="横屏三栏展厅模式" /> | <img src="assets/screenshots/04_artifact_detail.png" width="460" alt="展品详情与文献考据" /> |
| 面向桌面与展厅大屏的一屏三栏布局，左侧检索展品陈列，中栏切换官方展签、书籍摘录与关联 PDF，右栏联动 AI 问询。 | 展示高清汉画像石拓片与实拍图，支持显微探照观察、中英双语分层叙事考据及《鲁迅藏汉画珍赏》页码直跳。 |

| 多模态 AI 导游对话 (`/ai-guide`) | 三馆分类文物库 (`/collection`) |
| :---: | :---: |
| <img src="assets/screenshots/05_ai_guide.png" width="460" alt="AI 导游对话" /> | <img src="assets/screenshots/06_collection.png" width="460" alt="三馆分类文物库" /> |
| 支持文本问答与拍照识图，回复内嵌可交互展品卡片，聊天图片附件通过 IndexedDB 本地持久化缓存。 | 支持按场馆（武氏墓群 / 济宁市博 / 巨野县博）、石室系列（武梁祠 / 前石室 / 后石室 / 左石室）与发掘状态过滤。 |

---

## 项目简介

**石刻文化发现应用（石室史诗）** 是面向汉代画像石文化遗产数字化传播与研学导览开发的 Web 应用（中国高校计算机大赛参赛作品公开演示仓库）。

针对传统文博数字化展陈中静态图文信息密度高、普通观众难以读懂汉画分层叙事构图的问题，系统将 **武氏墓群石刻博物馆（武氏祠汉画）** 展签与 **《鲁迅藏汉画珍赏》** 文献建立双向页码索引，串联起「盲盒模拟发掘 → 拓片显微探照与分层考据 → PDF 原典对照阅读 → 多模态拍照识图与 AI 导览」的完整研学链路。

### 核心工程特性

1. **Three.js 盲盒式考古发掘 (`src/pages/ExcavationPage.tsx`)**：基于 Three.js 构建封土层网格击碎与掉落物理反馈，结合 Web Audio 金石敲击音效与印章入藏动效（GSAP），支持按石室系列抽取或输入主题词（如“刺秦”“车骑出行”）由大模型匹配对应石刻。
2. **前端非 LLM 视觉召回 + VLM 识图讲解 (`src/lib/visionRecall.ts`)**：用户上传或拍摄石刻照片后，前端首先通过差分哈希（dHash）与汉明距离计算本地 76 件展品的视觉相似候选Top-K，再将候选上下文与图片一并提交至视觉语言模型（`Qwen3-VL-32B-Instruct`），降低纯大模型盲猜幻觉率。
3. **自动意图路由与联网检索编排 (`functions/api/ai/`)**：服务端（兼容本地 Node Server 与 Cloudflare Pages Functions）自动判别单件展品深读、全馆横向对比或纠错追问意图，按需触发博查（Bocha Web Search）补充学术背景，并通过 NDJSON 流式返回携带 `[展品卡片:artifact-id]` 标记的富文本回答。
4. **文献与展品双向索引 (`src/pages/PdfReaderPage.tsx`)**：基于 `pdfjs-dist` 实现在线文献阅读器，建立石刻展品与《鲁迅藏汉画珍赏》对应页码的双向跳转。
5. **离线友好缓存架构 (`src/lib/chatAttachmentStore.ts` & `public/sw.js`)**：聊天图片附件采用 IndexedDB 主存储（24MB 配额、LRU+TTL 淘汰）与 `localStorage` 降级双层设计，静态石刻 WebP 图像由 Service Worker 缓存。

---

## 目录结构

```text
stone-carving-discovery-app/
├── app/                            # 前端与边缘服务端主工程 (Vite + React 18 + TypeScript)
│   ├── functions/api/ai/           # Cloudflare Pages Functions 服务端 AI 路由与博查搜索编排
│   ├── public/                     # WebP 多分辨率石刻模型/展签图集与 Service Worker
│   ├── scripts/                    # 展品元数据构建脚本 (build_artifacts.py)
│   ├── server/                     # 本地开发 Node AI 代理服务 (index.mjs)
│   └── src/
│       ├── components/             # Three.js 发掘画布、拓片显微探照弹窗、Markdown 展品卡片渲染器
│       ├── data/                   # 结构化汉画像石数据集 (artifacts.json，共 76 件展品)
│       ├── lib/                    # dHash 视觉召回、IndexedDB 附件存储、流式 AI 客户端
│       └── pages/                  # 首页、模拟发掘、三栏展厅、展品详情、AI 导游、PDF 阅读器、文物库
├── 打标工具/                        # Python 离线数据整理与图文提取工具链
└── assets/screenshots/             # 实机运行界面截图
```

---

## 快速开始

### 1. 安装依赖与构建展品索引

```bash
git clone https://github.com/Evan-Joseph/stone-carving-discovery-app.git
cd stone-carving-discovery-app/app
python3 scripts/build_artifacts.py
npm install
```

### 2. 配置环境变量

复制服务端环境变量模板并填入 API Key（默认使用 SiliconFlow 接口，兼容 OpenAI / 智谱 GLM 协议）：

```bash
cp server/.env.example server/.env
```

`server/.env` 主要配置项：

```ini
SILICONFLOW_API_KEY=your_api_key_here
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V4-Flash
SILICONFLOW_VLM_MODEL=Qwen/Qwen3-VL-32B-Instruct

# 可选：启用博查联网搜索增强
BOCHA_API_KEY=your_bocha_key_here
AI_ENABLE_WEB_SEARCH=true
```

### 3. 启动本地开发服务

```bash
# 终端 1：启动本地 AI 接口服务 (默认监听 127.0.0.1:8787)
npm run dev:server

# 终端 2：启动 Vite 前端开发服务器 (默认监听 http://localhost:5173)
npm run dev
```

### 4. 类型检查与生产构建

```bash
npm run check
npm run build
```

---

## 数据来源与致谢

- 展品图像与展签考据整理自 **武氏墓群石刻博物馆**、**济宁市博物馆**、**巨野县博物馆** 公开陈列资料。
- 文献索引参考 **《鲁迅藏汉画珍赏》**（第一章：武氏祠汉画逐页介绍）。
- 仓库仅包含工程代码与经压缩处理的公开演示缩略图，原始高精度扫描档案与未公开馆藏资料已通过 `.gitignore` 排除。

---

## 开源许可

本项目采用 [MIT License](LICENSE) 开源。
