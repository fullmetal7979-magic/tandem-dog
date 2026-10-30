import assert from 'node:assert/strict';
import test from 'node:test';
import { ago, endsWithBatchim, finalSound, josa, minutesUntil } from './words.mjs';

test('particles follow how a name is read aloud', () => {
  const cases = [
    ['회사 PC', '회사 PC가', '회사 PC를', '회사 PC로'],
    ['집 맥북', '집 맥북이', '집 맥북을', '집 맥북으로'],
    ['집 맥북 💻', '집 맥북 💻이', '집 맥북 💻을', '집 맥북 💻으로'],
    ['내 폰', '내 폰이', '내 폰을', '내 폰으로'],
    ['서울', '서울이', '서울을', '서울로'],
    ['Mac', 'Mac이', 'Mac을', 'Mac으로'],
    ['iPhone', 'iPhone이', 'iPhone을', 'iPhone으로'],
    ['Galaxy', 'Galaxy가', 'Galaxy를', 'Galaxy로'],
    ['server', 'server가', 'server를', 'server로'],
    ['Pixel', 'Pixel이', 'Pixel을', 'Pixel로'],
    ['HTML', 'HTML이', 'HTML을', 'HTML로'],
    ['LG', 'LG가', 'LG를', 'LG로'],
    ['PC 7', 'PC 7이', 'PC 7을', 'PC 7로'],
    ['PC 2', 'PC 2가', 'PC 2를', 'PC 2로'],
  ];
  for (const [name, subject, object, toward] of cases) {
    assert.equal(josa(name, '이가'), subject, name);
    assert.equal(josa(name, '을를'), object, name);
    assert.equal(josa(name, '으로'), toward, name);
  }
  assert.equal(josa('🚀', '이가'), '🚀이(가)');
  assert.equal(josa('', '은는'), '은(는)');
  assert.equal(endsWithBatchim('…'), null);
  assert.equal(finalSound('파일'), 'rieul');
  assert.throws(() => josa('x', '요'), /unknown particle/);
});

test('relative time grows into weeks, months and years', () => {
  const now = Date.UTC(2026, 9, 31);
  const day = 86_400_000;
  assert.equal(ago(null, now), '기록 없음');
  assert.equal(ago(now - 10_000, now), '방금');
  assert.equal(ago(now + 60_000, now), '방금', 'a clock a little ahead is not the future');
  assert.equal(ago(now - 5 * 60_000, now), '5분 전');
  assert.equal(ago(now - 30 * 3_600_000, now), '30시간 전');
  assert.equal(ago(now - 5 * day, now), '5일 전');
  assert.equal(ago(now - 20 * day, now), '2주 전');
  assert.equal(ago(now - 100 * day, now), '3개월 전');
  assert.equal(ago(now - 800 * day, now), '2년 전');
  assert.equal(minutesUntil(now + 61_000, now), 2);
  assert.equal(minutesUntil(now + 1, now), 1);
  assert.equal(minutesUntil(now - 1, now), 0);
});
