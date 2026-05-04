// Update Bug Case Script - post investigation update + column changes to an existing Monday item

let attachedFiles = [];
let selectedItem = null; // { id, name, url, existingTagIds: [] }
let currentUser = null; // { id, name, email }
let boardTags = []; // all tags available on the current board: [{id, name, color}]
let boardTagsForBoardId = null; // boardId that boardTags was fetched for
let boardResolutionLabels = []; // active labels for the "Resolution status" column
let boardResolutionLabelsForBoardId = null;
const selectedTagIds = new Set(); // numeric tag IDs the user selected to ADD (on top of existing)
const selectedTagMap = new Map(); // id -> { name, color } for rendering chips
let activeSuggestionIndex = -1;

const ESCALATION_STATUSES = new Set([
  'Pending dev',
  'Pending CS',
  'Pending code fix',
  'Pending Data',
  'Waiting for Product',
  'Move to Finance'
]);

// Resolution-status values that should show an explanation textarea, with the
// per-status label/placeholder/error/update-section copy. Anything not listed
// here renders no explanation field. Keys are matched case-insensitively, so
// minor casing differences in the board column don't break the mapping.
const RESOLUTION_EXPLANATION_META = {
  'not a bug': {
    label: 'Why this is expected behavior',
    placeholder: 'Explain why this is expected behavior',
    error: 'Please explain why this is expected behavior.',
    blockTitle: 'Not-a-bug explanation'
  },
  'stuck': {
    label: 'What is blocking progress',
    placeholder: 'Describe what is blocking progress on this ticket',
    error: 'Please describe what is blocking progress on this ticket.',
    blockTitle: 'Stuck reason'
  }
};

function getResolutionExplanationMeta(statusValue) {
  if (!statusValue) return null;
  return RESOLUTION_EXPLANATION_META[statusValue.trim().toLowerCase()] || null;
}

document.addEventListener('DOMContentLoaded', async () => {
  const updateForm = document.getElementById('updateForm');
  const closeBtn = document.getElementById('closeBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const submitBtn = document.getElementById('submitBtn');
  const boardSelect = document.getElementById('boardSelect');
  const itemNameInput = document.getElementById('itemNameInput');
  const findBtn = document.getElementById('findBtn');
  const lookupStatus = document.getElementById('lookupStatus');
  const lookupCandidates = document.getElementById('lookupCandidates');
  const updateFieldsSection = document.getElementById('updateFieldsSection');
  const resolutionStatusSelect = document.getElementById('resolutionStatusSelect');
  const statusSelect = document.getElementById('statusSelect');
  const resolutionExplanationGroup = document.getElementById('resolutionExplanationGroup');
  const resolutionExplanationLabel = document.getElementById('resolutionExplanationLabel');
  const resolutionExplanation = document.getElementById('resolutionExplanation');
  const escalationGroup = document.getElementById('escalationGroup');
  const escalationReason = document.getElementById('escalationReason');
  const tagInput = document.getElementById('tagInput');
  const tagSuggestions = document.getElementById('tagSuggestions');
  const currentTagsDiv = document.getElementById('currentTags');
  const ownerBadge = document.getElementById('ownerBadge');
  const bugDescriptionGroup = document.getElementById('bugDescriptionGroup');
  const bugDescriptionDisplay = document.getElementById('bugDescriptionDisplay');

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  const errorBanner = document.getElementById('errorBanner');
  const errorText = document.getElementById('errorText');
  const errorClose = document.getElementById('errorClose');
  const successBanner = document.getElementById('successBanner');
  const successText = document.getElementById('successText');
  const successLink = document.getElementById('successLink');
  const successClose = document.getElementById('successClose');

  errorClose.addEventListener('click', () => hideError());
  successClose.addEventListener('click', () => hideSuccess());

  function showError(message) {
    console.error('Error:', message);
    errorText.textContent = message;
    errorBanner.style.display = 'flex';
  }

  function hideError() {
    errorBanner.style.display = 'none';
  }

  function showSuccess(message, itemUrl) {
    successText.textContent = message;
    if (itemUrl) {
      successLink.href = itemUrl;
      successLink.style.display = 'inline';
    } else {
      successLink.removeAttribute('href');
      successLink.style.display = 'none';
    }
    successBanner.style.display = 'flex';
    successBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideSuccess() {
    successBanner.style.display = 'none';
  }

  closeBtn.addEventListener('click', () => window.close());
  cancelBtn.addEventListener('click', () => window.close());

  // Load boards and current user in parallel
  await Promise.all([loadBoards(), loadCurrentUser()]);

  // Wire up form submit
  updateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    hideSuccess();
    await submitUpdate();
  });

  // Enable/disable Find button based on board + input
  function refreshFindBtnState() {
    findBtn.disabled = !(boardSelect.value && itemNameInput.value.trim());
  }

  boardSelect.addEventListener('change', () => {
    clearFoundItem();
    // Reset tag + resolution-label caches when changing boards. The dropdown
    // itself is hidden by clearFoundItem(), and the form is only re-shown by
    // selectItem() (which awaits loadResolutionStatusLabels and re-renders),
    // so we don't need to repaint the <select> here.
    boardTags = [];
    boardTagsForBoardId = null;
    boardResolutionLabels = [];
    boardResolutionLabelsForBoardId = null;
    selectedTagIds.clear();
    selectedTagMap.clear();
    refreshFindBtnState();
    // Persist selection and preload board tags + resolution labels in the background
    if (boardSelect.value) {
      chrome.storage.sync.set({ selectedBoardId: boardSelect.value });
      loadBoardTags(boardSelect.value);
      loadResolutionStatusLabels(boardSelect.value);
    }
  });

  itemNameInput.addEventListener('input', () => {
    clearFoundItem();
    refreshFindBtnState();
  });

  itemNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!findBtn.disabled) findBtn.click();
    }
  });

  findBtn.addEventListener('click', findItem);

  resolutionStatusSelect.addEventListener('change', applyResolutionExplanationVisibility);

  function applyResolutionExplanationVisibility() {
    const meta = getResolutionExplanationMeta(resolutionStatusSelect.value);
    if (meta) {
      resolutionExplanationLabel.textContent = `${meta.label}: *`;
      resolutionExplanation.placeholder = meta.placeholder;
      resolutionExplanationGroup.style.display = 'block';
    } else {
      resolutionExplanationGroup.style.display = 'none';
      resolutionExplanation.value = '';
    }
  }

  statusSelect.addEventListener('change', () => {
    const needsReason = ESCALATION_STATUSES.has(statusSelect.value);
    escalationGroup.style.display = needsReason ? 'block' : 'none';
    if (!needsReason) escalationReason.value = '';
  });

  // Tag input - autocomplete against existing board tags
  tagInput.addEventListener('input', () => {
    renderTagSuggestions(tagInput.value.trim());
  });

  tagInput.addEventListener('focus', () => {
    renderTagSuggestions(tagInput.value.trim());
  });

  tagInput.addEventListener('keydown', (e) => {
    const visibleSuggestions = tagSuggestions.querySelectorAll('.tag-suggestion:not(.selected)');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleSuggestions.length === 0) return;
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, visibleSuggestions.length - 1);
      highlightSuggestion(visibleSuggestions);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleSuggestions.length === 0) return;
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      highlightSuggestion(visibleSuggestions);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && visibleSuggestions[activeSuggestionIndex]) {
        visibleSuggestions[activeSuggestionIndex].click();
      } else if (visibleSuggestions.length === 1) {
        visibleSuggestions[0].click();
      }
    } else if (e.key === 'Escape') {
      tagSuggestions.style.display = 'none';
      activeSuggestionIndex = -1;
    }
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tag-input-row')) {
      tagSuggestions.style.display = 'none';
      activeSuggestionIndex = -1;
    }
  });

  // File input / drag & drop / paste
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      handleFiles(files);
      dropZone.style.borderColor = '#28a745';
      dropZone.style.background = 'rgba(40, 167, 69, 0.1)';
      setTimeout(() => {
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
      }, 1000);
    }
  });

  // ===== Board / Group loading (pattern reused from create-bug.js) =====

  async function loadBoards() {
    try {
      const settings = await chrome.storage.sync.get(['mondayToken']);
      if (!settings.mondayToken) {
        boardSelect.innerHTML = '<option value="">Not connected to Monday.com</option>';
        return;
      }

      boardSelect.innerHTML = '<option value="">Loading boards...</option>';
      boardSelect.disabled = true;

      chrome.runtime.sendMessage(
        { action: 'testMondayConnection', token: settings.mondayToken },
        async (response) => {
          if (chrome.runtime.lastError) {
            console.error('Runtime error loading boards:', chrome.runtime.lastError);
            boardSelect.innerHTML = '<option value="">Error loading boards</option>';
            boardSelect.disabled = false;
            return;
          }

          if (response && response.success && response.workspaces) {
            boardSelect.innerHTML = '<option value="">Select a board</option>';

            const boardsByWorkspace = {};
            response.workspaces.forEach(board => {
              const ws = board.workspace?.name || 'No Workspace';
              if (!boardsByWorkspace[ws]) boardsByWorkspace[ws] = [];
              boardsByWorkspace[ws].push(board);
            });

            Object.keys(boardsByWorkspace).sort().forEach(ws => {
              const optgroup = document.createElement('optgroup');
              optgroup.label = ws;
              boardsByWorkspace[ws].forEach(board => {
                const option = document.createElement('option');
                option.value = board.id;
                option.textContent = board.name;
                optgroup.appendChild(option);
              });
              boardSelect.appendChild(optgroup);
            });

            const saved = await chrome.storage.sync.get(['selectedBoardId']);
            if (saved.selectedBoardId) {
              boardSelect.value = saved.selectedBoardId;
              // Preload board tags + resolution-status labels for the persisted board
              loadBoardTags(saved.selectedBoardId);
              loadResolutionStatusLabels(saved.selectedBoardId);
            }

            boardSelect.disabled = false;
            refreshFindBtnState();
          } else {
            boardSelect.innerHTML = '<option value="">Failed to load boards</option>';
            boardSelect.disabled = false;
          }
        }
      );
    } catch (err) {
      console.error('loadBoards error:', err);
      boardSelect.innerHTML = '<option value="">Error loading boards</option>';
      boardSelect.disabled = false;
    }
  }

  async function loadCurrentUser() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getMe' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          ownerBadge.textContent = 'Not connected';
          ownerBadge.classList.add('owner-badge-error');
          console.warn('Could not load current user:', response?.error || chrome.runtime.lastError?.message);
          resolve();
          return;
        }
        currentUser = response.me;
        ownerBadge.textContent = currentUser.name || currentUser.email || `User ${currentUser.id}`;
        resolve();
      });
    });
  }

  // ===== Item lookup =====

  function clearFoundItem() {
    selectedItem = null;
    updateFieldsSection.style.display = 'none';
    submitBtn.disabled = true;
    lookupStatus.className = 'lookup-status';
    lookupStatus.innerHTML = '';
    lookupCandidates.style.display = 'none';
    lookupCandidates.innerHTML = '';
    selectedTagIds.clear();
    selectedTagMap.clear();
    tagInput.disabled = true;
    tagInput.value = '';
    tagSuggestions.style.display = 'none';
    bugDescriptionGroup.style.display = 'none';
    bugDescriptionDisplay.textContent = '';
    bugDescriptionDisplay.classList.remove('is-empty');
  }

  function findItem() {
    hideError();
    hideSuccess();
    const name = itemNameInput.value.trim();
    if (!name) return;

    const boardId = boardSelect.value;
    if (!boardId) {
      lookupStatus.className = 'lookup-status error';
      lookupStatus.textContent = 'Please select a board first.';
      return;
    }

    lookupStatus.className = 'lookup-status info';
    lookupStatus.textContent = 'Searching entire board...';
    lookupCandidates.style.display = 'none';
    lookupCandidates.innerHTML = '';

    chrome.storage.sync.set({ selectedBoardId: boardId });

    chrome.runtime.sendMessage(
      { action: 'findItemByName', boardId, name },
      (response) => {
        if (chrome.runtime.lastError) {
          lookupStatus.className = 'lookup-status error';
          lookupStatus.textContent = 'Error: ' + chrome.runtime.lastError.message;
          return;
        }
        if (!response || !response.success) {
          lookupStatus.className = 'lookup-status error';
          lookupStatus.textContent = 'Error: ' + (response?.error || 'Unknown error');
          return;
        }

        const items = response.items || [];
        if (items.length === 0) {
          lookupStatus.className = 'lookup-status error';
          lookupStatus.textContent = `No item matching "${name}" found on this board.`;
          return;
        }

        // Prefer exact match
        const exact = items.find(it => it.name === name);
        if (exact) {
          selectItem(exact);
          return;
        }

        if (items.length === 1) {
          selectItem(items[0]);
          return;
        }

        // Multiple matches - ask user to pick
        lookupStatus.className = 'lookup-status info';
        lookupStatus.textContent = `${items.length} possible matches - pick the correct one:`;
        lookupCandidates.style.display = 'block';
        items.forEach(item => {
          const div = document.createElement('div');
          div.className = 'lookup-candidate';
          const nameEl = document.createElement('div');
          nameEl.className = 'cand-name';
          nameEl.textContent = item.name;
          const meta = document.createElement('div');
          meta.className = 'cand-meta';
          const groupTitle = item.group?.title;
          meta.textContent = groupTitle
            ? `Group: ${groupTitle} · ID: ${item.id}`
            : `ID: ${item.id}`;
          div.appendChild(nameEl);
          div.appendChild(meta);
          div.addEventListener('click', () => selectItem(item));
          lookupCandidates.appendChild(div);
        });
      }
    );
  }

  async function selectItem(item) {
    selectedItem = {
      id: item.id,
      name: item.name,
      url: item.url,
      existingTagIds: extractTagIds(item),
      existingTagNames: extractTagNames(item)
    };

    lookupStatus.className = 'lookup-status success';
    lookupStatus.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `Found: ${item.name}`;
    lookupStatus.appendChild(label);
    if (item.url) {
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open in Monday';
      lookupStatus.appendChild(link);
    }

    lookupCandidates.style.display = 'none';
    lookupCandidates.innerHTML = '';
    updateFieldsSection.style.display = 'block';
    submitBtn.disabled = false;

    const descCol = findDescriptionColumn(item);
    if (!descCol) {
      bugDescriptionGroup.style.display = 'none';
      bugDescriptionDisplay.textContent = '';
      bugDescriptionDisplay.classList.remove('is-empty');
      showError('This board has no "Description" column, so the bug case description cannot be displayed.');
    } else {
      const text = (descCol.text || '').trim();
      bugDescriptionDisplay.textContent = text || '(No description provided)';
      bugDescriptionDisplay.classList.toggle('is-empty', !text);
      bugDescriptionGroup.style.display = 'block';
    }

    // Make sure board tags + resolution labels are available; then render chips + enable input
    await Promise.all([
      loadBoardTags(boardSelect.value),
      loadResolutionStatusLabels(boardSelect.value)
    ]);
    tagInput.disabled = boardTags.length === 0;
    if (boardTags.length === 0) {
      tagInput.placeholder = 'No tags available on this board';
    } else {
      tagInput.placeholder = 'Start typing to search existing tags...';
    }
    renderTags();
  }

  function extractTagIds(item) {
    const tagsCol = (item.column_values || []).find(col =>
      col.column?.title?.toLowerCase() === 'tags tech support'
    );
    if (!tagsCol || !tagsCol.value) return [];
    try {
      const parsed = JSON.parse(tagsCol.value);
      // "tag"/"tags" column → tag_ids, "dropdown" column → ids
      if (Array.isArray(parsed.tag_ids)) return parsed.tag_ids;
      if (Array.isArray(parsed.ids)) return parsed.ids;
      return [];
    } catch (e) {
      return [];
    }
  }

  function findDescriptionColumn(item) {
    return (item.column_values || []).find(col =>
      (col.column?.title || '').trim().toLowerCase() === 'description'
    );
  }

  function extractTagNames(item) {
    const tagsCol = (item.column_values || []).find(col =>
      col.column?.title?.toLowerCase() === 'tags tech support'
    );
    if (!tagsCol || !tagsCol.text) return [];
    return tagsCol.text.split(',').map(s => s.trim()).filter(Boolean);
  }

  // ===== Tags =====

  async function loadBoardTags(boardId) {
    if (!boardId) return;
    if (boardTagsForBoardId === boardId && boardTags.length > 0) return; // cached

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'fetchBoardTags', boardId }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          console.warn('Failed to load board tags:', response?.error || chrome.runtime.lastError?.message);
          boardTags = [];
          boardTagsForBoardId = boardId;
          resolve();
          return;
        }
        boardTags = response.tags || [];
        boardTagsForBoardId = boardId;
        console.log(`Loaded ${boardTags.length} board tag(s)`);
        resolve();
      });
    });
  }

  // ===== Resolution status labels =====
  // We always fetch fresh on board change so adding/removing/renaming/
  // deactivating a label on the Monday board flows through to this dropdown
  // without code changes. The background script uses Monday's typed `settings`
  // object so deactivated labels are excluded server-side.

  async function loadResolutionStatusLabels(boardId) {
    if (!boardId) return;
    if (boardResolutionLabelsForBoardId === boardId) return; // cached for this board

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'fetchActiveStatusLabels', boardId, columnTitle: 'Resolution status' },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            console.warn(
              'Failed to load resolution status labels:',
              response?.error || chrome.runtime.lastError?.message
            );
            boardResolutionLabels = [];
          } else {
            boardResolutionLabels = Array.isArray(response.labels) ? response.labels : [];
            console.log(
              `Loaded ${boardResolutionLabels.length} active "Resolution status" label(s):`,
              boardResolutionLabels.map(l => l.name)
            );
          }
          boardResolutionLabelsForBoardId = boardId;
          renderResolutionStatusOptions();
          resolve();
        }
      );
    });
  }

  function renderResolutionStatusOptions() {
    const previousValue = resolutionStatusSelect.value;

    // Replace options while keeping the leading placeholder
    resolutionStatusSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Leave unchanged --';
    resolutionStatusSelect.appendChild(placeholder);

    boardResolutionLabels.forEach(lbl => {
      const opt = document.createElement('option');
      opt.value = lbl.name;
      opt.textContent = lbl.name;
      resolutionStatusSelect.appendChild(opt);
    });

    if (previousValue && boardResolutionLabels.some(l => l.name === previousValue)) {
      resolutionStatusSelect.value = previousValue;
    } else {
      resolutionStatusSelect.value = '';
    }

    applyResolutionExplanationVisibility();
  }

  function existingTagIdSet() {
    return new Set((selectedItem?.existingTagIds || []).map(id => parseInt(id)));
  }

  function renderTags() {
    currentTagsDiv.innerHTML = '';

    // Existing tags on the item (read-only, shown with names looked up from boardTags when possible)
    const existingIds = selectedItem?.existingTagIds || [];
    const existingNames = selectedItem?.existingTagNames || [];
    existingIds.forEach((id, idx) => {
      const boardTag = boardTags.find(t => parseInt(t.id) === parseInt(id));
      const name = boardTag?.name || existingNames[idx] || `Tag ${id}`;
      const chip = document.createElement('span');
      chip.className = 'tag-chip existing';
      chip.title = 'Existing tag on this item';
      chip.textContent = name;
      currentTagsDiv.appendChild(chip);
    });

    // New tags the user added
    selectedTagIds.forEach(id => {
      const info = selectedTagMap.get(id);
      if (!info) return;
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = info.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-tag';
      remove.textContent = '\u00d7';
      remove.title = 'Remove tag';
      remove.addEventListener('click', () => {
        selectedTagIds.delete(id);
        selectedTagMap.delete(id);
        renderTags();
        // Refresh suggestions in case the removed tag should reappear
        if (document.activeElement === tagInput) {
          renderTagSuggestions(tagInput.value.trim());
        }
      });
      chip.appendChild(remove);
      currentTagsDiv.appendChild(chip);
    });
  }

  function renderTagSuggestions(query) {
    tagSuggestions.innerHTML = '';
    activeSuggestionIndex = -1;

    if (boardTags.length === 0) {
      tagSuggestions.style.display = 'none';
      return;
    }

    const q = (query || '').toLowerCase();
    const existingIds = existingTagIdSet();

    const matches = boardTags
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .slice(0, 20);

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tag-suggestion-empty';
      empty.textContent = 'No matching tags. Add new tags via the Monday board.';
      tagSuggestions.appendChild(empty);
      tagSuggestions.style.display = 'block';
      return;
    }

    matches.forEach(tag => {
      const id = parseInt(tag.id);
      const alreadyOnItem = existingIds.has(id);
      const alreadySelected = selectedTagIds.has(id);

      const div = document.createElement('div');
      div.className = 'tag-suggestion';
      if (alreadyOnItem || alreadySelected) {
        div.classList.add('selected');
      }

      const swatch = document.createElement('span');
      swatch.className = 'tag-swatch';
      if (tag.color) swatch.style.background = tag.color;
      div.appendChild(swatch);

      const nameEl = document.createElement('span');
      nameEl.className = 'tag-name';
      nameEl.textContent = tag.name;
      div.appendChild(nameEl);

      if (alreadyOnItem) {
        const hint = document.createElement('span');
        hint.className = 'tag-hint-text';
        hint.textContent = 'already on item';
        div.appendChild(hint);
      } else if (alreadySelected) {
        const hint = document.createElement('span');
        hint.className = 'tag-hint-text';
        hint.textContent = 'added';
        div.appendChild(hint);
      }

      if (!alreadyOnItem && !alreadySelected) {
        div.addEventListener('click', () => {
          selectedTagIds.add(id);
          selectedTagMap.set(id, { name: tag.name, color: tag.color });
          tagInput.value = '';
          renderTags();
          renderTagSuggestions('');
          tagInput.focus();
        });
      }

      tagSuggestions.appendChild(div);
    });

    tagSuggestions.style.display = 'block';
  }

  function highlightSuggestion(visibleEls) {
    tagSuggestions.querySelectorAll('.tag-suggestion.active').forEach(el => el.classList.remove('active'));
    const el = visibleEls[activeSuggestionIndex];
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  // ===== Files =====

  function handleFiles(files) {
    Array.from(files).forEach(file => {
      const MAX_SIZE = 500 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(2);
        showError(`File "${file.name}" is too large (${sizeMB} MB). Maximum size is 500 MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const fileData = {
          id: `file-${Date.now()}-${Math.random()}`,
          name: file.name,
          dataUrl: e.target.result,
          type: file.type,
          size: file.size
        };
        attachedFiles.push(fileData);
        displayFile(fileData);
      };
      reader.onerror = () => showError(`Failed to read file "${file.name}".`);
      reader.readAsDataURL(file);
    });
  }

  function displayFile(file) {
    const filesList = document.getElementById('filesList');
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.id = file.id;
    const icon = getFileIcon(file.type);
    const size = formatFileSize(file.size);
    item.innerHTML = `
      <span class="file-icon">${icon}</span>
      <div class="file-info">
        <div class="file-name"></div>
        <div class="file-size">${size}</div>
      </div>
      <button class="remove-btn" title="Remove">×</button>
    `;
    // Set name via textContent to avoid any injection
    item.querySelector('.file-name').textContent = file.name;
    item.querySelector('.remove-btn').addEventListener('click', () => {
      attachedFiles = attachedFiles.filter(f => f.id !== file.id);
      item.remove();
    });
    filesList.appendChild(item);
  }

  function getFileIcon(type) {
    if (type?.startsWith('image/')) return 'IMG';
    if (type?.startsWith('video/')) return 'VID';
    if (type === 'application/pdf') return 'PDF';
    if (type === 'application/json' || type === 'application/har+json') return 'LOG';
    return 'FILE';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ===== Submit =====

  function buildUpdateBody(fields) {
    // Monday's create_update body is HTML-formatted, so we render the same
    // content with lightweight HTML for a clean, scannable update.
    const escapeHtml = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const multiline = (s) => escapeHtml(s).replace(/\r?\n/g, '<br/>');

    const block = (label, value) =>
      `<p><b>${escapeHtml(label)}:</b><br/>${multiline(value)}</p>`;
    const inline = (label, value) =>
      `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`;

    const parts = [];
    parts.push('<h3><b>Tech Support Update</b></h3>');
    parts.push('<hr/>');

    parts.push(block('Problem', fields.problemDescription));
    parts.push(block('Expected', fields.expectedBehavior));

    if (fields.checksPerformed) {
      parts.push(block('Checks Performed', fields.checksPerformed));
    }

    parts.push(block('Action Taken', fields.actionTaken));

    if (fields.resolutionStatus) {
      parts.push(inline('Resolution', fields.resolutionStatus));
      const meta = getResolutionExplanationMeta(fields.resolutionStatus);
      if (meta && fields.resolutionExplanation) {
        parts.push(block(meta.blockTitle, fields.resolutionExplanation));
      }
    }

    if (fields.status) {
      parts.push(inline('Status', fields.status));
      if (ESCALATION_STATUSES.has(fields.status) && fields.escalationReason) {
        parts.push(block('Escalation reason', fields.escalationReason));
      }
    }

    if (fields.additionalNotes) {
      parts.push(block('Additional Notes', fields.additionalNotes));
    }

    if (currentUser?.name) {
      parts.push('<hr/>');
      parts.push(`<p><i>Updated by: <b>${escapeHtml(currentUser.name)}</b></i></p>`);
    }

    return parts.join('');
  }

  async function submitUpdate() {
    try {
      if (!selectedItem) {
        showError('Please find and select an existing item first.');
        return;
      }

      // Collect and validate
      const fields = {
        problemDescription: document.getElementById('problemDescription').value.trim(),
        expectedBehavior: document.getElementById('expectedBehavior').value.trim(),
        checksPerformed: document.getElementById('checksPerformed').value.trim(),
        actionTaken: document.getElementById('actionTaken').value.trim(),
        resolutionStatus: resolutionStatusSelect.value,
        resolutionExplanation: resolutionExplanation.value.trim(),
        status: statusSelect.value,
        escalationReason: escalationReason.value.trim(),
        additionalNotes: document.getElementById('additionalNotes').value.trim()
      };

      if (!fields.problemDescription) return showError('Please provide a short description of the problem.');
      if (!fields.expectedBehavior) return showError('Please describe what is expected.');
      if (!fields.actionTaken) return showError('Please describe the action taken.');

      const resolutionMeta = getResolutionExplanationMeta(fields.resolutionStatus);
      if (resolutionMeta && !fields.resolutionExplanation) {
        return showError(resolutionMeta.error);
      }
      if (ESCALATION_STATUSES.has(fields.status) && !fields.escalationReason) {
        return showError('Please explain why escalation is needed.');
      }

      submitBtn.disabled = true;
      document.getElementById('submitBtnText').textContent = 'Updating...';
      document.getElementById('submitSpinner').style.display = 'inline-block';
      document.getElementById('uploadProgress').style.display = 'block';
      updateProgress(10, 'Preparing update...');

      const body = buildUpdateBody(fields);

      // Store attachments in local storage (message size limit workaround)
      if (attachedFiles.length > 0) {
        await chrome.storage.local.set({ pendingAttachments: attachedFiles });
      }

      updateProgress(25, 'Posting update to ticket...');

      const payload = {
        action: 'updateBugCase',
        itemId: selectedItem.id,
        itemUrl: selectedItem.url,
        boardId: boardSelect.value,
        body,
        resolutionStatus: fields.resolutionStatus || null,
        status: fields.status || null,
        personId: currentUser?.id ? parseInt(currentUser.id) : null,
        tagIdsToAdd: Array.from(selectedTagIds),
        existingTagIds: selectedItem.existingTagIds || [],
        attachmentCount: attachedFiles.length
      };

      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          showError('Extension error: ' + chrome.runtime.lastError.message);
          resetSubmitState();
          return;
        }
        if (!response || !response.success) {
          showError(response?.error || 'Update failed');
          resetSubmitState();
          return;
        }

        // Success path
        const successCount = response.successfulUpdates?.length || 0;
        const failedCount = response.failedUpdates?.length || 0;
        let msg = 'Update posted.';
        if (successCount > 0) msg += ` ${successCount} field(s) updated.`;
        if (failedCount > 0) msg += ` ${failedCount} field update(s) failed.`;

        if (response.uploadResults) {
          const { uploaded = [], failed = [], skipped = [] } = response.uploadResults;
          if (uploaded.length > 0) updateProgress(90, `Uploaded ${uploaded.length} file(s)...`);
          if (skipped.length > 0) {
            showError(`Update complete, but ${skipped.length} file(s) were too large: ${skipped.map(f => f.name).join(', ')}.`);
          } else if (failed.length > 0) {
            showError(`Update complete, but ${failed.length} file(s) failed to upload: ${failed.map(f => f.name).join(', ')}.`);
          }
        }

        updateProgress(100, msg);

        const itemUrl = response.item?.url || selectedItem?.url || null;
        const itemName = response.item?.name || selectedItem?.name || 'Ticket';
        showSuccess(`${itemName} updated successfully.`, itemUrl);

        // Reset the form so the user can keep updating tickets under the
        // same board + group, without opening Monday or closing the tab.
        resetFormAfterSubmit();
      });
    } catch (err) {
      console.error('submitUpdate error:', err);
      showError('Failed to update case: ' + err.message);
      resetSubmitState();
    }
  }

  function resetSubmitState() {
    submitBtn.disabled = false;
    document.getElementById('submitBtnText').textContent = 'Update Case';
    document.getElementById('submitSpinner').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
  }

  function resetFormAfterSubmit() {
    // Reset submit button / progress UI
    resetSubmitState();
    // Submit stays disabled until a new item is found
    submitBtn.disabled = true;

    // Clear selected item + lookup UI
    itemNameInput.value = '';
    clearFoundItem();
    refreshFindBtnState();

    // Clear text fields
    document.getElementById('problemDescription').value = '';
    document.getElementById('expectedBehavior').value = '';
    document.getElementById('checksPerformed').value = '';
    document.getElementById('actionTaken').value = '';
    document.getElementById('additionalNotes').value = '';
    resolutionExplanation.value = '';
    escalationReason.value = '';

    // Reset selects + conditional fields
    resolutionStatusSelect.value = '';
    statusSelect.value = '';
    resolutionExplanationGroup.style.display = 'none';
    escalationGroup.style.display = 'none';

    // Clear tag selections and rendered chips
    selectedTagIds.clear();
    selectedTagMap.clear();
    tagInput.value = '';
    tagSuggestions.style.display = 'none';
    tagSuggestions.innerHTML = '';
    currentTagsDiv.innerHTML = '';

    // Clear attachments (both state and pending-storage cache)
    attachedFiles = [];
    const filesList = document.getElementById('filesList');
    if (filesList) filesList.innerHTML = '';
    chrome.storage.local.remove('pendingAttachments').catch(() => {});

    // Focus the next lookup for fast consecutive updates
    itemNameInput.focus();
  }

  function updateProgress(percent, text) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
  }
});
