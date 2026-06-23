/*
 * Anti Bugs - Theme manager (light / dark)
 *
 * Loaded as a classic, render-blocking <script> in the <head> of every
 * extension page so the saved theme is applied before first paint.
 *
 * - localStorage is read synchronously to avoid a flash of the light theme.
 * - chrome.storage.local holds the shared source of truth so the choice is
 *   consistent across the popup, settings, and modal pages and survives reloads.
 * - chrome.storage.onChanged keeps every open page in sync in real time.
 *
 * A small window.AntiBugsTheme helper is exposed for the toggle controls.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'antibugs-theme';
  var root = document.documentElement;

  function normalize(theme) {
    return theme === 'dark' ? 'dark' : 'light';
  }

  function apply(theme) {
    root.setAttribute('data-theme', normalize(theme));
  }

  // 1) Synchronous apply from localStorage to prevent a flash of light content.
  var cached = 'light';
  try {
    cached = localStorage.getItem(STORAGE_KEY) || 'light';
  } catch (e) { /* localStorage may be unavailable */ }
  apply(cached);

  // 2) Reconcile with chrome.storage.local (shared source of truth) and listen
  //    for changes coming from other pages.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('theme', function (res) {
        var theme = normalize(res && res.theme ? res.theme : cached);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
        apply(theme);
      });

      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.theme) {
          var theme = normalize(changes.theme.newValue);
          try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
          apply(theme);
        }
      });
    }
  } catch (e) { /* chrome.storage may be unavailable in some contexts */ }

  // 3) Public helper used by the toggle controls.
  window.AntiBugsTheme = {
    get: function () {
      try { return normalize(localStorage.getItem(STORAGE_KEY)); } catch (e) { return 'light'; }
    },
    set: function (theme) {
      var next = normalize(theme);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      apply(next);
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ theme: next });
        }
      } catch (e) {}
      return next;
    },
    toggle: function () {
      return this.set(this.get() === 'dark' ? 'light' : 'dark');
    }
  };
})();
