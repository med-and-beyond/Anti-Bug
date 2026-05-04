// Popup Script - Main interface for viewing bugs and creating new ones

let allBugs = []; // Store all bugs for client-side filtering
let filteredBugs = []; // Currently displayed bugs

document.addEventListener('DOMContentLoaded', async () => {
  // Easter Egg: Click logo 17 times to open random Oggy video
  const logoImg = document.querySelector('.logo img');
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
  
  const settingsBtn = document.getElementById('settingsBtn');
  const createBugBtn = document.getElementById('createBugBtn');
  const updateBugBtn = document.getElementById('updateBugBtn');
  const bugsList = document.getElementById('bugsList');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const searchInput = document.getElementById('searchInput');
  const resultsCount = document.getElementById('resultsCount');

  // Check connection status
  await checkConnectionStatus();

  // Load recent bugs
  await loadRecentBugs();

  // Search functionality with debounce
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      filterBugs(e.target.value);
    }, 250); // 250ms debounce
  });

  // Event listeners
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  createBugBtn.addEventListener('click', () => {
    // Open create bug page in a new tab
    chrome.tabs.create({ url: 'create-bug.html' });
  });

  updateBugBtn.addEventListener('click', () => {
    // Open update bug case page in a new tab
    chrome.tabs.create({ url: 'update-bug.html' });
  });

  async function checkConnectionStatus() {
    try {
      const settings = await chrome.storage.sync.get(['mondayToken', 'selectedBoardId', 'selectedGroupId']);
      
      if (settings.mondayToken && settings.selectedBoardId && settings.selectedGroupId) {
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = 'Connected to Monday.com';
      } else if (settings.mondayToken) {
        statusIndicator.className = 'status-indicator warning';
        statusText.textContent = 'Please select board and group';
      } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Not connected to Monday.com';
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    }
  }

  async function loadRecentBugs() {
    try {
      console.log('Loading recent bugs...');
      const settings = await chrome.storage.sync.get(['mondayToken', 'selectedBoardId', 'selectedGroupId']);
      
      console.log('Settings loaded:', {
        hasToken: !!settings.mondayToken,
        boardId: settings.selectedBoardId,
        groupId: settings.selectedGroupId
      });
      
      if (!settings.mondayToken || !settings.selectedBoardId || !settings.selectedGroupId) {
        bugsList.innerHTML = '<div class="empty-state">Connect to Monday.com in settings to view bugs</div>';
        resultsCount.textContent = '';
        return;
      }

      bugsList.innerHTML = '<div class="loading">Loading bugs...</div>';
      resultsCount.textContent = '';

      // Request bugs from background script
      chrome.runtime.sendMessage(
        { action: 'fetchRecentBugs' },
        (response) => {
          console.log('Received bugs response:', response);
          
          if (chrome.runtime.lastError) {
            console.error('Runtime error loading bugs:', chrome.runtime.lastError);
            bugsList.innerHTML = `<div class="error">Error: ${chrome.runtime.lastError.message}</div>`;
            resultsCount.textContent = '';
            return;
          }
          
          if (response && response.success) {
            console.log('Bugs loaded successfully:', response.bugs?.length || 0);
            allBugs = response.bugs || [];
            filteredBugs = allBugs;
            displayBugs(filteredBugs);
            updateResultsCount();
          } else {
            const errorMsg = response ? response.error : 'No response received';
            console.error('Failed to load bugs:', errorMsg);
            
            let displayMessage = errorMsg;
            if (errorMsg.includes('token')) {
              displayMessage = 'Authentication error. Please check your Monday.com token in settings.';
            } else if (errorMsg.includes('board')) {
              displayMessage = 'Board not found. Please select a valid board in settings.';
            }
            
            bugsList.innerHTML = `<div class="error">Error: ${displayMessage}</div>`;
            resultsCount.textContent = '';
          }
        }
      );
    } catch (error) {
      console.error('Error loading bugs:', error);
      bugsList.innerHTML = `<div class="error">Failed to load bugs: ${error.message}</div>`;
      resultsCount.textContent = '';
    }
  }

  function filterBugs(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      // No search term, show all bugs
      filteredBugs = allBugs;
    } else {
      // Filter bugs by title, status, and date
      const term = searchTerm.toLowerCase();
      filteredBugs = allBugs.filter(bug => {
        const title = bug.name ? bug.name.toLowerCase() : '';
        const statusColumn = bug.column_values?.find(col => 
          col.column?.title?.toLowerCase() === 'status' || 
          (col.column?.type === 'color' && col.column?.title?.toLowerCase().includes('status'))
        );
        const status = (statusColumn && statusColumn.text) ? statusColumn.text.toLowerCase() : '';
        const date = new Date(bug.created_at).toLocaleDateString().toLowerCase();
        return title.includes(term) || status.includes(term) || date.includes(term);
      });
    }
    
    displayBugs(filteredBugs);
    updateResultsCount();
  }

  function updateResultsCount() {
    if (allBugs.length === 0) {
      resultsCount.textContent = '';
    } else if (filteredBugs.length === allBugs.length) {
      resultsCount.textContent = `${allBugs.length} bug${allBugs.length !== 1 ? 's' : ''}`;
    } else {
      resultsCount.textContent = `${filteredBugs.length} of ${allBugs.length}`;
    }
  }

  function displayBugs(bugs) {
    if (!bugs || bugs.length === 0) {
      bugsList.innerHTML = '<div class="empty-state">No bugs found</div>';
      return;
    }

    bugsList.innerHTML = '';

    bugs.forEach(bug => {
      const bugItem = document.createElement('div');
      bugItem.className = 'bug-item';
      
      const title = document.createElement('div');
      title.className = 'bug-title';
      title.textContent = bug.name;
      
      const meta = document.createElement('div');
      meta.className = 'bug-meta';
      
      const date = new Date(bug.created_at);
      const dateStr = date.toLocaleDateString();
      
      // Find status column by title (case-insensitive) or by type "color" (which is Monday's status column type)
      const statusColumn = bug.column_values.find(col => 
        col.column?.title?.toLowerCase() === 'status' || 
        (col.column?.type === 'color' && col.column?.title?.toLowerCase().includes('status'))
      );
      const statusText = (statusColumn && statusColumn.text) ? statusColumn.text : 'Unknown';
      
      // Extract color from Monday.com status column
      const statusColor = getStatusColor(statusColumn);
      
      const statusSpan = document.createElement('span');
      statusSpan.className = 'bug-status';
      statusSpan.textContent = statusText;
      
      // Apply color styling if available
      if (statusColor) {
        statusSpan.style.backgroundColor = statusColor.background;
        statusSpan.style.borderColor = statusColor.border;
        statusSpan.style.color = statusColor.text;
      }
      
      const dateSpan = document.createElement('span');
      dateSpan.className = 'bug-date';
      dateSpan.textContent = dateStr;
      
      meta.appendChild(statusSpan);
      meta.appendChild(dateSpan);
      
      bugItem.appendChild(title);
      bugItem.appendChild(meta);
      
      bugItem.addEventListener('click', () => {
        // Open Monday item in new tab using the URL from the API
        chrome.tabs.create({ url: bug.url });
      });
      
      bugsList.appendChild(bugItem);
    });
  }

  /**
   * Extract color information from a Monday.com status column
   * @param {Object} statusColumn - The column_values entry for the status column
   * @returns {Object|null} - { background, border, text } colors or null if not available
   */
  function getStatusColor(statusColumn) {
    if (!statusColumn || !statusColumn.value || !statusColumn.column?.settings_str) {
      return null;
    }

    try {
      // Parse the status value to get the index
      const statusValue = JSON.parse(statusColumn.value);
      const statusIndex = statusValue.index;
      
      if (statusIndex === undefined || statusIndex === null) {
        return null;
      }
      const settings = JSON.parse(statusColumn.column.settings_str);
      const labelsColors = settings.labels_colors || {};
      const colorInfo = labelsColors[statusIndex.toString()];
      
      if (!colorInfo || !colorInfo.color) {
        return null;
      }

      // Return the colors - Monday provides background color and border color
      // We need to determine text color based on background brightness
      const bgColor = colorInfo.color;
      const borderColor = colorInfo.border || darkenColor(bgColor, 15);
      const textColor = getContrastTextColor(bgColor);

      return {
        background: bgColor,
        border: borderColor,
        text: textColor
      };
    } catch (e) {
      console.warn('Failed to parse status color:', e);
      return null;
    }
  }

  /**
   * Determine whether to use dark or light text based on background color brightness
   * @param {string} hexColor - Hex color code (e.g., "#fdab3d")
   * @returns {string} - "#333" for dark text or "#fff" for light text
   */
  function getContrastTextColor(hexColor) {
    const hex = hexColor.replace('#', '');
    
    // Parse RGB values
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate relative luminance using sRGB formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Use dark text for light backgrounds, light text for dark backgrounds
    return luminance > 0.5 ? '#333' : '#fff';
  }

  /**
   * Darken a hex color by a percentage
   * @param {string} hexColor - Hex color code
   * @param {number} percent - Percentage to darken (0-100)
   * @returns {string} - Darkened hex color
   */
  function darkenColor(hexColor, percent) {
    const hex = hexColor.replace('#', '');
    const r = Math.max(0, parseInt(hex.substr(0, 2), 16) - Math.round(2.55 * percent));
    const g = Math.max(0, parseInt(hex.substr(2, 2), 16) - Math.round(2.55 * percent));
    const b = Math.max(0, parseInt(hex.substr(4, 2), 16) - Math.round(2.55 * percent));
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
});
