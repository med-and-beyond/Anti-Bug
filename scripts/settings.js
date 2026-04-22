// Settings Script - Handles Monday.com connection and preferences

// Store all boards for filtering
let allBoards = [];
let filteredBoards = [];

// In-memory saved configurations state (mirrors chrome.storage.sync)
let savedConfigurations = [];
let defaultConfigurationId = null;

// Build a stable id from board + group ids
function buildConfigId(boardId, groupId) {
  return `${boardId}:${groupId}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Easter Egg: Click logo 17 times to open random Oggy video
  const logoImg = document.querySelector('.header-logo');
  if (logoImg) {
    logoImg.addEventListener('click', async () => {
      // Get current click count from storage
      const result = await chrome.storage.local.get(['oggyClickCount']);
      let clickCount = result.oggyClickCount || 0;
      
      // Increment counter
      clickCount++;
      
      // Save updated count
      await chrome.storage.local.set({ oggyClickCount: clickCount });
      
      console.log(`Oggy easter egg clicks: ${clickCount}/17`);
      
      // On 17th click, open random video and reset counter
      if (clickCount >= 17) {
        // Working videos from @oggy YouTube channel
        const oggyVideos = [
          'https://www.youtube.com/watch?v=4auOwokj2qg',
          'https://www.youtube.com/watch?v=a8-ySFmij_I',
          'https://www.youtube.com/watch?v=jfcrY85C_-k',
          'https://www.youtube.com/watch?v=JmB6a6D-N7M',
          'https://www.youtube.com/watch?v=-7jAVwbqCUE',
          'https://www.youtube.com/watch?v=JrjpYGoAbnk',
          'https://www.youtube.com/watch?v=jQsRsx0pgzc',
          'https://www.youtube.com/watch?v=Paoy_GPjMt0',
          'https://www.youtube.com/watch?v=l-__1DzJViE',
          'https://www.youtube.com/watch?v=rMYZx6pxJLk'
        ];
        
        const randomVideo = oggyVideos[Math.floor(Math.random() * oggyVideos.length)];
        chrome.tabs.create({ url: randomVideo });
        
        // Reset counter
        await chrome.storage.local.set({ oggyClickCount: 0 });
        console.log('Oggy easter egg activated! Counter reset.');
      }
    });
  }
  
  // Load current settings
  await loadSettings();

  // Event listeners
  document.getElementById('toggleToken').addEventListener('click', toggleTokenVisibility);
  document.getElementById('testConnectionBtn').addEventListener('click', testConnection);
  document.getElementById('saveTokenBtn').addEventListener('click', saveToken);
  document.getElementById('disconnectBtn').addEventListener('click', disconnect);
  document.getElementById('boardSelect').addEventListener('change', loadGroups);
  document.getElementById('addConfigurationBtn').addEventListener('click', addConfiguration);
  document.getElementById('saveConsentBtn').addEventListener('click', saveConsent);
  document.getElementById('clearDataBtn').addEventListener('click', clearData);
  
  // Board search functionality
  const boardSearch = document.getElementById('boardSearch');
  const clearBoardSearch = document.getElementById('clearBoardSearch');
  
  let searchTimeout;
  boardSearch.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const searchValue = e.target.value;
    
    // Show/hide clear button
    clearBoardSearch.style.display = searchValue ? 'block' : 'none';
    
    // Debounce search
    searchTimeout = setTimeout(() => {
      filterBoards(searchValue);
    }, 200);
  });
  
  clearBoardSearch.addEventListener('click', () => {
    boardSearch.value = '';
    clearBoardSearch.style.display = 'none';
    filterBoards('');
    boardSearch.focus();
  });

  async function loadSettings() {
    try {
      const settings = await chrome.storage.sync.get([
        'mondayToken',
        'selectedBoardId',
        'selectedGroupId',
        'savedConfigurations',
        'defaultConfigurationId',
        'screenshotConsent'
      ]);

      // Token
      if (settings.mondayToken) {
        document.getElementById('mondayToken').value = settings.mondayToken;
        updateConnectionStatus(true);
        await loadBoards(settings.mondayToken);
      }

      // Consent
      document.getElementById('screenshotConsent').checked = settings.screenshotConsent !== false;

      // Saved configurations state (with one-time migration from legacy single selection)
      savedConfigurations = Array.isArray(settings.savedConfigurations)
        ? settings.savedConfigurations
        : [];
      defaultConfigurationId = settings.defaultConfigurationId || null;

      if (savedConfigurations.length === 0 && settings.selectedBoardId && settings.selectedGroupId) {
        const migrated = await migrateLegacySelection(
          settings.selectedBoardId,
          settings.selectedGroupId
        );
        if (migrated) {
          savedConfigurations = [migrated];
          defaultConfigurationId = migrated.id;
          await persistConfigurations();
        }
      }

      renderSavedConfigurations();
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  // Build a configuration entry from the legacy single selection using already-loaded board data.
  // Returns null if the board or group can't be resolved (e.g., no longer accessible).
  async function migrateLegacySelection(boardId, groupId) {
    const board = allBoards.find(b => String(b.id) === String(boardId));
    if (!board) {
      console.warn('Migration skipped: board no longer accessible', boardId);
      return null;
    }
    const group = (board.groups || []).find(g => String(g.id) === String(groupId));
    if (!group) {
      console.warn('Migration skipped: group no longer in board', boardId, groupId);
      return null;
    }
    return {
      id: buildConfigId(board.id, group.id),
      boardId: String(board.id),
      boardName: board.name,
      groupId: String(group.id),
      groupTitle: group.title,
      workspaceName: board.workspace?.name || 'No Workspace'
    };
  }

  function toggleTokenVisibility() {
    const input = document.getElementById('mondayToken');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  async function testConnection() {
    const token = document.getElementById('mondayToken').value.trim();
    
    if (!token) {
      alert('Please enter an API token');
      return;
    }

    const btn = document.getElementById('testConnectionBtn');
    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'testMondayConnection', token: token },
          resolve
        );
      });

      if (response.success) {
        alert('Connection successful!');
        updateConnectionStatus(true);
        await loadBoards(token);
      } else {
        alert('Connection failed: ' + response.error);
        updateConnectionStatus(false);
      }
    } catch (error) {
      alert('Connection error: ' + error.message);
      updateConnectionStatus(false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }

  async function saveToken() {
    const token = document.getElementById('mondayToken').value.trim();
    
    if (!token) {
      alert('Please enter an API token');
      return;
    }

    try {
      await chrome.storage.sync.set({ mondayToken: token });
      alert('Token saved successfully');
      updateConnectionStatus(true);
    } catch (error) {
      alert('Failed to save token: ' + error.message);
    }
  }

  async function disconnect() {
    if (!confirm('Are you sure you want to disconnect? This will remove your token and settings.')) {
      return;
    }

    try {
      await chrome.storage.sync.remove([
        'mondayToken',
        'selectedBoardId',
        'selectedGroupId',
        'savedConfigurations',
        'defaultConfigurationId'
      ]);
      await chrome.storage.local.remove(['activePopupConfigId']);

      savedConfigurations = [];
      defaultConfigurationId = null;

      document.getElementById('mondayToken').value = '';
      document.getElementById('boardSelect').innerHTML = '<option value="">Select a board...</option>';
      document.getElementById('groupSelect').innerHTML = '<option value="">Select board first</option>';
      renderSavedConfigurations();

      updateConnectionStatus(false);
      alert('Disconnected successfully');
    } catch (error) {
      alert('Failed to disconnect: ' + error.message);
    }
  }

  function updateConnectionStatus(connected) {
    const badge = document.getElementById('statusBadge');
    badge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    badge.textContent = connected ? 'Connected' : 'Disconnected';
  }

  async function loadBoards(token) {
    try {
      console.log('Loading all boards with pagination...');
      const boardSelect = document.getElementById('boardSelect');
      const boardSelectStatus = document.getElementById('boardSelectStatus');
      const boardCount = document.getElementById('boardCount');
      
      // Show loading state
      boardSelect.innerHTML = '<option value="">Loading boards...</option>';
      boardSelect.disabled = true;
      boardSelectStatus.classList.add('loading');
      boardCount.textContent = 'Loading boards...';

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'testMondayConnection', token: token },
          resolve
        );
      });

      if (response.success && response.workspaces) {
        allBoards = response.workspaces;
        console.log(`Loaded ${allBoards.length} total boards`);
        
        // Initially show all boards
        filteredBoards = allBoards;
        displayBoards(filteredBoards);
        
        // Update count
        updateBoardCount(filteredBoards.length, allBoards.length);

        boardSelect.disabled = false;
        boardSelectStatus.classList.remove('loading');
      } else {
        boardSelect.innerHTML = '<option value="">Failed to load boards</option>';
        boardCount.textContent = 'Failed to load boards';
        boardSelect.disabled = false;
        boardSelectStatus.classList.remove('loading');
      }
    } catch (error) {
      console.error('Error loading boards:', error);
      document.getElementById('boardSelect').innerHTML = '<option value="">Error loading boards</option>';
      document.getElementById('boardCount').textContent = 'Error loading boards';
      document.getElementById('boardSelect').disabled = false;
      document.getElementById('boardSelectStatus').classList.remove('loading');
    }
  }
  
  function displayBoards(boards) {
    const boardSelect = document.getElementById('boardSelect');
    boardSelect.innerHTML = '<option value="">Select a board...</option>';
    
    if (boards.length === 0) {
      boardSelect.innerHTML = '<option value="">No boards found</option>';
      return;
    }
    
    // Group boards by workspace
    const boardsByWorkspace = {};
    boards.forEach(board => {
      const workspaceName = board.workspace?.name || 'No Workspace';
      if (!boardsByWorkspace[workspaceName]) {
        boardsByWorkspace[workspaceName] = [];
      }
      boardsByWorkspace[workspaceName].push(board);
    });
    
    // Sort workspace names
    const workspaceNames = Object.keys(boardsByWorkspace).sort();
    
    // Add boards grouped by workspace
    workspaceNames.forEach(workspaceName => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = workspaceName;
      
      boardsByWorkspace[workspaceName].forEach(board => {
        const option = document.createElement('option');
        option.value = board.id;
        option.textContent = board.name;
        option.dataset.groups = JSON.stringify(board.groups);
        option.dataset.workspace = workspaceName;
        optgroup.appendChild(option);
      });
      
      boardSelect.appendChild(optgroup);
    });
  }
  
  function filterBoards(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      // No search, show all boards
      filteredBoards = allBoards;
    } else {
      // Filter by board name or workspace name
      const term = searchTerm.toLowerCase();
      filteredBoards = allBoards.filter(board => {
        const boardName = board.name.toLowerCase();
        const workspaceName = (board.workspace?.name || '').toLowerCase();
        return boardName.includes(term) || workspaceName.includes(term);
      });
    }
    
    console.log(`Filtered to ${filteredBoards.length} boards`);
    displayBoards(filteredBoards);
    updateBoardCount(filteredBoards.length, allBoards.length);
  }
  
  function updateBoardCount(filtered, total) {
    const boardCount = document.getElementById('boardCount');
    if (filtered === total) {
      boardCount.textContent = `Showing all ${total} board${total !== 1 ? 's' : ''}`;
    } else {
      boardCount.textContent = `Showing ${filtered} of ${total} boards`;
    }
  }

  async function loadGroups() {
    const boardSelect = document.getElementById('boardSelect');
    const groupSelect = document.getElementById('groupSelect');
    const selectedOption = boardSelect.options[boardSelect.selectedIndex];

    if (!selectedOption || !selectedOption.dataset.groups) {
      groupSelect.innerHTML = '<option value="">Select board first</option>';
      return;
    }

    const groups = JSON.parse(selectedOption.dataset.groups);

    groupSelect.innerHTML = '<option value="">Select a group...</option>';
    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.title;
      groupSelect.appendChild(option);
    });
  }

  async function addConfiguration() {
    const boardSelect = document.getElementById('boardSelect');
    const groupSelect = document.getElementById('groupSelect');
    const boardId = boardSelect.value;
    const groupId = groupSelect.value;

    if (!boardId || !groupId) {
      alert('Please select both board and group');
      return;
    }

    const id = buildConfigId(boardId, groupId);
    if (savedConfigurations.some(cfg => cfg.id === id)) {
      alert('This board and group combination is already saved.');
      return;
    }

    const board = allBoards.find(b => String(b.id) === String(boardId));
    const group = board ? (board.groups || []).find(g => String(g.id) === String(groupId)) : null;

    if (!board || !group) {
      alert('Could not resolve board or group details. Please try again.');
      return;
    }

    const configuration = {
      id,
      boardId: String(board.id),
      boardName: board.name,
      groupId: String(group.id),
      groupTitle: group.title,
      workspaceName: board.workspace?.name || 'No Workspace'
    };

    savedConfigurations.push(configuration);
    if (!defaultConfigurationId) {
      defaultConfigurationId = configuration.id;
    }

    try {
      await persistConfigurations();
      renderSavedConfigurations();

      // Reset the form selections so the next add starts cleanly
      boardSelect.value = '';
      groupSelect.innerHTML = '<option value="">Select board first</option>';
    } catch (error) {
      // Roll back the in-memory change if persistence fails
      savedConfigurations = savedConfigurations.filter(c => c.id !== configuration.id);
      if (defaultConfigurationId === configuration.id) {
        defaultConfigurationId = savedConfigurations[0]?.id || null;
      }
      alert('Failed to add configuration: ' + error.message);
    }
  }

  async function setDefaultConfiguration(id) {
    if (!savedConfigurations.some(cfg => cfg.id === id)) return;
    const previousDefault = defaultConfigurationId;
    defaultConfigurationId = id;
    try {
      await persistConfigurations();
      renderSavedConfigurations();
    } catch (error) {
      defaultConfigurationId = previousDefault;
      alert('Failed to set default: ' + error.message);
    }
  }

  async function removeConfiguration(id) {
    const index = savedConfigurations.findIndex(cfg => cfg.id === id);
    if (index === -1) return;

    const removed = savedConfigurations[index];
    const confirmMessage = `Remove "${removed.boardName} / ${removed.groupTitle}" from your bug lists?`;
    if (!confirm(confirmMessage)) return;

    const snapshot = {
      configs: savedConfigurations.slice(),
      defaultId: defaultConfigurationId
    };

    savedConfigurations.splice(index, 1);
    if (defaultConfigurationId === id) {
      defaultConfigurationId = savedConfigurations[0]?.id || null;
    }

    try {
      await persistConfigurations();

      // If the popup was showing the removed configuration, clear that pointer
      const local = await chrome.storage.local.get(['activePopupConfigId']);
      if (local.activePopupConfigId === id) {
        await chrome.storage.local.remove(['activePopupConfigId']);
      }

      renderSavedConfigurations();
    } catch (error) {
      savedConfigurations = snapshot.configs;
      defaultConfigurationId = snapshot.defaultId;
      alert('Failed to remove configuration: ' + error.message);
    }
  }

  // Persist savedConfigurations + defaultConfigurationId, and keep legacy
  // selectedBoardId/selectedGroupId in sync with the default so Create Bug /
  // Update Bug Case continue to work unchanged.
  async function persistConfigurations() {
    const payload = {
      savedConfigurations,
      defaultConfigurationId
    };

    const defaultConfig = savedConfigurations.find(cfg => cfg.id === defaultConfigurationId);
    if (defaultConfig) {
      payload.selectedBoardId = defaultConfig.boardId;
      payload.selectedGroupId = defaultConfig.groupId;
      await chrome.storage.sync.set(payload);
    } else {
      await chrome.storage.sync.set(payload);
      await chrome.storage.sync.remove(['selectedBoardId', 'selectedGroupId']);
    }
  }

  function renderSavedConfigurations() {
    const container = document.getElementById('savedConfigurations');
    if (!container) return;

    container.innerHTML = '';

    if (savedConfigurations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-inline';
      empty.textContent = 'No configurations saved yet. Add your first one below.';
      container.appendChild(empty);
      return;
    }

    savedConfigurations.forEach(cfg => {
      const row = document.createElement('div');
      row.className = 'config-row' + (cfg.id === defaultConfigurationId ? ' is-default' : '');

      const main = document.createElement('div');
      main.className = 'config-row-main';

      const title = document.createElement('div');
      title.className = 'config-row-title';
      title.textContent = `${cfg.boardName} / ${cfg.groupTitle}`;

      const meta = document.createElement('div');
      meta.className = 'config-row-meta';
      meta.textContent = cfg.workspaceName || 'No Workspace';

      main.appendChild(title);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'config-row-actions';

      if (cfg.id === defaultConfigurationId) {
        const badge = document.createElement('span');
        badge.className = 'config-badge';
        badge.textContent = 'Default';
        actions.appendChild(badge);
      } else {
        const setDefaultBtn = document.createElement('button');
        setDefaultBtn.type = 'button';
        setDefaultBtn.className = 'config-action-btn';
        setDefaultBtn.textContent = 'Set as default';
        setDefaultBtn.addEventListener('click', () => setDefaultConfiguration(cfg.id));
        actions.appendChild(setDefaultBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'config-action-btn remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removeConfiguration(cfg.id));
      actions.appendChild(removeBtn);

      row.appendChild(main);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  async function saveConsent() {
    try {
      await chrome.storage.sync.set({
        screenshotConsent: document.getElementById('screenshotConsent').checked
      });
      
      alert('Consent preferences saved successfully');
    } catch (error) {
      alert('Failed to save consent: ' + error.message);
    }
  }

  async function clearData() {
    if (!confirm('Are you sure you want to clear all extension data? This cannot be undone.')) {
      return;
    }

    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      
      alert('All data cleared successfully. Please reload the settings page.');
      window.location.reload();
    } catch (error) {
      alert('Failed to clear data: ' + error.message);
    }
  }
});
