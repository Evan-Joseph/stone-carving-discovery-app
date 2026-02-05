#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
展品图片文字提取工具主程序
使用VibeProxy Gemini3Flash进行图片文字提取
"""

import argparse
import os
import sys
from text_extractor import TextExtractor


def main():
    parser = argparse.ArgumentParser(description='展品图片文字提取工具')
    parser.add_argument('input_path', help='输入图片文件或目录路径')
    parser.add_argument('-o', '--output', help='输出目录路径')
    parser.add_argument('--no-preprocess', action='store_true', 
                       help='禁用图片预处理')
    parser.add_argument('--enhance', action='store_true',
                       help='启用图片对比度增强')
    parser.add_argument('--preview', action='store_true',
                       help='预览模式（不保存结果）')
    
    args = parser.parse_args()
    
    # 初始化提取器
    extractor = TextExtractor()
    
    # 检查输入路径
    if not os.path.exists(args.input_path):
        print(f"错误: 输入路径不存在: {args.input_path}")
        sys.exit(1)
    
    try:
        if os.path.isfile(args.input_path):
            # 单文件处理
            if args.preview:
                # 预览模式
                extractor.preview_extraction(args.input_path)
            else:
                # 正常提取
                success = extractor.extract_single_image(
                    args.input_path,
                    args.output,
                    not args.no_preprocess,
                    args.enhance
                )
                if success:
                    print("处理完成!")
                else:
                    print("处理失败!")
                    sys.exit(1)
                    
        elif os.path.isdir(args.input_path):
            # 目录批量处理
            if args.preview:
                print("预览模式不支持目录处理")
                sys.exit(1)
                
            result = extractor.extract_batch(
                args.input_path,
                args.output,
                not args.no_preprocess,
                args.enhance
            )
            
            if result['failed'] > 0:
                sys.exit(1)
        else:
            print(f"错误: 输入路径既不是文件也不是目录: {args.input_path}")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n用户中断操作")
        sys.exit(1)
    except Exception as e:
        print(f"处理过程中发生错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()