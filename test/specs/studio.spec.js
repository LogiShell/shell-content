// The Content studio does its real job: from an idea to a script, to a video file, to a plan, and back from a file.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ANSWER, ANSWER_SECONDS, TOOLS, addIdea, frameOf, frameStore, openShell, tool, writeScript } from './shell.js';

test('1. every tool starts empty, says what to do first, and logs no errors', async ({ page }) => {
  const problems = await openShell(page);

  let f = await tool(page, 'ideas');
  await expect(f.locator('#empty')).toBeVisible();
  await expect(f.locator('#empty')).toContainText('Впишите первую');

  f = await tool(page, 'script');
  await expect(f.locator('#empty')).toBeVisible();
  await expect(f.locator('#empty')).toContainText('Возьмите идею');
  await expect(f.locator('#editor')).toBeHidden();

  f = await tool(page, 'video');
  await expect(f.locator('#none')).toBeVisible();
  await expect(f.locator('#none')).toContainText('Сначала нужен сценарий');
  await expect(f.getByRole('button', { name: 'Открыть «Сценарий»' })).toBeVisible();

  f = await tool(page, 'plan');
  await expect(f.locator('#empty')).toBeVisible();
  await expect(f.locator('#empty')).toContainText('Добавьте публикацию');

  f = await tool(page, 'data');
  await expect(f.getByRole('button', { name: 'Войти через LogiShell' })).toBeVisible();
  await expect(f.locator('#stats .stat').first()).toContainText('0');

  await page.waitForTimeout(500); // late errors of the last page
  expect(problems).toEqual([]);
});

test('2. an idea goes to Сценарий with its topic', async ({ page }) => {
  const problems = await openShell(page);
  const idea = 'Как выбрать первую кофемолку';
  const ideas = await addIdea(page, idea);
  await ideas.locator('#list li', { hasText: idea }).getByRole('button', { name: 'В сценарий →' }).click();

  const script = page.frameLocator('iframe[title="Сценарий"]');
  await expect(page.locator('iframe[title="Сценарий"]')).toBeVisible();
  await expect(script.locator('#topic')).toHaveValue(idea);
  expect(problems).toEqual([]);
});

test('3. without Claude the manual panel takes a pasted answer, and Видео gets that script', async ({ page }) => {
  const problems = await openShell(page);
  const topic = 'Как выбрать первую кофемолку';
  const script = await writeScript(page, topic);

  await expect(script.locator('#scenes .scene')).toHaveCount(ANSWER.scenes.length);
  await expect(script.locator('#hook')).toHaveValue(ANSWER.hook);
  await expect(script.getByLabel('Текст на экране, сцена 2')).toHaveValue(ANSWER.scenes[1].text);
  await expect(script.locator('#ed-total')).toHaveText(`всего ${ANSWER_SECONDS - 2} сек`);
  await expect(script.locator('#tags')).toHaveValue(ANSWER.hashtags.join(' '));

  await script.getByRole('button', { name: 'Собрать видео →' }).click();
  const video = page.frameLocator('iframe[title="Видео"]');
  await expect(page.locator('iframe[title="Видео"]')).toBeVisible();
  await expect(video.locator('#studio')).toBeVisible();
  await expect(video.locator('#pick option:checked')).toHaveText(topic);
  await expect(video.locator('#len')).toHaveText(`Длина ${ANSWER_SECONDS} сек, ${ANSWER.scenes.length + 1} кадров`);
  await expect(video.locator('#scene-list li')).toHaveCount(ANSWER.scenes.length + 1);
  await expect(video.locator('#scene-list')).toContainText(ANSWER.scenes[2].text);
  expect(problems).toEqual([]);
});

test('4. Видео records a real vertical file of the right length', async ({ page }, info) => {
  test.setTimeout(90_000);
  const problems = await openShell(page);
  const script = await writeScript(page, 'Кофемолка за минуту');
  await script.getByRole('button', { name: 'Собрать видео →' }).click();
  const video = page.frameLocator('iframe[title="Видео"]');
  await expect(video.locator('#len')).toHaveText(new RegExp(`^Длина ${ANSWER_SECONDS} сек`));

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: (ANSWER_SECONDS + 30) * 1000 }),
    video.getByRole('button', { name: 'Сохранить видео' }).click(),
  ]);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const bytes = await readFile(file);

  const webm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const mp4 = bytes.subarray(4, 8).toString('latin1') === 'ftyp';
  expect(webm || mp4, `not MP4 or WebM: ${download.suggestedFilename()}`).toBe(true);
  expect(download.suggestedFilename()).toMatch(mp4 ? /\.mp4$/ : /\.webm$/);
  expect(bytes.length).toBeGreaterThan(100 * 1024);

  // Play the file back in a <video> of the page: real dimensions and length.
  const meta = await page.evaluate(async ({ b64, type }) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto';
    document.body.append(v);
    const once = (ev) => new Promise((ok, fail) => { v.addEventListener(ev, ok, { once: true }); v.addEventListener('error', () => fail(new Error('video error ' + v.error?.code)), { once: true }); });
    const loaded = once('loadedmetadata');
    v.src = URL.createObjectURL(blob);
    await loaded;
    // MediaRecorder WebM has no duration in its header: seeking past the end makes the browser find it.
    if (!Number.isFinite(v.duration)) {
      const changed = once('durationchange');
      v.currentTime = 1e9;
      await changed;
    }
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  }, { b64: bytes.toString('base64'), type: mp4 ? 'video/mp4' : 'video/webm' });

  expect(meta.width).toBe(1080);
  expect(meta.height).toBe(1920);
  expect(Math.abs(meta.duration - ANSWER_SECONDS)).toBeLessThanOrEqual(1);
  await expect(video.locator('#done')).toContainText('Готово');
  expect(problems).toEqual([]);
});

test('5. tools of one shell do not overwrite each other in the frame store', async ({ page }) => {
  const problems = await openShell(page);
  // План is open (and holds its copy of the store) before Идеи writes.
  let plan = await tool(page, 'plan');
  await expect(plan.locator('#empty')).toBeVisible();

  const idea = 'Идея из соседней вкладки';
  await addIdea(page, idea);

  plan = await tool(page, 'plan');
  const post = 'Пост про кофемолки';
  await plan.locator('#title').fill(post);
  await plan.getByRole('button', { name: 'Добавить в план' }).click();
  await expect(plan.locator('#days')).toContainText(post);

  await expect.poll(async () => {
    const { keys, data } = await frameStore(page);
    return { keys: keys.length > 0, idea: (data['cs.ideas'] ?? []).some((i) => i.text === idea), post: (data['cs.plan'] ?? []).some((p) => p.title === post) };
  }).toEqual({ keys: true, idea: true, post: true });

  // And after a reload both are still there for the tools.
  await page.reload();
  await expect((await tool(page, 'ideas')).locator('#list')).toContainText(idea);
  await expect((await tool(page, 'plan')).locator('#days')).toContainText(post);
  expect(problems).toEqual([]);
});

test('6. Данные exports a file with the idea, and importing it back in merge mode does not duplicate', async ({ page }, info) => {
  const problems = await openShell(page);
  const idea = 'Идея для выгрузки';
  await addIdea(page, idea);

  const data = await tool(page, 'data');
  await expect(data.locator('#stats .stat').first()).toContainText('1');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'Скачать всё (JSON)' }).click(),
  ]);
  const file = info.outputPath('export.json');
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^content-studio-.*\.json$/);
  const json = JSON.parse(await readFile(file, 'utf8'));
  expect(json.app).toBe('content-studio');
  expect(json.data.ideas.map((i) => i.text)).toEqual([idea]);

  await data.locator('#import').setInputFiles(file); // confirm() is accepted: merge
  await expect(data.locator('#io-out')).toHaveText('Данные объединены.');
  await expect(data.locator('#stats .stat').first()).toContainText('1');
  const { data: store } = await frameStore(page);
  expect(store['cs.ideas'].filter((i) => i.text === idea)).toHaveLength(1);
  await expect((await tool(page, 'ideas')).locator('#list li')).toHaveCount(1);
  expect(problems).toEqual([]);
});

test('7. at 380 px no tool scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  const problems = await openShell(page);
  // Something in every tool, so the filled layouts are measured too.
  await addIdea(page, 'Очень длинная идея без пробелов: ' + 'кофемолкакофемолкакофемолка'.repeat(3));
  const script = await writeScript(page, 'Кофемолка на узком экране');
  await script.getByRole('button', { name: 'В план' }).click();
  await expect(page.locator('iframe[title="План"]')).toBeVisible();

  const wide = [];
  for (const t of TOOLS) {
    await tool(page, t.id);
    const frame = await frameOf(page, t.id);
    await frame.waitForLoadState();
    const m = await frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (m.scroll > m.client) wide.push(`${t.title}: ${m.scroll} > ${m.client}`);
  }
  expect(wide).toEqual([]);
  expect(problems).toEqual([]);
});
