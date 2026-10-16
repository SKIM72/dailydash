// Google Gemini API (generateContent) 호출 - 정해진 JSON 형식으로만 답하게 한다.
import { config } from '../config.js';
import { HttpError } from '../http.js';

export const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: '이번 달을 한 문장으로 (40자 안팎)' },
    summary: { type: 'ARRAY', items: { type: 'STRING' }, description: '핵심 요약 3개' },
    positives: { type: 'ARRAY', items: { type: 'STRING' }, description: '좋았던 점 1~3개' },
    cautions: { type: 'ARRAY', items: { type: 'STRING' }, description: '주의할 점 1~3개' },
    nextActions: { type: 'ARRAY', items: { type: 'STRING' }, description: '남은 기간·다음 달 준비 제안 1~3개' }
  },
  required: ['headline', 'summary', 'positives', 'cautions', 'nextActions'],
  propertyOrdering: ['headline', 'summary', 'positives', 'cautions', 'nextActions']
};

export const SYSTEM_PROMPT = `너는 전통차·카페 가게 "하늘향"의 매출 장부를 읽고 사장님께 월간 리포트를 쓰는 분석 도우미다.

규칙:
- 사용자가 준 JSON 의 숫자만 근거로 쓴다. 새로 계산하거나 추측한 숫자를 만들지 않는다. 증감률은 comparisons 에 있는 값을 그대로 쓴다.
- 영업일 수가 다르면 총매출보다 영업일당 매출(salesPerOperatingDay) 비교를 먼저 설명한다.
- 계절 영향이 큰 가게다. monthlyHistory 로 성수기·비수기를 판단하고, 전월보다 전년 같은 기간 비교를 더 중요하게 본다.
- inProgress 가 true 면 "오늘까지 기준"임을 밝히고, lastYearFullMonth 를 이번 달 마감 목표로 참고한다.
- monthEndForecast 는 추정치다. 언급할 때는 "예상"이라고 분명히 쓰고 basis(계산 기준)를 함께 밝힌다.
- 다음 달 준비 제안은 lastYearNextMonth(작년 다음 달 매출·인기 품목)에 근거한다.
- 금액은 읽기 쉽게 "92.3만원"처럼 만원 단위로 쓴다.
- 적요(품목) 이름은 JSON 에 있는 그대로 쓴다.
- 사장님께 보고하듯 존댓말로, 짧고 구체적으로 쓴다. "마케팅을 강화하세요" 같은 일반론은 쓰지 않는다.
- 데이터가 부족하면 그렇다고 말하고 억지로 결론을 내지 않는다.`;

const MAX_ITEMS = 5;
const MAX_TEXT = 300;

function cleanText(value, max = MAX_TEXT) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(value) {
  return (Array.isArray(value) ? value : []).map((item) => cleanText(item)).filter(Boolean).slice(0, MAX_ITEMS);
}

// AI 응답이 형식을 벗어나도 화면이 깨지지 않도록 길이·개수를 정리한다.
export function normalizeReport(raw) {
  const report = {
    headline: cleanText(raw?.headline, 120),
    summary: cleanList(raw?.summary),
    positives: cleanList(raw?.positives),
    cautions: cleanList(raw?.cautions),
    nextActions: cleanList(raw?.nextActions)
  };
  if (!report.headline && report.summary.length === 0) {
    throw new HttpError(502, 'AI_EMPTY', 'AI 가 빈 리포트를 보냈습니다. 잠시 후 다시 시도해 주세요.');
  }
  return report;
}

// 무료 등급은 혼잡(503)·한도(429)가 잦다. 혼잡이면 잠시 뒤 같은 모델로 다시, 그래도 안 되거나 한도면 예비 모델로 넘어간다.
const RETRY_DELAYS_MS = [2000, 5000];
const RETRYABLE = new Set([500, 502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callModel(model, facts) {
  const { apiKey, baseUrl } = config.gemini;
  try {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `다음 집계로 ${facts.month} 월간 리포트를 써 주세요.

${JSON.stringify(facts)}` }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: REPORT_SCHEMA
        }
      }),
      signal: AbortSignal.timeout(60_000)
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body };
  } catch (err) {
    console.error(`[ai] Gemini 연결 실패 (${model})`, err.message);
    return { status: 0, ok: false, body: {} };
  }
}

function parseReport(body, model) {
  if (body?.promptFeedback?.blockReason) {
    throw new HttpError(502, 'AI_BLOCKED', 'AI 가 요청을 처리하지 않았습니다. 잠시 후 다시 시도해 주세요.');
  }
  // 생각(thought) 부분은 빼고 실제 답만 모은다.
  const text = (body?.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  try {
    return normalizeReport(JSON.parse(text));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error(`[ai] Gemini 응답 해석 실패 (${model})`, body?.candidates?.[0]?.finishReason, text.slice(0, 200));
    throw new HttpError(502, 'AI_BAD_RESPONSE', 'AI 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export async function generateReport(facts) {
  const { apiKey, model, fallbackModel } = config.gemini;
  if (!apiKey) throw new HttpError(503, 'AI_DISABLED', 'AI 리포트가 설정되지 않았습니다. 서버에 GEMINI_API_KEY 를 넣어 주세요.');

  const models = [...new Set([model, fallbackModel].filter(Boolean))];
  let lastStatus = 0;
  for (const candidate of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const result = await callModel(candidate, facts);
      if (result.ok) {
        return { report: parseReport(result.body, candidate), model: result.body?.modelVersion || candidate, usage: result.body?.usageMetadata || null };
      }
      lastStatus = result.status;
      const detail = result.body?.error?.message || '';
      console.error(`[ai] Gemini 오류 ${result.status} (${candidate}, ${attempt + 1}번째): ${detail}`);
      if ([400, 401, 403].includes(result.status) && /api key|permission|unauthori/i.test(detail)) {
        throw new HttpError(502, 'AI_CONFIG', 'Gemini API 키가 올바르지 않습니다. 서버의 GEMINI_API_KEY 를 확인해 주세요.');
      }
      // 혼잡·연결 실패만 같은 모델로 다시 시도하고, 한도(429)나 그 밖의 오류는 예비 모델로 넘어간다.
      if (!(RETRYABLE.has(result.status) || result.status === 0) || attempt === RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (lastStatus === 429) {
    throw new HttpError(429, 'AI_RATE_LIMITED', 'Gemini 무료 사용량 한도에 걸렸습니다. 잠시 후(또는 내일) 다시 시도해 주세요.');
  }
  if (RETRYABLE.has(lastStatus) || lastStatus === 0) {
    throw new HttpError(503, 'AI_BUSY', 'Gemini 서버가 지금 붐빕니다. 몇 분 뒤 다시 시도해 주세요.');
  }
  throw new HttpError(502, 'AI_FAILED', `AI 리포트를 만들지 못했습니다. (${lastStatus})`);
}
