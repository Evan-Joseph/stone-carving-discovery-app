# Stone Carving Discovery App

Interactive stone-carving culture discovery app with museum browsing, 3D excavation, AI guide, PDF reading, and offline-friendly assets.

The repository contains two parts:

- `app/`: Vite + React + TypeScript web application.
- `打标工具/`: Python utilities for extracting text, images, and structured artifact data from source materials.

Local source materials are intentionally excluded from Git. Generated public assets and private cultural-material collections should be kept outside the repository unless they are explicitly cleared for publication.

## Features

- Museum-style artifact browsing and artifact detail pages.
- Three.js excavation interaction for blind-box style artifact discovery.
- AI guide with whole-museum and artifact-specific Q&A.
- Streamed AI responses with Markdown rendering and artifact-card references.
- PDF reading workflow with page navigation and artifact-to-PDF linking.
- Responsive layout for mobile, desktop, and exhibition-display use.
- Service Worker support for selected static assets.

## Quick Start

```bash
cd app
python3 scripts/build_artifacts.py
npm install
npm run dev:server
```

Open another terminal:

```bash
cd app
npm run dev
```

## Environment

Backend AI calls use BigModel/GLM-compatible credentials. Copy the example file and set the real key locally:

```bash
cd app
cp server/.env.example server/.env
```

Do not commit `app/.env`, `app/server/.env`, generated materials, or local source archives.

## Useful Commands

```bash
cd app
npm run check
npm run build
npm run gen:data
```

## Data Workflow

The Python tools under `打标工具/` support OCR/text extraction and artifact metadata preparation. The app consumes generated artifact data from `app/src/data/artifacts.json`.

Large local material directories are ignored by `.gitignore`:

- `相关材料/`
- `开发资料/`
- `app/public/materials/`
