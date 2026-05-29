# Stone Carving Discovery App / 石室史诗

Interactive stone-carving culture discovery app with museum browsing, 3D excavation, AI guide, PDF reading, and offline-friendly assets.

This repository is a public showcase version of a China Collegiate Computing Contest project. It focuses on the engineering implementation and reproducible app structure; local source archives and non-public cultural-material collections are intentionally excluded.

## Project Highlights

- Built an interactive cultural-heritage web app around Han stone-relief artifacts, museum browsing, artifact detail pages, AI-guided explanation, and exhibition-display scenarios.
- Implemented a Three.js excavation interaction that turns artifact discovery into a lightweight blind-box style exploration flow.
- Added artifact-grounded AI Q&A with streamed responses, Markdown rendering, artifact-card references, and fallback local retrieval.
- Built a PDF reading workflow with page navigation and artifact-to-document linking.
- Added a Python data preparation workflow for extracting text, images, and structured artifact metadata from local materials.
- Optimized the app for mobile, desktop, and exhibition screens, with selected static assets cached by a Service Worker.

## My Role

- Led most of the web application development, interaction design, and AI-assisted coding workflow.
- Built the frontend routes, artifact browsing flow, Three.js excavation page, AI guide interaction, PDF reading workflow, and responsive exhibition mode.
- Prepared project presentation materials and demonstration flow for competition use.

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
