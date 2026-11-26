// Helpers for driving the Content studio inside the LogiShell frame.
import { expect } from '@playwright/test';

export const TOOLS = [
  { id: 'ideas', title: 'Идеи' },
  { id: 'script', title: 'Сценарий' },
  { id: 'video', title: 'Видео' },
  { id: 'plan', title: 'План' },
  { id: 'data', title: 'Данные' },
];

/** A fixed answer of Claude for the manual panel: a hook and three scenes, 2 s each. */
export const ANSWER = {
  hook: 'Кофемолка решает всё',
  scenes: [
    { text: 'Жернова лучше ножей', voice: 'Ножи рубят зерно неровно, жернова мелют ровно.', visual: 'Две кофемолки рядом', seconds: 2 },
    { text: 'Помол под способ', voice: 'Для турки мелко, для френч-пресса крупно.', visual: 'Три кучки помола', seconds: 2 },
    { text: 'Подпишись за рецептами', voice: 'Подписывайтесь, дальше рецепты.', visual: 'Чашка крупным планом', seconds: 2 },
  ],
  caption: 'Как выбрать первую кофемолку и не пожалеть.',
  hashtags: ['#кофе', '#бариста'],
};
/** The hook card (2 s) plus the scenes. */
export const ANSWER_SECONDS = 2 + ANSWER.scenes.reduce((a, s) => a + s.seconds, 0);

/**
 * Opens the shell and starts watching for problems: console errors and uncaught exceptions of the tool pages, and any
 * attempt to reach Claude's API directly (there is no key in these tests, so there must be none).
 */
export async function openShell(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()} @ ${m.location()?.url ?? ''}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept()); // confirm(): delete, import in merge mode
  await page.route('https://api.anthropic.com/**', (r) => { problems.push('called api.anthropic.com'); return r.abort(); });
  await page.goto(process.env.BASE_URL);
  await expect(page.locator('#rail button[data-id="content-studio.ideas"]')).toBeVisible();
  return problems;
}

/** Switches to a tool by its rail button and gives its frame. */
export async function tool(page, id) {
  const t = TOOLS.find((x) => x.id === id);
  await page.locator(`#rail button[data-id="content-studio.${id}"]`).click();
  const iframe = page.locator(`iframe[title="${t.title}"]`);
  await expect(iframe).toBeVisible();
  return page.frameLocator(`iframe[title="${t.title}"]`);
}

/** The Frame object of a tool (for evaluate). */
export async function frameOf(page, id) {
  const t = TOOLS.find((x) => x.id === id);
  return (await page.locator(`iframe[title="${t.title}"]`).elementHandle()).contentFrame();
}

/** What the frame keeps for the shell in its own localStorage (keys lsh.store.*), with the cs.* values parsed. */
export async function frameStore(page) {
  const raw = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('lsh.store')).map((k) => [k, localStorage.getItem(k)])));
  const keys = Object.keys(raw);
  const out = {};
  for (const k of keys) {
    const store = JSON.parse(raw[k]);
    for (const [name, value] of Object.entries(store)) { try { out[name] = JSON.parse(value); } catch { out[name] = value; } }
  }
  return { keys, data: out };
}

export async function addIdea(page, text) {
  const f = await tool(page, 'ideas');
  await f.locator('#text').fill(text);
  await f.getByRole('button', { name: 'Добавить' }).click();
  await expect(f.locator('#list li', { hasText: text })).toBeVisible();
  return f;
}

/** Writes a script through the manual panel (Claude is not connected here) and gives the Сценарий frame. */
export async function writeScript(page, topic) {
  const f = await tool(page, 'script');
  await f.locator('#topic').fill(topic);
  await f.getByRole('button', { name: 'Написать с Claude' }).click();
  await expect(f.locator('#out')).toContainText('Claude отсюда пока не подключён');
  await f.getByLabel('Ответ Claude').fill('Вот сценарий:\n```json\n' + JSON.stringify(ANSWER) + '\n```');
  await f.getByRole('button', { name: 'Готово' }).click();
  await expect(f.locator('#editor')).toBeVisible();
  return f;
}
