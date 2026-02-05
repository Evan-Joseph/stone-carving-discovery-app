import os
from PIL import Image
from typing import List, Tuple
from config import SUPPORTED_FORMATS, MAX_IMAGE_SIZE


class ImageProcessor:
    """图片预处理模块"""
    
    @staticmethod
    def is_supported_format(file_path: str) -> bool:
        """检查文件是否为支持的图片格式"""
        _, ext = os.path.splitext(file_path.lower())
        return ext in SUPPORTED_FORMATS
    
    @staticmethod
    def get_image_files(directory: str) -> List[str]:
        """获取目录下所有支持的图片文件"""
        if not os.path.exists(directory):
            raise FileNotFoundError(f"目录不存在: {directory}")
        
        image_files = []
        for filename in os.listdir(directory):
            file_path = os.path.join(directory, filename)
            if os.path.isfile(file_path) and ImageProcessor.is_supported_format(file_path):
                image_files.append(file_path)
        
        return sorted(image_files)  # 按文件名字母顺序排序
    
    @staticmethod
    def preprocess_image(input_path: str, output_path: str = None) -> str:
        """
        预处理图片以优化OCR效果
        
        Args:
            input_path: 输入图片路径
            output_path: 输出图片路径，如果为None则在原路径基础上添加_processed后缀
            
        Returns:
            处理后的图片路径
        """
        try:
            # 打开图片
            with Image.open(input_path) as img:
                # 转换为RGB模式（如果是RGBA或其他模式）
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 调整图片大小（如果超过限制）
                if img.size[0] > MAX_IMAGE_SIZE[0] or img.size[1] > MAX_IMAGE_SIZE[1]:
                    img.thumbnail(MAX_IMAGE_SIZE, Image.Resampling.LANCZOS)
                
                # 确定输出路径
                if output_path is None:
                    name, ext = os.path.splitext(input_path)
                    output_path = f"{name}_processed{ext}"
                
                # 保存处理后的图片
                img.save(output_path, 'JPEG', quality=95, optimize=True)
                
                return output_path
                
        except Exception as e:
            print(f"处理图片 {input_path} 时发生错误: {e}")
            return input_path  # 返回原始路径作为后备
    
    @staticmethod
    def enhance_image_contrast(input_path: str, output_path: str = None) -> str:
        """
        增强图片对比度以改善文字识别效果
        
        Args:
            input_path: 输入图片路径
            output_path: 输出图片路径
            
        Returns:
            处理后的图片路径
        """
        try:
            with Image.open(input_path) as img:
                # 转换为RGB
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 增强对比度
                from PIL import ImageEnhance
                enhancer = ImageEnhance.Contrast(img)
                enhanced_img = enhancer.enhance(1.3)  # 增加30%对比度
                
                # 增强锐度
                sharpness_enhancer = ImageEnhance.Sharpness(enhanced_img)
                final_img = sharpness_enhancer.enhance(1.2)
                
                # 确定输出路径
                if output_path is None:
                    name, ext = os.path.splitext(input_path)
                    output_path = f"{name}_enhanced{ext}"
                
                # 保存
                final_img.save(output_path, 'JPEG', quality=95)
                
                return output_path
                
        except Exception as e:
            print(f"增强图片对比度时发生错误: {e}")
            return input_path
    
    @staticmethod
    def get_image_info(image_path: str) -> dict:
        """获取图片基本信息"""
        try:
            with Image.open(image_path) as img:
                return {
                    'width': img.width,
                    'height': img.height,
                    'mode': img.mode,
                    'format': img.format,
                    'size_mb': os.path.getsize(image_path) / (1024 * 1024)
                }
        except Exception as e:
            print(f"获取图片信息失败: {e}")
            return {}