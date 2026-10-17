# Stone Carving Discovery App · 石室史诗

> An interactive 3D cultural heritage discovery web app featuring virtual excavation, museum browsing, and AI-guided storytelling.  
> 围绕汉代石刻艺术打造的三维交互文化探索 Web 应用，融合数字化虚拟发掘、展厅文物导览与流式 AI 伴学问答。

<p>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/Three.js-WebGL-black.svg?style=flat-square&logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/React-18.x-61DAFB.svg?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF.svg?style=flat-square&logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Deploy-Cloudflare_Pages-F38020.svg?style=flat-square&logo=cloudflare" alt="Cloudflare Pages" />
</p>

---

## 💡 Overview

**Stone Carving Discovery App (石室史诗)** bridges traditional Chinese cultural heritage with modern web graphics and generative AI. Built around Han dynasty stone-relief carvings, the application transforms passive museum viewing into an active tactile discovery experience, enabling users to explore archaeological excavation, inspect high-resolution historical artifacts, and interact with an AI docent in real time.

---

## ✨ Key Features

- **🎮 3D Virtual Excavation**: An interactive Three.js mini-game simulating archaeological stone-carving excavation with tactile exploration and particle effects.
- **🏛️ Museum Gallery & Catalog**: Deep-dive digital archive of stone reliefs, featuring multi-angle views, rubbings, and rich historical background contexts.
- **🤖 Grounded AI Docent**: Real-time streaming conversational agent providing contextual explanations, referenced citations to specific artifact cards, and markdown rendering.
- **📄 Interactive Source Document Reader**: Embedded document viewer linking highlighted historical texts directly to relevant 3D artifacts.
- **📱 Responsive Exhibition Mode**: Optimized for desktop monitors, exhibition touch kiosks, and mobile browsers with Service Worker offline caching.

---

## 🛠️ Tech Stack & Architecture

```text
stone-carving-discovery-app/
├── app/                  # Main web application (React + Vite + TypeScript)
│   ├── src/
│   │   ├── components/   # 3D Canvas, Excavation Scene, AI Chat, Artifact Cards
│   │   ├── hooks/        # Audio playback, AI stream handlers, Touch listeners
│   │   └── data/         # Structured artifact JSON catalog and offline embeddings
├── 打标工具/              # Python data pipeline utilities for asset extraction and preprocessing
```

| Layer | Technologies |
|---|---|
| **Frontend Framework** | React 18 + Vite 5 + TypeScript 5 |
| **3D Rendering** | Three.js (WebGL, Shader material, Orbit controls) |
| **Styling & Motion** | Tailwind CSS + Framer Motion |
| **AI Integration** | Server-Sent Events (SSE) streaming API with fallback local retrieval |
| **Data Processing** | Python (Pillow, OCR, metadata extraction scripts) |

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Evan-Joseph/stone-carving-discovery-app.git
cd stone-carving-discovery-app/app

# Install dependencies
pnpm install
```

### 2. Run Locally

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Build for Production

```bash
pnpm build
```

---

## 📄 License

This repository is licensed under the [MIT License](./LICENSE).
