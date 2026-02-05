import argparse
import os
from typing import Optional, List
from tqdm import tqdm
from vibeproxy_client import VibeProxyClient
from config import PAGE_INTRO_PROMPT

try:
    import fitz
except ImportError:
    fitz = None


class PDFPageExtractor:
    def __init__(self):
        self.client = VibeProxyClient()
    
    def _render_page_to_image(self, pdf_path: str, page_index: int, dpi: int = 300) -> Optional[str]:
        if fitz is None:
            print("缺少依赖: PyMuPDF 未安装。请安装 `pip install PyMuPDF`")
            return None
        try:
            doc = fitz.open(pdf_path)
            page = doc.load_page(page_index)
            zoom = dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img_path = f"{os.path.splitext(pdf_path)[0]}_page_{page_index+1}.png"
            pix.save(img_path)
            doc.close()
            return img_path
        except Exception as e:
            print(f"渲染PDF页面失败: {e}")
            return None
    
    def extract_page_intros(self, pdf_path: str, output_dir: Optional[str] = None, dpi: int = 300) -> dict:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF不存在: {pdf_path}")
        if output_dir is None:
            output_dir = os.path.join(os.path.dirname(pdf_path), "page_texts")
        os.makedirs(output_dir, exist_ok=True)
        
        if fitz is None:
            return {"total": 0, "success": 0, "failed": 0, "output_dir": output_dir}
        
        doc = fitz.open(pdf_path)
        total_pages = doc.page_count
        doc.close()
        
        prev_summary = ""
        success = 0
        failed_pages: List[int] = []
        
        for i in tqdm(range(total_pages), desc="处理进度"):
            out_path = os.path.join(output_dir, f"第{i+1}页.txt")
            if os.path.exists(out_path):
                with open(out_path, "r", encoding="utf-8") as f:
                    existing_text = f.read().strip()
                lines = [line.strip() for line in existing_text.splitlines() if line.strip()]
                summary_line = ""
                for line in lines:
                    if not line.startswith("#"):
                        summary_line = line
                        break
                if summary_line:
                    prev_summary = summary_line[:200]
                success += 1
                continue
            
            img_path = self._render_page_to_image(pdf_path, i, dpi=dpi)
            if not img_path:
                failed_pages.append(i + 1)
                continue
            
            prompt = PAGE_INTRO_PROMPT.format(
                page_number=i + 1,
                total_pages=total_pages,
                previous_summary=prev_summary
            )
            text = self.client.extract_text_from_image(img_path, prompt)
            try:
                os.remove(img_path)
            except:
                pass
            
            if text:
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(text.strip())
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                summary_line = ""
                for line in lines:
                    if not line.startswith("#"):
                        summary_line = line
                        break
                if summary_line:
                    prev_summary = summary_line[:200]
                success += 1
            else:
                failed_pages.append(i + 1)
        
        return {
            "total": total_pages,
            "success": success,
            "failed": total_pages - success,
            "failed_pages": failed_pages,
            "output_dir": output_dir
        }


def main():
    parser = argparse.ArgumentParser(description="PDF逐页介绍生成工具")
    parser.add_argument("pdf_path", help="输入PDF路径")
    parser.add_argument("-o", "--output", help="输出目录路径")
    parser.add_argument("--dpi", type=int, default=300, help="渲染DPI")
    args = parser.parse_args()
    
    extractor = PDFPageExtractor()
    result = extractor.extract_page_intros(args.pdf_path, args.output, args.dpi)
    if result["failed"] > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
