// Gemini generateContent 를 흉내 내는 시험용 서버. 받은 요청을 기록하고 정해진 응답을 돌려준다.
// POST /__mode {"mode":"ok"|"429"|"badjson"} 로 동작을 바꾸고, GET /__calls 로 받은 요청을 본다.
import http from 'node:http';

let mode = 'ok';
const calls = [];
const REPORT = {
  headline: '작년 같은 기간보다 매출이 늘었지만 영업일당으로는 비슷한 흐름입니다.',
  summary: ['오늘까지 매출은 151.7만원입니다.', '전년 같은 기간 대비 +53.9% 입니다.', '영업일당 매출은 11.7만원입니다.'],
  positives: ['오미자차가 매출 1위를 지켰습니다.'],
  cautions: ['전월 같은 기간보다 매출이 줄었습니다.'],
  nextActions: ['작년 11월에 많이 팔린 품목을 미리 준비해 두세요.']
};

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/__mode') {
    mode = JSON.parse(body).mode;
    return res.end('ok');
  }
  if (req.url === '/__calls') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(calls));
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
