import http.server, json, base64, io, sys, os
from PIL import Image, ImageOps, ImageFilter
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

def preprocess(crop):
    gray = crop.convert('L')
    avg = sum(gray.get_flattened_data()) / (gray.width * gray.height)
    if avg < 128:
        gray = ImageOps.invert(gray)
    gray = gray.point(lambda x: 0 if x < 100 else 255)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray.resize((gray.width * 2, gray.height * 2), Image.LANCZOS)

def ocr_keypad(img_b64, keys):
    if not HAS_TESSERACT:
        return {"error": "tesseract not installed"}

    img = Image.open(io.BytesIO(base64.b64decode(img_b64)))
    os.makedirs('/tmp/opencode/debug', exist_ok=True)
    
    char_map = {}
    for k in keys[:8]:
        crop = img.crop((k['x'] - 2, k['y'] - 2, k['x'] + k['w'] + 2, k['y'] + int(k['h'] * 0.5) + 2))
        crop = crop.resize((190, 95), Image.LANCZOS)
        crop.save(f'/tmp/opencode/debug/crop_{k["idx"]}.png')
    
    gray_full = img.convert('L')
    gray_full.save('/tmp/opencode/debug/full_gray.png')
    
    data = pytesseract.image_to_data(gray_full, output_type=pytesseract.Output.DICT,
        config='--psm 6 -c tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyz0123456789')
    
    chars_found = []
    for i, text in enumerate(data['text']):
        text = text.strip().lower()
        if len(text) == 1 and data['conf'][i] > 0:
            cx = data['left'][i] + data['width'][i] // 2
            cy = data['top'][i] + data['height'][i] // 2
            chars_found.append({'char': text, 'x': cx, 'y': cy, 'conf': data['conf'][i]})
            for k in keys:
                if k['x'] <= cx <= k['x'] + k['w'] and k['y'] <= cy <= k['y'] + k['h'] * 0.6:
                    if text not in char_map:
                        char_map[text] = k['idx']
                    break
    
    return {"charMap": char_map, "count": len(char_map), "found": chars_found}
    
    return {"charMap": char_map, "count": len(char_map)}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

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
        result = ocr_keypad(data.get('imgB64', ''), data.get('keys', []))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

if __name__ == '__main__':
    port = 8765
    print(f"OCRad server: http://localhost:{port}")
    http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
