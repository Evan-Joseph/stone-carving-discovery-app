#!/usr/bin/env python3
"""Build structured artifact data from local museum materials."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List
from urllib.parse import quote

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = ROOT / "app"
MATERIALS = ROOT / "相关材料"
MUSEUM = MATERIALS / "来自武氏墓群石刻博物馆"
BOOK = MATERIALS / "来自《鲁迅藏汉画珍赏》"
BOOK_PDF = BOOK / "章节（一）武氏祠汉画.pdf"

MODEL_DIR = MUSEUM / "展品图片"
INFO_IMAGE_DIR = MUSEUM / "展品信息图片"
INFO_TEXT_DIR = INFO_IMAGE_DIR / "提取文字"
PAGE_TEXT_DIR = BOOK / "章节（一）武氏祠汉画-逐页介绍"
INDEX_MD = MATERIALS / "PDF与展品信息双向索引.md"
OUTPUT = APP_ROOT / "src" / "data" / "artifacts.json"
MODEL_CACHE_DIR = APP_ROOT / "public" / "generated" / "models"
INFO_CACHE_DIR = APP_ROOT / "public" / "generated" / "info"
MAX_INLINE_PDF_SIZE = 25 * 1024 * 1024

ROW_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|")
RESAMPLING = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


def encode_url_path(*parts: str) -> str:
    clean = [quote(part, safe="") for part in parts]
    return "/" + "/".join(clean)


def parse_pages(raw: str) -> List[int]:
    if "无直接对应" in raw:
        return []

    values: List[int] = []
    for token in re.findall(r"\d+\s*-\s*\d+|\d+", raw):
        if "-" in token:
            start_str, end_str = re.split(r"\s*-\s*", token)
            start, end = int(start_str), int(end_str)
            if start <= end:
                values.extend(range(start, end + 1))
        else:
            values.append(int(token))

    return sorted(set(values))


def infer_series(name: str) -> str:
    if name.startswith("武梁祠") or name.startswith("祥瑞图"):
        return "武梁祠系列"
    if name.startswith("前石室") or name.startswith("另一个前石室") or name.startswith("孔门弟子"):
        return "前石室系列"
    if name.startswith("后石室") or name.startswith("另一个后石室"):
        return "后石室系列"
    if name.startswith("左石室"):
        return "左石室系列"
    if name.endswith("介绍牌") or name.endswith("简介"):
        return "展厅介绍"
    return "其他石刻系列"


def parse_mapping() -> Dict[str, dict]:
    mapping: Dict[str, dict] = {}
    current_series = "其他石刻系列"
    in_first_section = False

    for line in INDEX_MD.read_text(encoding="utf-8").splitlines():
        if line.startswith("## 一、"):
            in_first_section = True
            continue
        if line.startswith("## 二、"):
            in_first_section = False
            break
        if not in_first_section:
            continue

        if line.startswith("### "):
            current_series = line.replace("### ", "").strip()
            continue

        matched = ROW_RE.match(line)
        if not matched:
            continue

        filename, page_text, topic = matched.groups()
        name = Path(filename.strip()).stem
        mapping[name] = {
            "series": current_series,
            "pages": parse_pages(page_text),
            "pdfTopic": topic.strip() if topic.strip() != "-" else ""
        }

    return mapping


def parse_book_pages() -> Dict[int, dict]:
    pages: Dict[int, dict] = {}
    for path in sorted(PAGE_TEXT_DIR.glob("第*页.txt")):
        match = re.search(r"第(\d+)页", path.stem)
        if not match:
            continue
        page_no = int(match.group(1))
        content = path.read_text(encoding="utf-8").strip()
        title_match = re.search(r"^###\s+(.+)$", content, re.MULTILINE)
        pages[page_no] = {
            "title": title_match.group(1).strip() if title_match else "",
            "content": content
        }
    return pages


def extract_tags(info_text: str, series: str) -> List[str]:
    tags = {series}
    for piece in re.findall(r"【([^】]+)】", info_text):
        for token in re.split(r"[、，/\s]+", piece):
            token = token.strip("（）。()")
            if token:
                tags.add(token)
    return sorted(tags)


def prepare_cache_dirs() -> None:
    for cache_dir in (MODEL_CACHE_DIR, INFO_CACHE_DIR):
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)


def build_webp_variants(model_file: Path, artifact_id: str) -> Dict[str, str]:
    if not model_file.exists():
        return {"thumb": "", "large": ""}

    thumb_name = f"{artifact_id}-320.webp"
    large_name = f"{artifact_id}-720.webp"
    thumb_path = MODEL_CACHE_DIR / thumb_name
    large_path = MODEL_CACHE_DIR / large_name

    try:
        with Image.open(model_file) as raw:
            image = raw.convert("RGBA")

            thumb = image.copy()
            thumb.thumbnail((320, 320), RESAMPLING)
            thumb.save(thumb_path, format="WEBP", quality=82, method=6)

            large = image.copy()
            large.thumbnail((720, 720), RESAMPLING)
            large.save(large_path, format="WEBP", quality=84, method=6)
    except Exception:
        return {"thumb": "", "large": ""}

    return {
        "thumb": encode_url_path("generated", "models", thumb_name),
        "large": encode_url_path("generated", "models", large_name)
    }


def build_info_variant(info_file: Path, artifact_id: str) -> str:
    if not info_file.exists():
        return ""

    info_name = f"{artifact_id}-1280.webp"
    info_path = INFO_CACHE_DIR / info_name
    try:
        with Image.open(info_file) as raw:
            image = raw.convert("RGB")
            image.thumbnail((1280, 1280), RESAMPLING)
            image.save(info_path, format="WEBP", quality=86, method=6)
    except Exception:
        return ""

    return encode_url_path("generated", "info", info_name)


def build() -> dict:
    mapping = parse_mapping()
    page_map = parse_book_pages()
    pdf_total_pages = max(page_map.keys(), default=0)
    prepare_cache_dirs()

    model_names = {path.stem for path in MODEL_DIR.glob("*.png")}
    info_names = {path.stem for path in INFO_IMAGE_DIR.glob("*.jpg")}
    text_names = {path.stem for path in INFO_TEXT_DIR.glob("*.txt")}

    all_names = sorted(model_names | info_names | text_names)
    artifacts = []

    for index, name in enumerate(all_names, start=1):
        artifact_id = f"artifact-{index:03d}"
        model_file = MODEL_DIR / f"{name}.png"
        info_image_file = INFO_IMAGE_DIR / f"{name}.jpg"
        info_text_file = INFO_TEXT_DIR / f"{name}.txt"
        webp = build_webp_variants(model_file, artifact_id)
        info_webp = build_info_variant(info_image_file, artifact_id)

        mapping_item = mapping.get(name, {})
        pages = mapping_item.get("pages", [])
        series = mapping_item.get("series", "") or infer_series(name)
        info_text = info_text_file.read_text(encoding="utf-8").strip() if info_text_file.exists() else ""

        linked_pdf = []
        for page in pages:
            text_info = page_map.get(page, {})
            linked_pdf.append(
                {
                    "page": page,
                    "title": text_info.get("title", ""),
                    "content": text_info.get("content", "")
                }
            )

        artifacts.append(
            {
                "id": artifact_id,
                "name": name,
                "series": series,
                "modelImage": encode_url_path(
                    "generated",
                    "models",
                    f"{artifact_id}-720.webp"
                )
                if webp["large"]
                else webp["thumb"],
                "modelImageThumb": webp["thumb"],
                "modelImageLarge": webp["large"],
                "infoImage": info_webp,
                "infoText": info_text,
                "pdfPages": pages,
                "pdfTopic": mapping_item.get("pdfTopic", ""),
                "linkedPdf": linked_pdf,
                "tags": extract_tags(info_text, series)
            }
        )

    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "totalArtifacts": len(artifacts),
        "pdfSource": encode_url_path("materials", "raw", "来自《鲁迅藏汉画珍赏》", "章节（一）武氏祠汉画.pdf")
        if BOOK_PDF.exists() and BOOK_PDF.stat().st_size <= MAX_INLINE_PDF_SIZE
        else "",
        "pdfTotalPages": pdf_total_pages,
        "artifacts": artifacts
    }


def main() -> None:
    dataset = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {dataset['totalArtifacts']} artifacts -> {OUTPUT}")


if __name__ == "__main__":
    main()
