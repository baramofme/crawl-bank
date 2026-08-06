#!/bin/sh
# LFM2.5-VL-450M 모델 다운로드 (Linux/macOS)
# vlm/ 디렉토리에서 실행: ./download-models.sh
set -e
cd "$(dirname "$0")"
mkdir -p models

BASE="https://huggingface.co/LiquidAI/LFM2.5-VL-450M-GGUF/resolve/main"

echo "=== LFM2.5-VL-450M-Q8_0.gguf 다운로드 중 ==="
curl -L -o models/LFM2.5-VL-450M-Q8_0.gguf "$BASE/LFM2.5-VL-450M-Q8_0.gguf?download=true"

echo "=== mmproj-LFM2.5-VL-450m-Q8_0.gguf 다운로드 중 ==="
curl -L -o models/mmproj-LFM2.5-VL-450m-Q8_0.gguf "$BASE/mmproj-LFM2.5-VL-450m-Q8_0.gguf?download=true"

echo "=== 완료 ==="
ls -lh models/
