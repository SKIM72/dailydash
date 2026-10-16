// 시험용 가짜 서버: Gemini generateContent 와 웹 푸시 서비스를 흉내 낸다.
// POST /__mode {"mode":"ok"|"429"|"badjson"} 로 Gemini 동작을 바꾸고, GET /__calls · /__pushes 로 받은 요청을 본다.
// 푸시: POST /push/<id> 는 201, /push/gone 은 410(구독 만료)을 돌려준다.
import http from 'node:http';

let mode = 'ok';
const calls = [];
const pushes = [];
const REPORT = {
  headline: '작년 같은 기간보다 매출이 늘었지만 영업일당으로는 비슷한 흐름입니다.',
  summary: ['오늘까지 매출은 151.7만원입니다.', '전년 같은 기간 대비 +53.9% 입니다.', '영업일당 매출은 11.7만원입니다.'],
  positives: ['오미자차가 매출 1위를 지켰습니다.'],
  cautions: ['전월 같은 기간보다 매출이 줄었습니다.'],
  nextActions: ['작년 11월에 많이 팔린 품목을 미리 준비해 두세요.']
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const body = raw.toString('utf8');
  if (req.url === '/__mode') {
    mode = JSON.parse(body).mode;
    return res.end('ok');
  }
  if (req.url === '/__calls') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(calls));
  }
  if (req.url === '/__pushes') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(pushes));
  }
  if (req.url.startsWith('/push/') && req.method === 'POST') {
    pushes.push({ id: req.url.slice('/push/'.length), headers: req.headers, body: raw.toString('base64') });
    res.statusCode = req.url === '/push/gone' ? 410 : 201;
    return res.end();
  }
  const match = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(req.url);
  if (req.method !== 'POST' || !match) {
    res.statusCode = 404;
    return res.end('{}');
  }
  calls.push({ model: match[1], apiKey: req.headers['x-goog-api-key'], body: JSON.parse(body) });
  res.setHeader('Content-Type', 'application/json');
  if (req.headers['x-goog-api-key'] !== 'test-key') {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }));
  }
  if (mode === '429') {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).' } }));
  }
  const text = mode === 'badjson' ? 'not json' : JSON.stringify(REPORT);
  res.end(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: '(thinking...)', thought: true }, { text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2100, candidatesTokenCount: 300, thoughtsTokenCount: 500, totalTokenCount: 2900 },
    modelVersion: match[1]
  }));
});
const port = Number(process.env.MOCK_GEMINI_PORT || 4999);
server.listen(port, '127.0.0.1', () => console.log(`[mock-gemini] http://127.0.0.1:${port}`));
