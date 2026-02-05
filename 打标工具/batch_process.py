#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量处理脚本示例
可以直接运行此脚本来处理指定目录的展品图片
"""

import os
from text_extractor import TextExtractor

def batch_process_sample():
    """批量处理示例函数"""
    
    # 设置输入输出路径
    input_directory = "./samples"  # 存放示品图片的目录
    output_directory = "./output"  # 输出文本的目录
    
    # 创建输出目录
    os.makedirs(output_directory, exist_ok=True)
    
    print("=== 展品图片文字提取工具 ===")
    print(f"输入目录: {input_directory}")
    print(f"输出目录: {output_directory}")
    print()
    
    # 初始化提取器
    extractor = TextExtractor()
    
    try:
        # 执行批量处理
        result = extractor.extract_batch(
            input_dir=input_directory,
            output_dir=output_directory,
            preprocess=True,    # 启用预处理
            enhance=False       # 不启用对比度增强（可根据需要调整）
        )
        
        print("\n=== 处理结果 ===")
        print(f"总共处理: {result['total']} 张图片")
        print(f"成功提取: {result['success']} 张")
        print(f"处理失败: {result['failed']} 张")
        
        if result['failed_files']:
            print(f"失败文件列表:")
            for filename in result['failed_files']:
                print(f"  - {filename}")
        
        print(f"\n提取的文本文件保存在: {result['output_dir']}")
        
    except Exception as e:
        print(f"批量处理过程中发生错误: {e}")

if __name__ == "__main__":
    batch_process_sample()