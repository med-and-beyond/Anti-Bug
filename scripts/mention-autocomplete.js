// @-mention autocomplete for plain <textarea> / <input> fields.
//
// Usage:
//   import { createMentionController } from './mention-autocomplete.js';
//   const ctl = createMentionController({ getUsers: () => userArray });
//   ctl.attach(textareaEl);
//   ...
//   const html = ctl.serializeFieldToHtml(textareaEl);
//   // -> '<a class="user_mention_editor router" href="..." data-mention-id="..."><b>@Name</b></a> rest of text'
//
// Design notes:
//   - The user list is fetched once by the host page and passed in via getUsers().
//   - Each attached field gets a per-field `mentions[]` registry so we can
//     reliably re-emit Monday's mention HTML at submit time, even when names
//     contain spaces (which a regex over plain text can't disambiguate).
//   - When a user edits the field, mention offsets are reconciled using the
//     `input` event's standard semantics + a fast diff against the previous
//     value. If a mention's textual span no longer matches "@<Full Name>",
//     it is dropped (matches Monday's behavior).
//   - Caret coordinates inside textareas are computed with a hidden mirror
//     div, the standard technique used by GitHub / Monday / Slack for caret
//     overlays on plain textareas.

const ZERO_WIDTH_PUNCTUATION = /[\s.,;:!?()[\]{}<>"'`~]/;

/**
 * Create a mention controller that can be attached to multiple fields.
 * @param {object} opts
 * @param {() => Array<{id:string,name:string,email?:string,url?:string,photoThumb?:string|null}>} opts.getUsers
 *   Returns the latest user list. Called every keystroke so the host can
 *   update the cache without re-attaching.
 * @param {number} [opts.maxResults=8] - max suggestions shown.
 */
export function createMentionController({ getUsers, maxResults = 8 } = {}) {
  if (typeof getUsers !== 'function') {
    throw new Error('createMentionController requires getUsers()');
  }

  const fieldStates = new WeakMap();

  let popupEl = null;
  let activeField = null;
  let activeIndex = -1;
  let currentMatches = [];
  let currentTrigger = null;

  function ensurePopup() {
    if (popupEl) return popupEl;
    popupEl = document.createElement('div');
    popupEl.className = 'mention-suggestions';
    popupEl.setAttribute('role', 'listbox');
    popupEl.style.display = 'none';
    document.body.appendChild(popupEl);
    return popupEl;
  }

  function hidePopup() {
    if (popupEl) popupEl.style.display = 'none';
    activeField = null;
    activeIndex = -1;
    currentMatches = [];
    currentTrigger = null;
  }

  /**
   * Detect whether the caret is inside an active "@<query>" trigger token.
   * Returns { atIndex, query } or null.
   *
   * Rules:
   *   - The "@" must be at the start of the field OR preceded by whitespace
   *     or punctuation (so emails like alice@example.com don't trigger).
   *   - The query is the run of characters after "@" up to the caret, with
   *     no newline. We allow spaces because Monday names have spaces, but we
   *     cap the query at ~30 chars (any reasonable name) to avoid runaway
   *     matching when the user just typed "@" mid-paragraph.
   */
  function detectTrigger(field) {
    const value = field.value;
    const caret = field.selectionStart;
    if (caret == null || caret !== field.selectionEnd) return null;

    const before = value.slice(0, caret);
    const atIndex = before.lastIndexOf('@');
    if (atIndex === -1) return null;

    const prevChar = atIndex === 0 ? '' : value.charAt(atIndex - 1);
    if (prevChar && !ZERO_WIDTH_PUNCTUATION.test(prevChar)) return null;

    const query = before.slice(atIndex + 1);
    if (query.length > 30) return null;
    if (query.includes('\n')) return null;
    return { atIndex, query };
  }

  function rankUsers(query) {
    const users = (getUsers() || []).filter(Boolean);
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, maxResults);

    const scored = [];
    for (const u of users) {
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      let score = -1;
      if (name.startsWith(q)) score = 100 - name.length;
      else if (name.includes(' ' + q)) score = 80 - name.length;
      else if (name.includes(q)) score = 60 - name.length;
      else if (email.startsWith(q)) score = 50 - email.length;
      else if (email.includes(q)) score = 30 - email.length;
      if (score >= 0) scored.push({ u, score });
    }
    scored.sort((a, b) => b.score - a.score || a.u.name.localeCompare(b.u.name));
    return scored.slice(0, maxResults).map(s => s.u);
  }

  function getInitials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p.charAt(0).toUpperCase())
      .join('') || '?';
  }

  function renderPopup(matches, trigger, field) {
    const popup = ensurePopup();
    popup.innerHTML = '';
    currentMatches = matches;
    currentTrigger = trigger;
    activeField = field;

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mention-suggestion-empty';
      empty.textContent = 'No matching users';
      popup.appendChild(empty);
      activeIndex = -1;
    } else {
      activeIndex = 0;
      matches.forEach((u, idx) => {
        const row = document.createElement('div');
        row.className = 'mention-suggestion';
        row.setAttribute('role', 'option');
        if (idx === activeIndex) row.classList.add('active');

        const avatar = document.createElement('span');
        avatar.className = 'mention-avatar';
        if (u.photoThumb) {
          const img = document.createElement('img');
          img.src = u.photoThumb;
          img.alt = '';
          img.referrerPolicy = 'no-referrer';
          img.addEventListener('error', () => {
            img.remove();
            avatar.textContent = getInitials(u.name);
          });
          avatar.appendChild(img);
        } else {
          avatar.textContent = getInitials(u.name);
        }
        row.appendChild(avatar);

        const meta = document.createElement('span');
        meta.className = 'mention-meta';
        const nameEl = document.createElement('span');
        nameEl.className = 'mention-name';
        nameEl.textContent = u.name;
        meta.appendChild(nameEl);
        if (u.email) {
          const emailEl = document.createElement('span');
          emailEl.className = 'mention-email';
          emailEl.textContent = u.email;
          meta.appendChild(emailEl);
        }
        row.appendChild(meta);

        // mousedown so we beat the textarea blur
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          acceptSuggestion(idx);
        });
        popup.appendChild(row);
      });
    }

    popup.style.display = 'block';
    positionPopup(field, trigger.atIndex);
  }

  function highlightActive() {
    if (!popupEl) return;
    const rows = popupEl.querySelectorAll('.mention-suggestion');
    rows.forEach((row, idx) => row.classList.toggle('active', idx === activeIndex));
    const activeRow = rows[activeIndex];
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
  }

  function acceptSuggestion(index) {
    if (!activeField || !currentTrigger) return;
    const user = currentMatches[index];
    if (!user) return;

    const field = activeField;
    const state = fieldStates.get(field);
    const before = field.value.slice(0, currentTrigger.atIndex);
    const after = field.value.slice(field.selectionStart);
    const insertText = `@${user.name} `;
    const newValue = before + insertText + after;

    // Adjust existing mention offsets that sit AFTER the triggered "@".
    const triggerLen = (field.selectionStart - currentTrigger.atIndex);
    const delta = insertText.length - triggerLen;
    if (state) {
      for (const m of state.mentions) {
        if (m.start >= currentTrigger.atIndex) {
          m.start += delta;
          m.end += delta;
        }
      }
      // Drop any mention that overlaps the typed "@<query>" range.
      state.mentions = state.mentions.filter(m =>
        m.end <= currentTrigger.atIndex || m.start >= currentTrigger.atIndex + insertText.length
      );
      // `end` is the INCLUSIVE index of the last char of "@Name" (the final
      // letter of the display name) — NOT the trailing space `insertText`
      // appends, which would break the validation filter on every read.
      state.mentions.push({
        start: currentTrigger.atIndex,
        end: currentTrigger.atIndex + user.name.length,
        userId: String(user.id),
        displayName: user.name,
        profileUrl: user.url || ''
      });
      state.mentions.sort((a, b) => a.start - b.start);
      state.lastValue = newValue;
    }

    field.value = newValue;
    const caret = currentTrigger.atIndex + insertText.length;
    field.selectionStart = caret;
    field.selectionEnd = caret;
    field.focus();

    field.dispatchEvent(new Event('input', { bubbles: true }));
    hidePopup();
  }

  function refreshSuggestions(field) {
    const trigger = detectTrigger(field);
    if (!trigger) {
      hidePopup();
      return;
    }
    const matches = rankUsers(trigger.query);
    renderPopup(matches, trigger, field);
  }

  function reconcileMentions(field) {
    const state = fieldStates.get(field);
    if (!state) return;
    const value = field.value;
    if (value === state.lastValue) return;

    const before = state.lastValue;
    const after = value;

    // Compute a single contiguous diff [start..endBefore) -> [start..endAfter).
    let start = 0;
    const minLen = Math.min(before.length, after.length);
    while (start < minLen && before.charCodeAt(start) === after.charCodeAt(start)) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (
      endBefore > start &&
      endAfter > start &&
      before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
    ) {
      endBefore--;
      endAfter--;
    }
    const delta = (endAfter - start) - (endBefore - start);

    const updated = [];
    for (const m of state.mentions) {
      const exclusiveEnd = m.end + 1; // exclusive end in the old string
      if (exclusiveEnd <= start) {
        // Mention is entirely before the edit; unchanged.
        updated.push(m);
      } else if (m.start >= endBefore) {
        // Mention is entirely after the edit; shift by delta.
        updated.push({ ...m, start: m.start + delta, end: m.end + delta });
      } else {
        // Mention overlaps the edited range -> drop it.
        // (Matches Monday/Slack: editing inside a mention dissolves it.)
      }
    }

    // Validate every surviving mention still spells out "@<displayName>" so
    // we never emit dangling anchor tags if our offsets drift.
    state.mentions = updated.filter(m => {
      const span = value.slice(m.start, m.end + 1);
      return span === `@${m.displayName}`;
    });

    state.lastValue = value;
  }

  function onInput(e) {
    const field = e.target;
    reconcileMentions(field);
    refreshSuggestions(field);
  }

  function onKeyDown(e) {
    const field = e.target;
    if (!popupEl || popupEl.style.display === 'none' || activeField !== field) return;
    if (currentMatches.length === 0) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hidePopup();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentMatches.length;
      highlightActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
      highlightActive();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      acceptSuggestion(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hidePopup();
    }
  }

  function onBlur(e) {
    // Hide on a delay so click-on-suggestion (mousedown) wins.
    setTimeout(() => {
      if (activeField === e.target) hidePopup();
    }, 100);
  }

  function onScroll() {
    if (activeField && currentTrigger) {
      positionPopup(activeField, currentTrigger.atIndex);
    }
  }

  function attach(field) {
    if (!field || fieldStates.has(field)) return;
    fieldStates.set(field, {
      mentions: [],
      lastValue: field.value || ''
    });
    field.addEventListener('input', onInput);
    field.addEventListener('keydown', onKeyDown, true);
    field.addEventListener('blur', onBlur);
    field.addEventListener('click', () => refreshSuggestions(field));
    field.addEventListener('keyup', (e) => {
      // Caret-only navigation keys (arrows etc.) need to re-check the trigger.
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        refreshSuggestions(field);
      }
    });
  }

  function clear(field) {
    const state = fieldStates.get(field);
    if (state) {
      state.mentions = [];
      state.lastValue = field.value || '';
    }
  }

  /**
   * Snapshot a field's tracked mentions so the host page can persist them
   * to storage (e.g. across the create-bug → screenshot → annotate round
   * trip). Returns deep-copied entries so callers can't mutate state.
   */
  function getMentions(field) {
    const state = fieldStates.get(field);
    if (!state) return [];
    return state.mentions.map((m) => ({
      start: m.start,
      end: m.end,
      userId: String(m.userId),
      displayName: m.displayName,
      profileUrl: m.profileUrl || ''
    }));
  }

  /**
   * Replace a field's tracked mentions, validating each entry's offset
   * against the current field value. Mentions whose `[start..end]` range
   * no longer spells out `@<displayName>` are dropped — same rule the
   * input-reconciliation path already applies — so callers can safely
   * round-trip a stored snapshot without leaking stale chips.
   */
  function setMentions(field, mentions) {
    const state = fieldStates.get(field);
    if (!state) return;
    const value = field.value || '';
    const valid = (Array.isArray(mentions) ? mentions : [])
      .filter(
        (m) =>
          m &&
          typeof m.start === 'number' &&
          typeof m.end === 'number' &&
          m.userId != null &&
          typeof m.displayName === 'string' &&
          value.slice(m.start, m.end + 1) === `@${m.displayName}`
      )
      .map((m) => ({
        start: m.start,
        end: m.end,
        userId: String(m.userId),
        displayName: m.displayName,
        profileUrl: m.profileUrl || ''
      }))
      .sort((a, b) => a.start - b.start);
    state.mentions = valid;
    state.lastValue = value;
  }

  /**
   * Serialize `field.value` into HTML, replacing each tracked mention with
   * its rendered markup.
   *
   * Pass `options.seenUserIds` (a shared `Set<string>`) to dedupe mention
   * chips across multiple fields: only the first occurrence per user emits
   * the chip-trigger attrs, so Monday fires exactly one bell notification
   * per user even if they're @-mentioned multiple times.
   */
  function serializeFieldToHtml(field, options = {}) {
    const value = field.value || '';
    const state = fieldStates.get(field);
    const mentions = state
      ? state.mentions
          .filter(m => value.slice(m.start, m.end + 1) === `@${m.displayName}`)
          .sort((a, b) => a.start - b.start)
      : [];

    const seen = options.seenUserIds instanceof Set ? options.seenUserIds : null;

    let cursor = 0;
    let html = '';
    for (const m of mentions) {
      if (m.start < cursor) continue; // overlapping safety net
      html += escapeHtml(value.slice(cursor, m.start)).replace(/\r?\n/g, '<br/>');
      const userIdKey = String(m.userId);
      const isFirstOccurrence = !seen || !seen.has(userIdKey);
      if (seen) seen.add(userIdKey);
      html += renderMentionMarkup(m, isFirstOccurrence);
      cursor = m.end + 1;
    }
    html += escapeHtml(value.slice(cursor)).replace(/\r?\n/g, '<br/>');
    return html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Build the HTML markup for a single mention.
   *
   * First occurrence per user: full Monday-native mention chip markup
   * (renders as a blue chip and triggers a bell notification server-side).
   * Subsequent occurrences: plain `<a href>` to the user's profile (still
   * blue, but won't trigger duplicate notifications).
   *
   * Bold content is always wrapped INSIDE the anchor so we degrade
   * gracefully if Monday's sanitizer drops the anchor.
   */
  function renderMentionMarkup(m, isFirstOccurrence = true) {
    const inner = `<b>${escapeHtml(`@${m.displayName}`)}</b>`;
    if (!m.profileUrl) return inner;
    const href = escapeHtml(m.profileUrl);
    if (!isFirstOccurrence) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    const id = escapeHtml(String(m.userId));
    return (
      `<a class="user_mention_editor router" ` +
      `href="${href}" ` +
      `data-mention-type="User" ` +
      `data-mention-id="${id}" ` +
      `target="_blank" rel="noopener noreferrer">${inner}</a>`
    );
  }

  function positionPopup(field, atIndex) {
    if (!popupEl) return;
    const coords = getCaretCoordinates(field, atIndex);
    const rect = field.getBoundingClientRect();
    const top = rect.top + window.scrollY + coords.top + coords.height + 4;
    const left = rect.left + window.scrollX + coords.left;
    popupEl.style.top = `${top}px`;
    popupEl.style.left = `${left}px`;
  }

  // Document-level handlers for popup dismissal + scroll repositioning.
  document.addEventListener('mousedown', (e) => {
    if (!popupEl || popupEl.style.display === 'none') return;
    if (popupEl.contains(e.target)) return;
    if (e.target === activeField) return;
    hidePopup();
  });
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  return {
    attach,
    clear,
    getMentions,
    setMentions,
    serializeFieldToHtml,
    hidePopup
  };
}

// ---------------------------------------------------------------------------
// Caret coordinate helper (mirror-div technique).
// ---------------------------------------------------------------------------
//
// Computes the pixel offset (relative to the field's content box) of the
// character at `position` inside a <textarea> / <input>. Works by rendering
// the field's text into a hidden div with copied styles and reading the
// span's bounding rect at the target offset.

const MIRROR_PROPERTIES = [
  'boxSizing', 'width', 'height',
  'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration',
  'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize',
  'whiteSpace', 'wordBreak', 'wordWrap'
];

let mirrorDiv = null;

function getMirrorDiv() {
  if (mirrorDiv) return mirrorDiv;
  mirrorDiv = document.createElement('div');
  mirrorDiv.className = 'mention-caret-mirror';
  mirrorDiv.setAttribute('aria-hidden', 'true');
  mirrorDiv.style.position = 'absolute';
  mirrorDiv.style.visibility = 'hidden';
  mirrorDiv.style.top = '0';
  mirrorDiv.style.left = '-9999px';
  document.body.appendChild(mirrorDiv);
  return mirrorDiv;
}

function getCaretCoordinates(field, position) {
  const isInput = field.nodeName === 'INPUT';
  const div = getMirrorDiv();
  const computed = window.getComputedStyle(field);

  const style = div.style;
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  if (isInput) {
    style.whiteSpace = 'nowrap';
    style.overflow = 'hidden';
  }
  for (const prop of MIRROR_PROPERTIES) {
    style[prop] = computed[prop];
  }

  div.textContent = field.value.substring(0, position);

  const span = document.createElement('span');
  // Trailing character so the span has measurable width even at end of input.
  span.textContent = field.value.substring(position) || '.';
  div.appendChild(span);

  const coords = {
    top: span.offsetTop - field.scrollTop,
    left: span.offsetLeft - field.scrollLeft,
    height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 18
  };

  div.removeChild(span);
  div.textContent = '';
  return coords;
}
