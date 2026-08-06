async function ocrWithVision(imgB64, keys) {
  const prompt = `This is a security keyboard image with shuffled key positions. Each key shows a single English letter (a-z) or number (0-9). The image has keys arranged in rows. For each key position listed below, identify the character displayed at those coordinates (x, y, width, height in pixels).

Key positions:
${keys.map(k => `  ${k.idx}: (${k.x},${k.y}, ${k.w}x${k.h})`).join('\n')}

Return ONLY a JSON object mapping character to index, like: {"a":13,"b":39,"1":0}. Only include keys where you can clearly identify a single a-z or 0-9 character. No explanation.`;

  const resp = await fetch('http://127.0.0.1:8083/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'vision',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + imgB64 } },
          { type: 'text', text: prompt }
        ]
      }],
      max_tokens: 500,
      temperature: 0
    })
  });

  if (!resp.ok) throw new Error('Vision API error: ' + resp.status);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch(e) {}
  }
  
  const charMap = {};
  for (const line of text.split('\n')) {
    const m = line.match(/["']?(\w)["']?\s*:\s*(\d+)/);
    if (m) charMap[m[1]] = parseInt(m[2]);
  }
  if (Object.keys(charMap).length > 0) return charMap;
  
  throw new Error('Vision 응답 파싱 실패: ' + text.slice(0, 100));
}

// 픽셀 분석으로 ICON 키(컬러 로고) 감지 후, 나머지 문자 키만 행 스트립으로 만들어 VLM 인식
async function ocrWithVisionStrips(imgB64, keys) {
  const img = new Image();
  img.src = 'data:image/png;base64,' + imgB64;
  await img.decode();

  // 1) ICON 감지: 컬러 픽셀 비율 > 5%
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const px = sctx.getImageData(0, 0, img.width, img.height).data;
  const icons = [];
  for (const k of keys) {
    let colored = 0, total = 0;
    for (let y = k.y; y < k.y + k.h; y++) {
      for (let x = k.x; x < k.x + k.w; x++) {
        const i = (y * img.width + x) * 4;
        const r = px[i], g = px[i+1], b = px[i+2];
        if (Math.abs(r - b) > 30 || Math.abs(g - b) > 30) colored++;
        total++;
      }
    }
    if (colored / total * 100 > 5) icons.push(k.idx);
  }
  const iconSet = new Set(icons);

  // 2) 문자 키 각각 개별 크롭(4x) → VLM 병렬 인식 (행 스트립은 숫자 행을 영문으로 오인하는 문제가 있어 사용 안 함)
  const charKeys = keys.filter(k => !iconSet.has(k.idx));
  const charMap = {};
  const SCALE = 4;
  const readKey = async (k) => {
    const crop = document.createElement('canvas');
    crop.width = k.w * SCALE; crop.height = k.h * SCALE;
    const ctx = crop.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, k.x, k.y, k.w, k.h, 0, 0, k.w * SCALE, k.h * SCALE);
    const prompt = `Output exactly one character shown in this image: a lowercase letter (a-z) or digit (0-9). Output nothing else.`;
    const resp = await fetch('http://127.0.0.1:8083/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vision',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + crop.toDataURL('image/png').split(',')[1] } },
          { type: 'text', text: prompt }
        ]}],
        max_tokens: 10,
        temperature: 0.1,
        min_p: 0.15,
        repetition_penalty: 1.05
      })
    });
    if (!resp.ok) throw new Error('Vision API error: ' + resp.status);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/["']?([a-zA-Z0-9])["']?/);
    return m ? m[1].toLowerCase() : null;
  };
  let done = 0, failed = 0;
  for (let i = 0; i < charKeys.length; i += 4) {
    const batch = charKeys.slice(i, i + 4);
    const results = await Promise.all(batch.map(readKey));
    for (let j = 0; j < batch.length; j++) {
      const ch = results[j];
      if (ch && /^[a-z0-9]$/.test(ch)) {
        if (charMap[ch] === undefined) charMap[ch] = batch[j].idx;
        else failed++;
      } else failed++;
    }
    done += batch.length;
    console.log(`[Vision] 키 인식 ${done}/${charKeys.length} 완료`);
  }
  console.log(`[Vision] 실패/중복: ${failed}건`);

  return { charMap, icons };
}
