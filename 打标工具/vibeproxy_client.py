import base64
import json
import time
from typing import Dict, Any, Optional
import requests
from config import VIBEPROXY_URL, MODEL_NAME, TIMEOUT, MAX_RETRIES


class VibeProxyClient:
    """VibeProxy Gemini3Flash 客户端封装"""
    
    def __init__(self):
        self.base_url = VIBEPROXY_URL
        self.model_name = MODEL_NAME
        self.timeout = TIMEOUT
        self.max_retries = MAX_RETRIES
    
    def _encode_image(self, image_path: str) -> str:
        """将图片编码为base64字符串"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    
    def _get_mime_type(self, image_path: str) -> str:
        ext = image_path.lower().rsplit(".", 1)[-1] if "." in image_path else ""
        if ext == "png":
            return "image/png"
        return "image/jpeg"
    
    def _make_request_gemini(self, payload: Dict[str, Any]) -> Optional[str]:
        url = f"{self.base_url}/v1/models/{self.model_name}:generateContent"
        
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    result = response.json()
                    # 提取生成的文本内容
                    if 'candidates' in result and len(result['candidates']) > 0:
                        content = result['candidates'][0].get('content', {})
                        if 'parts' in content and len(content['parts']) > 0:
                            return content['parts'][0].get('text', '')
                    return None
                    
                elif response.status_code == 429:  # 速率限制
                    if attempt < self.max_retries - 1:
                        time.sleep(2 ** attempt)  # 指数退避
                        continue
                    else:
                        print(f"API调用达到速率限制，已重试{self.max_retries}次")
                        return None
                        
                else:
                    print(f"API请求失败: {response.status_code} - {response.text}")
                    return None
                    
            except requests.exceptions.RequestException as e:
                print(f"请求异常 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                    continue
                else:
                    return None
        
        return None
    
    def _make_request_openai(self, payload: Dict[str, Any]) -> Optional[str]:
        url = f"{self.base_url}/v1/chat/completions"
        
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    result = response.json()
                    choices = result.get("choices", [])
                    if choices:
                        message = choices[0].get("message", {})
                        return message.get("content", "")
                    return None
                    
                elif response.status_code == 429:
                    if attempt < self.max_retries - 1:
                        time.sleep(2 ** attempt)
                        continue
                    else:
                        print(f"API调用达到速率限制，已重试{self.max_retries}次")
                        return None
                        
                else:
                    print(f"API请求失败: {response.status_code} - {response.text}")
                    return None
                    
            except requests.exceptions.RequestException as e:
                print(f"请求异常 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                    continue
                else:
                    return None
        
        return None
    
    def extract_text_from_image(self, image_path: str, prompt: str) -> Optional[str]:
        """
        从图片中提取文字内容
        
        Args:
            image_path: 图片文件路径
            prompt: 提示词
            
        Returns:
            提取的文字内容，如果失败返回None
        """
        try:
            # 编码图片
            image_base64 = self._encode_image(image_path)
            mime_type = self._get_mime_type(image_path)
            
            # 构造请求载荷
            gemini_payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": image_base64
                            }
                        }
                    ]
                }],
                "generation_config": {
                    "temperature": 0.1,  # 低温度确保准确性
                    "max_output_tokens": 2048
                }
            }
            openai_payload = {
                "model": self.model_name,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 2048
            }
            
            if ":8318" in self.base_url:
                return self._make_request_openai(openai_payload) or self._make_request_gemini(gemini_payload)
            return self._make_request_gemini(gemini_payload) or self._make_request_openai(openai_payload)
            
        except Exception as e:
            print(f"处理图片 {image_path} 时发生错误: {e}")
            return None
    
    def test_connection(self) -> bool:
        """测试VibeProxy连接"""
        try:
            if ":8318" in self.base_url:
                test_payload = {
                    "model": self.model_name,
                    "messages": [{"role": "user", "content": "你好"}]
                }
                response = requests.post(
                    f"{self.base_url}/v1/chat/completions",
                    headers={"Content-Type": "application/json"},
                    json=test_payload,
                    timeout=10
                )
                return response.status_code == 200
            else:
                test_payload = {
                    "contents": [{
                        "parts": [{"text": "你好"}]
                    }]
                }
                response = requests.post(
                    f"{self.base_url}/v1/models/{self.model_name}:generateContent",
                    headers={"Content-Type": "application/json"},
                    json=test_payload,
                    timeout=10
                )
                return response.status_code == 200
        except Exception as e:
            print(f"连接测试失败: {e}")
            return False
