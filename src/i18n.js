/**
 * Internationalisation.
 *
 * The key IS the Chinese source string (gettext's model): call sites stay readable
 * and a string that has not been translated yet degrades to the Chinese original
 * instead of showing a key name. `t()` is aliased to `T` because it appears in
 * several hundred places.
 *
 * Two rules keep this honest as the app grows:
 *   - every `T('…')` / `data-i18n` key must have an entry in EN (test/i18n.test.js
 *     fails otherwise), so English mode can never quietly show Chinese;
 *   - placeholders are named (`{name}`), so a translation may reorder them freely.
 *
 * The language itself may be 'system' (follow navigator.language, the first-run
 * default), 'zh' or 'en' — persisted under `luogu_editor_lang`.
 */
(function (global) {
  'use strict';

  const LANG_KEY = 'luogu_editor_lang';

  // ---- dictionaries ---------------------------------------------------------
  // Keys are the Chinese originals. Chinese itself needs no table: `t()` returns
  // the key verbatim, which is exactly the Chinese string.

  const EN = {};

  const TABLES = { en: EN };

  // ---- language resolution --------------------------------------------------

  function stored() {
    try {
      const v = global.localStorage && global.localStorage.getItem(LANG_KEY);
      return v === 'zh' || v === 'en' || v === 'system' ? v : 'system';
    } catch (e) { return 'system'; }
  }

  function detect() {
    let tag = '';
    try {
      tag = String((global.navigator && (global.navigator.language || global.navigator.userLanguage)) || '');
    } catch (e) { tag = ''; }
    // Anything Chinese (zh, zh-CN, zh-TW, zh-Hans…) gets Chinese; the rest English.
    return /^zh\b/i.test(tag) ? 'zh' : 'en';
  }

  let setting = stored();
  let resolved = setting === 'system' ? detect() : setting;
  const listeners = [];

  function interpolate(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (m, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
    ));
  }

  /**
   * Translate. Falls back to the key itself, so nothing ever renders as a key.
   *
   * Keys that contain real newlines (the preset templates, the long help-manual blocks)
   * arrive with CRLF on Windows, because Git checks those files out that way — while the
   * dictionary was generated from a LF checkout. Normalising on a miss keeps Windows from
   * silently falling back to Chinese everywhere such a key is used. Browser-parsed HTML
   * is already normalised for us, but JS string literals in the source are not.
   */
  function t(key, vars) {
    if (key === null || key === undefined) return '';
    const table = TABLES[resolved];
    let mapped = null;
    if (table) {
      if (Object.prototype.hasOwnProperty.call(table, key)) mapped = table[key];
      else if (key.indexOf('\r') >= 0) {
        const normalised = key.replace(/\r\n?/g, '\n');
        if (Object.prototype.hasOwnProperty.call(table, normalised)) mapped = table[normalised];
      }
    }
    return interpolate(mapped === null ? key : mapped, vars);
  }

  /**
   * Translate a literal with embedded values, e.g. `tpl('第 {n} 行', { n: 3 })`.
   * Kept separate from t() so call sites that build strings from parts read clearly.
   */
  function tpl(parts, vars) {
    return t(parts, vars);
  }

  // ---- DOM translation ------------------------------------------------------
  // Static markup carries its key in an attribute:
  //   data-i18n="保存"            -> textContent
  //   data-i18n-title="保存文件"   -> title
  //   data-i18n-placeholder="…"   -> placeholder
  //   data-i18n-aria-label="…"    -> aria-label
  //   data-i18n-html="…"          -> innerHTML (only for trusted literals)

  const ATTRS = [
    ['data-i18n', (el, v) => { el.textContent = v; }],
    ['data-i18n-html', (el, v) => { el.innerHTML = v; }],
    ['data-i18n-title', (el, v) => { el.title = v; }],
    ['data-i18n-placeholder', (el, v) => { el.placeholder = v; }],
    ['data-i18n-aria-label', (el, v) => { el.setAttribute('aria-label', v); }],
  ];

  function applyDom(root) {
    const scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return 0;
    let touched = 0;
    ATTRS.forEach(([attr, set]) => {
      scope.querySelectorAll(`[${attr}]`).forEach((el) => {
        const key = el.getAttribute(attr);
        if (!key) return;
        set(el, t(key));
        touched += 1;
      });
    });
    return touched;
  }

  // ---- switching ------------------------------------------------------------

  function current() { return resolved; }
  function currentSetting() { return setting; }

  function setLang(next) {
    setting = next === 'zh' || next === 'en' ? next : 'system';
    resolved = setting === 'system' ? detect() : setting;
    try { global.localStorage && global.localStorage.setItem(LANG_KEY, setting); } catch (e) { /* ignore */ }
    if (global.document) {
      global.document.documentElement.setAttribute('lang', resolved === 'zh' ? 'zh-CN' : 'en');
    }
    applyDom();
    listeners.forEach((fn) => { try { fn(resolved); } catch (e) { /* a listener must not break switching */ } });
    return resolved;
  }

  /** Called after a render that produced text in JS (tab labels, status bar, …). */
  function onChange(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function init() {
    if (global.document) {
      global.document.documentElement.setAttribute('lang', resolved === 'zh' ? 'zh-CN' : 'en');
    }
    applyDom();
    return resolved;
  }

  const api = {
    t, tpl, applyDom, setLang, onChange, init, current, currentSetting,
    detect, LANG_KEY, EN,
    /** Test seam: add entries without editing the table. */
    _extend(dict) { Object.assign(EN, dict); },
  };

  global.LuoguI18n = api;
  // Short alias: `T('保存')`. Also usable straight from inline HTML handlers.
  global.T = t;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
