import { Router } from 'express';
import { writeAudit } from '../audit.js';
import { requireAdmin, requireUser } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { ALIAS_JOIN_SQL, CANONICAL_SQL, NOT_AN_ITEM, looksLikeNonItem, suggestionKey } from '../descriptions.js';
import { badRequest } from '../http.js';

const router = Router();
const MAX_NAME = 100;

// 입력 자동완성: 최근 1년 동안 많이 쓴 대표 이름 순
router.get('/suggestions', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT name FROM (
       SELECT ${CANONICAL_SQL} AS name, COUNT(*) AS uses, MAX(t.transaction_date) AS last_used
         FROM transactions t ${ALIAS_JOIN_SQL}
        WHERE t.deleted_at IS NULL AND btrim(t.description) <> ''
          AND t.transaction_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - 365
        GROUP BY 1
     ) used
     WHERE name <> $1
     ORDER BY uses DESC, last_used DESC
     LIMIT 300`,
    [NOT_AN_ITEM]
  );
  res.json({ names: rows.map((row) => row.name) });
});

// 분석용 묶음표 { 원래 적요: 대표 이름 }
router.get('/aliases', requireUser, async (req, res) => {
  const { rows } = await query('SELECT alias, canonical FROM description_aliases ORDER BY alias');
  res.json({ aliases: Object.fromEntries(rows.map((row) => [row.alias, row.canonical])), notAnItem: NOT_AN_ITEM });
});

// 관리자 정리 화면: 실제 쓰인 적요 전부 + 묶음 추천
router.get('/', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT btrim(t.description) AS name, COUNT(*)::int AS uses,
            COALESCE(SUM(t.cash_income + t.card_income), 0) AS sales,
            MAX(t.transaction_date) AS last_used, MAX(a.canonical) AS canonical
       FROM transactions t ${ALIAS_JOIN_SQL}
      WHERE t.deleted_at IS NULL AND btrim(t.description) <> ''
      GROUP BY 1
      ORDER BY uses DESC`
  );

  const groups = new Map();
  rows.forEach((row) => {
    const key = suggestionKey(row.canonical || row.name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  // 이름이 두 가지 이상인데 아직 하나로 묶이지 않은 묶음만 추천한다.
  const suggestions = [...groups.entries()]
    .map(([key, items]) => {
      const canonicals = new Set(items.map((item) => item.canonical || item.name));
      const existing = items.find((item) => item.canonical)?.canonical;
      const suggested = existing || [...items].sort((a, b) => b.uses - a.uses || a.name.length - b.name.length)[0].name;
      return { key, suggested, uses: items.reduce((sum, item) => sum + item.uses, 0), items, unresolved: canonicals.size > 1 };
    })
    .filter((group) => group.items.length > 1 && group.unresolved)
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 50);

  const nonItems = rows.filter((row) => !row.canonical && looksLikeNonItem(row.name));
  const mapped = rows.filter((row) => row.canonical).sort((a, b) => a.canonical.localeCompare(b.canonical, 'ko') || b.uses - a.uses);

  res.json({ names: rows, suggestions, nonItems, mapped, notAnItem: NOT_AN_ITEM });
});

// 묶기·풀기: [{ alias, canonical }] - canonical 이 빈 문자열이면 묶음을 푼다.
router.put('/aliases', requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.aliases) ? req.body.aliases : null;
  if (!items || items.length === 0 || items.length > 200) throw badRequest('묶을 적요를 1~200개 보내 주세요.');
  const cleaned = items.map((item) => ({
    alias: String(item?.alias ?? '').trim(),
    canonical: String(item?.canonical ?? '').trim()
  }));
  if (cleaned.some((item) => !item.alias || item.alias.length > MAX_NAME || item.canonical.length > MAX_NAME)) {
    throw badRequest(`적요와 대표 이름은 ${MAX_NAME}자 이내로 입력해 주세요.`);
  }

  const result = await withTransaction(async (db) => {
    let merged = 0;
    let released = 0;
    for (const { alias, canonical } of cleaned) {
      if (!canonical || canonical === alias) {
        const { rowCount } = await db.query('DELETE FROM description_aliases WHERE alias = $1', [alias]);
        released += rowCount;
        continue;
      }
      await db.query(
        `INSERT INTO description_aliases (alias, canonical, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [alias, canonical, req.user.id]
      );
      // 대표 이름이 다른 묶음의 별칭이었다면 체인이 생기지 않도록 그 묶음도 새 대표로 옮긴다.
      await db.query('UPDATE description_aliases SET canonical = $1, updated_at = now() WHERE canonical = $2', [canonical, alias]);
      await db.query('DELETE FROM description_aliases WHERE alias = $1', [canonical]);
      merged += 1;
    }
    const label = cleaned.find((item) => item.canonical)?.canonical || cleaned[0].alias;
    await writeAudit(db, req.user, '적요 묶기', label, [merged ? `묶음 ${merged}개` : '', released ? `풀기 ${released}개` : '']);
    return { merged, released };
  });
  res.json(result);
});

export default router;
