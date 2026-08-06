import http.server, json, base64, io, sys, os

MODEL_PATH = os.environ.get('VLM_MODEL', 'vlm/SmolVLM2-256M-Video-Instruct-Q8_0.gguf')
MMPROJ_PATH = os.environ.get('VLM_MMPROJ', 'vlm/mmproj-SmolVLM2-256M-Video-Instruct-Q8_0.gguf')

llm = None

def init_model():
    global llm
    if llm is not None:
        return
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import MTMDChatHandler
    
    handler = MTMDChatHandler(clip_model_path=MMPROJ_PATH)
    llm = Llama(
        model_path=MODEL_PATH,
        chat_handler=handler,
        n_ctx=2048,
        n_threads=4,
        verbose=False
    )
    print(f"Model loaded: {MODEL_PATH}")

def recognize_keypad(img_b64, keys):
    init_model()
    
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(base64.b64decode(img_b64))
        tmp_path = f.name
    
    prompt = "Look at this keyboard image. Each key has an English letter (a-z) or digit (0-9). Return ONLY a JSON object mapping each character to its index: {\"a\":0,\"b\":1,...}. Skip keys with logos or symbols. No explanation."
    
    resp = llm.create_chat_completion(
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": "file://" + tmp_path}},
                {"type": "text", "text": prompt}
            ]
        }],
        max_tokens=500,
        temperature=0
    )
    
    os.unlink(tmp_path)
    
    text = resp['choices'][0]['message']['content']
    
    json_start = text.find('{')
    json_end = text.rfind('}') + 1
    if json_start >= 0 and json_end > json_start:
        try:
            char_map = json.loads(text[json_start:json_end])
            return {"charMap": char_map, "count": len(char_map)}
        except:
            pass
    
    char_map = {}
    for ch in 'abcdefghijklmnopqrstuvwxyz0123456789':
        for line in text.split('\n'):
            if f'"{ch}"' in line or f"'{ch}'" in line:
                for word in line.split():
                    if word.isdigit():
                        char_map[ch] = int(word)
                        break
    
    if char_map:
        return {"charMap": char_map, "count": len(char_map)}
    return {"error": "parse failed", "text": text[:200]}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        data = json.loads(body)
        result = recognize_keypad(data.get('imgB64', ''), data.get('keys', []))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

if __name__ == '__main__':
    port = 8083
    init_model()
    print(f"Vision server: http://localhost:{port}")
    http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
