# LFM2.5-VL-450M 모델 다운로드 (Windows PowerShell)
# vlm 디렉토리에서 실행: .\download-models.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path "models" | Out-Null

$Base = "https://huggingface.co/LiquidAI/LFM2.5-VL-450M-GGUF/resolve/main"

Write-Host "=== LFM2.5-VL-450M-Q8_0.gguf 다운로드 중 ==="
Invoke-WebRequest -Uri "$Base/LFM2.5-VL-450M-Q8_0.gguf?download=true" -OutFile "models/LFM2.5-VL-450M-Q8_0.gguf"

Write-Host "=== mmproj-LFM2.5-VL-450m-Q8_0.gguf 다운로드 중 ==="
Invoke-WebRequest -Uri "$Base/mmproj-LFM2.5-VL-450m-Q8_0.gguf?download=true" -OutFile "models/mmproj-LFM2.5-VL-450m-Q8_0.gguf"

Write-Host "=== 완료 ==="
Get-ChildItem "models" | Select-Object Name, Length
