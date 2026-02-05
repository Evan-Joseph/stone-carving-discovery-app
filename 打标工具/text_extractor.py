import os
from typing import List, Optional
from vibeproxy_client import VibeProxyClient
from image_processor import ImageProcessor
from config import EXTRACTION_PROMPT
from tqdm import tqdm


class TextExtractor:
    """核心文字提取器"""
    
    def __init__(self):
        self.vibeproxy_client = VibeProxyClient()
        self.image_processor = ImageProcessor()
    
    def extract_single_image(self, image_path: str, output_dir: str = None, 
                           preprocess: bool = True, enhance: bool = False) -> bool:
        """
        提取单张图片的文字内容
        
        Args:
            image_path: 图片路径
            output_dir: 输出目录，默认为图片同目录
            preprocess: 是否进行预处理
            enhance: 是否增强对比度
            
        Returns:
            是否成功提取
        """
        try:
            # 检查图片文件
            if not os.path.exists(image_path):
                print(f"图片文件不存在: {image_path}")
                return False
            
            if not self.image_processor.is_supported_format(image_path):
                print(f"不支持的图片格式: {image_path}")
                return False
            
            # 设置输出目录
            if output_dir is None:
                output_dir = os.path.dirname(image_path)
            
            os.makedirs(output_dir, exist_ok=True)
            
            # 获取文件名（不含扩展名）
            filename = os.path.splitext(os.path.basename(image_path))[0]
            output_path = os.path.join(output_dir, f"{filename}.txt")
            
            # 如果输出文件已存在，跳过
            if os.path.exists(output_path):
                print(f"输出文件已存在，跳过: {output_path}")
                return True
            
            # 图片预处理
            processed_image = image_path
            if preprocess:
                processed_image = self.image_processor.preprocess_image(image_path)
            
            if enhance:
                processed_image = self.image_processor.enhance_image_contrast(processed_image)
            
            # 调用VibeProxy提取文字
            print(f"正在处理: {os.path.basename(image_path)}")
            extracted_text = self.vibeproxy_client.extract_text_from_image(
                processed_image, EXTRACTION_PROMPT
            )
            
            if extracted_text:
                # 保存提取的文字
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(extracted_text.strip())
                
                print(f"成功提取并保存到: {output_path}")
                
                # 清理临时处理文件
                if processed_image != image_path:
                    try:
                        os.remove(processed_image)
                    except:
                        pass
                
                return True
            else:
                print(f"提取失败: {image_path}")
                return False
                
        except Exception as e:
            print(f"处理图片时发生错误 {image_path}: {e}")
            return False
    
    def extract_batch(self, input_dir: str, output_dir: str = None, 
                     preprocess: bool = True, enhance: bool = False) -> dict:
        """
        批量提取图片文字
        
        Args:
            input_dir: 输入图片目录
            output_dir: 输出文本目录
            preprocess: 是否预处理图片
            enhance: 是否增强对比度
            
        Returns:
            处理结果统计
        """
        # 检查输入目录
        if not os.path.exists(input_dir):
            raise FileNotFoundError(f"输入目录不存在: {input_dir}")
        
        # 获取所有图片文件
        image_files = self.image_processor.get_image_files(input_dir)
        
        if not image_files:
            print(f"在目录 {input_dir} 中未找到支持的图片文件")
            return {"total": 0, "success": 0, "failed": 0}
        
        print(f"找到 {len(image_files)} 个图片文件")
        
        # 设置默认输出目录
        if output_dir is None:
            output_dir = os.path.join(input_dir, "extracted_texts")
        
        os.makedirs(output_dir, exist_ok=True)
        
        # 连接测试
        print("测试VibeProxy连接...")
        if not self.vibeproxy_client.test_connection():
            print("警告: 无法连接到VibeProxy服务，请检查服务是否运行")
            return {"total": len(image_files), "success": 0, "failed": len(image_files)}
        
        # 批量处理
        success_count = 0
        failed_files = []
        
        print("\n开始批量提取...")
        for image_path in tqdm(image_files, desc="处理进度"):
            if self.extract_single_image(image_path, output_dir, preprocess, enhance):
                success_count += 1
            else:
                failed_files.append(os.path.basename(image_path))
        
        result = {
            "total": len(image_files),
            "success": success_count,
            "failed": len(image_files) - success_count,
            "failed_files": failed_files,
            "output_dir": output_dir
        }
        
        print(f"\n处理完成!")
        print(f"总计: {result['total']} 张图片")
        print(f"成功: {result['success']} 张")
        print(f"失败: {result['failed']} 张")
        if result['failed_files']:
            print(f"失败文件: {', '.join(result['failed_files'])}")
        print(f"输出目录: {result['output_dir']}")
        
        return result
    
    def preview_extraction(self, image_path: str) -> Optional[str]:
        """
        预览单张图片的文字提取结果（不保存）
        
        Args:
            image_path: 图片路径
            
        Returns:
            提取的文字内容
        """
        if not os.path.exists(image_path):
            print(f"图片文件不存在: {image_path}")
            return None
        
        print(f"预览提取: {os.path.basename(image_path)}")
        extracted_text = self.vibeproxy_client.extract_text_from_image(
            image_path, EXTRACTION_PROMPT
        )
        
        if extracted_text:
            print("提取结果:")
            print("-" * 50)
            print(extracted_text)
            print("-" * 50)
            return extracted_text
        else:
            print("提取失败")
            return None