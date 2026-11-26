// Shared helpers of the Content studio tools: storage, small DOM helpers, and the ways to reach Claude.
// Everything the person enters lives in localStorage under "cs.*": per shell, in their own browser.
(() => {
  const P = 'cs.';
  const read = (k, d) => {
    try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  };
  const write = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n[k] = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
    return n;
  }

  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Скопировано'); return; } catch {}
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Скопировано'); } catch { toast('Не получилось скопировать, выделите текст вручную'); }
    ta.remove();
  }

  /** Re-render when another tool of this shell changes the data, or when this tool comes back into view. */
  function onChange(fn) {
    addEventListener('storage', () => fn());
    addEventListener('focus', () => fn());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
  }

  const open = async (tool) => {
    try { await window.logishell?.tools?.open(`content-studio.${tool}`); } catch { toast('Откройте вкладку «' + tool + '» слева'); }
  };

  // ---- Claude ---------------------------------------------------------------------------------------------------
  // Three rails, in this order: the person's LogiShell account (no key needed), their own Anthropic key, and by hand
  // (copy the request into any Claude chat and paste the answer back).
  const MODEL = 'claude-sonnet-5-5';

  async function rails() {
    const out = { logishell: false, signedIn: false, key: !!read('settings', {}).apiKey };
    const ai = window.logishell?.ai;
    if (ai?.complete && window.logishell?.id?.whoami) {
      out.logishell = true;
      try { out.signedIn = !!(await window.logishell.id.whoami())?.signedIn; } catch {}
    }
    return out;
  }

  class NoRail extends Error {}

  async function viaKey(key, system, prompt, maxTokens) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
      });
    } catch { throw new Error('Нет связи с Claude. Проверьте интернет и попробуйте ещё раз.'); }
    let j = null;
    try { j = await res.json(); } catch {}
    if (res.status === 401) throw new Error('Ключ Claude не подходит. Проверьте его во вкладке «Данные».');
    if (res.status === 429) throw new Error('Claude просит подождать минуту: слишком много запросов.');
    if (!res.ok) throw new Error('Claude не ответил (' + res.status + '). Попробуйте ещё раз.');
    return (j?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  /** Asks Claude. Throws NoRail when there is no way to reach it, so the page can offer the manual way. */
  async function ask({ system, prompt, maxTokens = 3000 }) {
    const r = await rails();
    if (r.logishell && r.signedIn) {
      try {
        const out = await window.logishell.ai.complete({ system, messages: [{ role: 'user', content: prompt }], maxTokens });
        return String(out?.text ?? '');
      } catch (e) {
        const m = String(e?.message ?? '');
        if (/sign in/i.test(m)) { if (!read('settings', {}).apiKey) throw new NoRail('signed out'); }
        else if (/limit|busy|too many/i.test(m)) throw new Error('Лимит Claude через LogiShell на сегодня исчерпан или сервис занят. Попробуйте позже или подключите свой ключ во вкладке «Данные».');
        else throw new Error('Claude через LogiShell сейчас не ответил. Попробуйте ещё раз через минуту.');
      }
    }
    const key = read('settings', {}).apiKey;
    if (key) return viaKey(key, system, prompt, maxTokens);
    throw new NoRail('no rail');
  }

  /** The first JSON object or array in a text, or null. Claude sometimes wraps it in prose or a code fence. */
  function json(text) {
    const s = String(text ?? '');
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : s;
    for (const [o, c] of [['{', '}'], ['[', ']']]) {
      const a = body.indexOf(o), b = body.lastIndexOf(c);
      if (a >= 0 && b > a) { try { return JSON.parse(body.slice(a, b + 1)); } catch {} }
    }
    return null;
  }

  /**
   * A small panel for when Claude cannot be reached from here: copy the request, paste the answer.
   * onAnswer gets the pasted text.
   */
  function manualPanel(fullPrompt, onAnswer) {
    const ta = el('textarea', { class: 'field', rows: 6, placeholder: 'Вставьте сюда ответ Claude целиком', 'aria-label': 'Ответ Claude' });
    return el('div', { class: 'note' },
      el('p', { style: 'margin:0 0 8px' }, 'Claude отсюда пока не подключён. Войдите через LogiShell или добавьте ключ во вкладке «Данные». А пока можно вручную: скопируйте запрос, вставьте в любой чат с Claude, ответ вставьте ниже.'),
      el('div', { class: 'row' },
        el('button', { class: 'quiet', type: 'button', onclick: () => copy(fullPrompt) }, 'Скопировать запрос'),
        el('button', { class: 'quiet', type: 'button', onclick: () => open('data') }, 'Подключить Claude')),
      el('div', { style: 'margin-top:8px' }, ta),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'primary', type: 'button', onclick: () => onAnswer(ta.value) }, 'Готово')));
  }

  const PLATFORMS = ['Reels', 'TikTok', 'Shorts', 'Telegram', 'VK Клипы', 'Пост'];
  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }); } catch { return iso; }
  };
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  window.CS = { read, write, uid, el, toast, copy, onChange, open, ask, rails, json, manualPanel, NoRail, PLATFORMS, fmtDate, today, MODEL };
})();
