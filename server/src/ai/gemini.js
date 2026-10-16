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

export async function generateReport(facts) {
  const { apiKey, model, baseUrl } = config.gemini;
  if (!apiKey) throw new HttpError(503, 'AI_DISABLED', 'AI 리포트가 설정되지 않았습니다. 서버에 GEMINI_API_KEY 를 넣어 주세요.');

  let response;
  try {
    response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `다음 집계로 ${facts.month} 월간 리포트를 써 주세요.\n\n${JSON.stringify(facts)}` }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: REPORT_SCHEMA
        }
      }),
      signal: AbortSignal.timeout(90_000)
    });
  } catch (err) {
    console.error('[ai] Gemini 연결 실패', err.message);
    throw new HttpError(502, 'AI_UNREACHABLE', 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || response.statusText;
    console.error(`[ai] Gemini 오류 ${response.status}: ${detail}`);
    if (response.status === 429) {
      throw new HttpError(429, 'AI_RATE_LIMITED', 'Gemini 무료 사용량 한도에 걸렸습니다. 잠시 후(또는 내일) 다시 시도해 주세요.');
    }
    if ([400, 401, 403].includes(response.status) && /api key|permission|unauthori/i.test(detail)) {
      throw new HttpError(502, 'AI_CONFIG', 'Gemini API 키가 올바르지 않습니다. 서버의 GEMINI_API_KEY 를 확인해 주세요.');
    }
    throw new HttpError(502, 'AI_FAILED', `AI 리포트를 만들지 못했습니다. (${response.status})`);
  }

  if (body?.promptFeedback?.blockReason) {
    throw new HttpError(502, 'AI_BLOCKED', 'AI 가 요청을 처리하지 않았습니다. 잠시 후 다시 시도해 주세요.');
  }
  // 생각(thought) 부분은 빼고 실제 답만 모은다.
  const text = (body?.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[ai] Gemini 응답 해석 실패', body?.candidates?.[0]?.finishReason, text.slice(0, 200));
    throw new HttpError(502, 'AI_BAD_RESPONSE', 'AI 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return { report: normalizeReport(parsed), model: body?.modelVersion || model, usage: body?.usageMetadata || null };
}
