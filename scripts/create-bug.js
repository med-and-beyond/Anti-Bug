// Create Bug Script - Handles bug report creation with attachments

let attachedFiles = [];
let screenshotCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const bugForm = document.getElementById('bugForm');
  const closeBtn = document.getElementById('closeBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const submitBtn = document.getElementById('submitBtn');
  const screenshotBtn = document.getElementById('screenshotBtn');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const boardSelect = document.getElementById('boardSelect');
  const groupSelect = document.getElementById('groupSelect');

  // Easter Egg: Click logo 17 times to open random Oggy video
  const logoImg = document.querySelector('.header-logo');
  if (logoImg) {
    logoImg.style.cursor = 'pointer';
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

  // Check if we're returning from a screenshot capture
  const state = await chrome.storage.local.get(['returnToCreateBug', 'createBugState', 'annotatedScreenshot']);
  if (state.returnToCreateBug && state.createBugState) {
    // Restore form state
    const saved = state.createBugState;
    document.getElementById('title').value = saved.title || '';
    document.getElementById('platform').value = saved.platform || '';
    document.getElementById('version').value = saved.version || '';
    document.getElementById('description').value = saved.description || '';
    document.getElementById('stepsToReproduce').value = saved.stepsToReproduce || '';
    document.getElementById('actualResult').value = saved.actualResult || '';
    document.getElementById('expectedResult').value = saved.expectedResult || '';
    
    // Restore attachments
    if (saved.attachedFiles) {
      attachedFiles = saved.attachedFiles;
      // Redisplay attachments
      attachedFiles.forEach(file => {
        if (file.id.startsWith('screenshot-')) {
          displayScreenshot(file);
        } else if (file.id.startsWith('file-')) {
          displayFile(file);
        }
      });
    }
    
    // Check for new screenshot from annotation
    if (state.annotatedScreenshot) {
      console.log('Found annotated screenshot, adding to attachments...');
      addScreenshot(state.annotatedScreenshot);
      await chrome.storage.local.remove(['annotatedScreenshot']);
    }
    
    // Clear the return flag
    await chrome.storage.local.remove(['returnToCreateBug']);
  }

  // Load boards
  await loadBoards();

  // Error banner handling
  const errorBanner = document.getElementById('errorBanner');
  const errorText = document.getElementById('errorText');
  const errorClose = document.getElementById('errorClose');
  
  errorClose.addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });

  function showError(message) {
    console.error('Error:', message);
    errorText.textContent = message;
    errorBanner.style.display = 'flex';
  }

  function hideError() {
    errorBanner.style.display = 'none';
  }

  // Event listeners
  closeBtn.addEventListener('click', () => window.close());
  cancelBtn.addEventListener('click', () => window.close());

  bugForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Form submitted');
    hideError();
    await createBug();
  });

  // Real-time validation for Title field
  const titleInput = document.getElementById('title');
  const titleError = document.getElementById('titleError');

  titleInput.addEventListener('input', () => {
    if (titleInput.value.trim()) {
      titleError.style.display = 'none';
      submitBtn.disabled = false;
    } else {
      titleError.style.display = 'block';
      submitBtn.disabled = true;
    }
  });

  screenshotBtn.addEventListener('click', async () => {
    await captureScreenshot();
  });

  boardSelect.addEventListener('change', async () => {
    await loadGroups();
    await loadBoardColumns();
  });

  // Drag and drop functionality
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
  });

  // Paste functionality - listen for paste events on the document
  document.addEventListener('paste', (e) => {
    console.log('Paste event detected');
    
    // Get clipboard items
    const items = e.clipboardData?.items;
    if (!items) return;

    const files = [];
    
    // Process clipboard items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Check if item is a file
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          console.log('Pasted file:', file.name, file.type);
          files.push(file);
        }
      }
    }

    // Handle the pasted files
    if (files.length > 0) {
      // Convert FileList-like array to actual array and process
      handleFiles(files);
      
      // Show success feedback
      const dropZone = document.getElementById('dropZone');
      dropZone.style.borderColor = '#28a745';
      dropZone.style.background = 'rgba(40, 167, 69, 0.1)';
      setTimeout(() => {
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
      }, 1000);
    }
  });

  async function loadBoards() {
    try {
      console.log('Loading boards in create-bug...');
      const settings = await chrome.storage.sync.get(['mondayToken']);
      
      if (!settings.mondayToken) {
        console.log('No Monday token found');
        boardSelect.innerHTML = '<option value="">Not connected to Monday.com</option>';
        return;
      }

      boardSelect.innerHTML = '<option value="">Loading boards...</option>';
      boardSelect.disabled = true;

      chrome.runtime.sendMessage(
        { action: 'testMondayConnection', token: settings.mondayToken },
        async (response) => {
          console.log('Boards response:', response);
          
          if (chrome.runtime.lastError) {
            console.error('Runtime error loading boards:', chrome.runtime.lastError);
            boardSelect.innerHTML = '<option value="">Error loading boards</option>';
            boardSelect.disabled = false;
            return;
          }
          
          if (response && response.success && response.workspaces) {
            console.log(`Loaded ${response.workspaces.length} boards`);
            boardSelect.innerHTML = '<option value="">Select a board</option>';
            
            // Group boards by workspace
            const boardsByWorkspace = {};
            response.workspaces.forEach(board => {
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

            // Load saved selection
            const saved = await chrome.storage.sync.get(['selectedBoardId']);
            if (saved.selectedBoardId) {
              boardSelect.value = saved.selectedBoardId;
              await loadGroups();
              await loadBoardColumns(); // Load columns automatically!
            }
            
            boardSelect.disabled = false;
          } else {
            console.error('Failed to load boards:', response);
            boardSelect.innerHTML = '<option value="">Failed to load boards</option>';
            boardSelect.disabled = false;
          }
        }
      );
    } catch (error) {
      console.error('Error loading boards:', error);
      boardSelect.innerHTML = '<option value="">Error loading boards</option>';
      boardSelect.disabled = false;
    }
  }

  async function loadGroups() {
    const selectedOption = boardSelect.options[boardSelect.selectedIndex];
    
    if (!selectedOption || !selectedOption.dataset.groups) {
      groupSelect.innerHTML = '<option value="">Select board first</option>';
      return;
    }

    const groups = JSON.parse(selectedOption.dataset.groups);
    
    groupSelect.innerHTML = '<option value="">Select a group</option>';
    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.title;
      groupSelect.appendChild(option);
    });

    // Load saved selection
    const saved = await chrome.storage.sync.get(['selectedGroupId']);
    if (saved.selectedGroupId) {
      groupSelect.value = saved.selectedGroupId;
    }
  }

  async function loadBoardColumns() {
    const boardId = boardSelect.value;
    const mondayFieldsSection = document.getElementById('mondayFieldsSection');
    const mondayFieldsContainer = document.getElementById('mondayFieldsContainer');
    
    if (!boardId) {
      mondayFieldsSection.style.display = 'none';
      return;
    }

    console.log('Loading columns for board:', boardId);
    
    try {
      chrome.runtime.sendMessage(
        { action: 'fetchBoardColumns', boardId: boardId },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Runtime error loading columns:', chrome.runtime.lastError);
            mondayFieldsSection.style.display = 'none';
            return;
          }
          
          if (response && response.success && response.columns) {
            console.log('Loaded columns:', response.columns);
            renderMondayFields(response.columns);
            mondayFieldsSection.style.display = 'block';
          } else {
            console.error('Failed to load columns:', response);
            mondayFieldsSection.style.display = 'none';
          }
        }
      );
    } catch (error) {
      console.error('Error loading columns:', error);
      mondayFieldsSection.style.display = 'none';
    }
  }

  function renderMondayFields(columns) {
    const container = document.getElementById('mondayFieldsContainer');
    container.innerHTML = '';

    // List of column titles to exclude from UI (will be set programmatically)
    const excludedColumnTitles = [
      'Internal Status',
      'Estimated SP',
      'Estimated QA',
      'Actual SP',
      'Link to PR',
      'Custom AI prompt',
      'QA Item Created',
      'Status',
      'Bug/Feature',
      'Bug Status',
      'Environment'
    ];

    // Debug: Log all column types to see what Monday returns
    console.log('=== MONDAY COLUMNS DEBUG ===');
    columns.forEach(col => {
      console.log(`Column: "${col.title}" | Type: "${col.type}" | ID: ${col.id}`);
      if (col.settings) {
        console.log(`  Settings:`, col.settings);
      }
    });
    console.log('=== END DEBUG ===');

    // Filter out system columns and excluded columns
    const editableColumns = columns.filter(col => {
      // Skip system columns
      if (col.type === 'name' || col.type === 'auto_number' || 
          col.type === 'creation_log' || col.type === 'last_updated' ||
          col.type === 'dependency' || col.type === 'file' || 
          col.type === 'board_relation' || col.type === 'tag' || col.type === 'tags') {
        return false;
      }
      
      // Skip excluded titles
      if (excludedColumnTitles.includes(col.title)) {
        return false;
      }
      
      return true;
    });

    if (editableColumns.length === 0) {
      container.innerHTML = '<p class="no-fields">No editable fields found in this board.</p>';
      return;
    }

    editableColumns.forEach(column => {
      console.log(`Rendering column: ${column.title} (${column.type})`);
      
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'monday-field';
      fieldDiv.dataset.columnId = column.id;
      fieldDiv.dataset.columnType = column.type;
      
      const label = document.createElement('label');
      label.textContent = column.title;
      label.className = 'monday-field-label';
      fieldDiv.appendChild(label);

      // Create input based on column type
      const input = createColumnInput(column);
      if (input) {
        fieldDiv.appendChild(input);
        container.appendChild(fieldDiv);
      } else {
        console.warn(`No input created for column: ${column.title} (${column.type})`);
      }
    });
  }

  function createColumnInput(column) {
    const { type, id, settings } = column;

    switch (type) {
      case 'color': // Status column
      case 'status':
        return createStatusInput(column);
      
      case 'text':
        return createTextInput(column);
      
      case 'long_text':
        return createLongTextInput(column);
      
      case 'numbers':
      case 'numeric':
        return createNumberInput(column);
      
      case 'date':
        return createDateInput(column);
      
      case 'dropdown':
        return createDropdownInput(column);
      
      case 'email':
        return createEmailInput(column);
      
      case 'phone':
        return createPhoneInput(column);
      
      case 'link':
        return createLinkInput(column);
      
      case 'checkbox':
        return createCheckboxInput(column);
      
      default:
        console.log(`Unsupported column type: ${type} for column: ${column.title}`);
        return null;
    }
  }

  function createStatusInput(column) {
    // Create custom dropdown container (not native select)
    const container = document.createElement('div');
    container.className = 'custom-status-dropdown';
    container.dataset.columnId = column.id;
    
    // Create the display button
    const displayBtn = document.createElement('button');
    displayBtn.type = 'button';
    displayBtn.className = 'status-display-btn';
    displayBtn.innerHTML = '<span class="status-text">-- Leave unchanged --</span><span class="dropdown-arrow">▼</span>';
    
    // Create dropdown panel
    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'status-dropdown-panel';
    dropdownPanel.style.display = 'none';
    
    // Store selected value (the label TEXT, not index)
    let selectedValue = '';
    let selectedLabelId = '';
    
    // Add "Leave unchanged" option
    const emptyOption = document.createElement('div');
    emptyOption.className = 'status-option';
    emptyOption.innerHTML = '<span class="status-label-text">-- Leave unchanged --</span>';
    emptyOption.dataset.value = '';
    dropdownPanel.appendChild(emptyOption);
    
    // Parse labels from settings
    if (column.settings && column.settings.labels) {
      const labels = column.settings.labels;
      const labelsColors = column.settings.labels_colors || {};
      
      Object.entries(labels).forEach(([labelId, labelText]) => {
        // Only show active labels (those with color info)
        if (!labelsColors[labelId]) {
          console.log(`Skipping deactivated label: ${labelText} (ID: ${labelId})`);
          return;
        }
        
        const option = document.createElement('div');
        option.className = 'status-option';
        option.dataset.value = labelText; // Store the TEXT, not the index
        option.dataset.labelId = labelId;
        
        // Get color - Monday already returns hex codes!
        let colorCode = '#333333';
        let colorName = 'black';
        
        const colorInfo = labelsColors[labelId];
        if (colorInfo) {
          colorCode = colorInfo.color || '#333333';
          colorName = colorInfo.var_name || 'black';
        }
        
        // Create option with colored text
        option.innerHTML = `
          <span class="status-label-text" style="color: ${colorCode}; font-weight: 600;">${labelText}</span>
        `;
        option.dataset.color = colorName;
        option.dataset.colorCode = colorCode;
        
        dropdownPanel.appendChild(option);
      });
    }
    
    // Toggle dropdown
    displayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdownPanel.style.display === 'block';
      
      // Close all other dropdowns first
      document.querySelectorAll('.status-dropdown-panel').forEach(panel => {
        panel.style.display = 'none';
      });
      
      dropdownPanel.style.display = isOpen ? 'none' : 'block';
    });
    
    // Handle option selection
    dropdownPanel.addEventListener('click', (e) => {
      const option = e.target.closest('.status-option');
      if (!option) return;
      
      selectedValue = option.dataset.value; // This is the label TEXT
      selectedLabelId = option.dataset.labelId;
      const colorCode = option.dataset.colorCode;
      
      console.log(`Selected label: "${selectedValue}" (ID: ${selectedLabelId})`);
      
      // Update display
      if (selectedValue === '') {
        displayBtn.innerHTML = '<span class="status-text">-- Leave unchanged --</span><span class="dropdown-arrow">▼</span>';
      } else {
        const colorStyle = colorCode ? `style="color: ${colorCode}; font-weight: 600;"` : '';
        displayBtn.innerHTML = `<span class="status-text" ${colorStyle}>${selectedValue}</span><span class="dropdown-arrow">▼</span>`;
      }
      
      // Close dropdown
      dropdownPanel.style.display = 'none';
      
      // Mark as selected
      dropdownPanel.querySelectorAll('.status-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      option.classList.add('selected');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      dropdownPanel.style.display = 'none';
    });
    
    // Assemble the dropdown
    container.appendChild(displayBtn);
    container.appendChild(dropdownPanel);
    
    // Add getValue method for form collection
    container.getValue = () => selectedValue;
    
    return container;
  }

  function createTextInput(column) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    input.placeholder = `Enter ${column.title.toLowerCase()}`;
    return input;
  }

  function createLongTextInput(column) {
    const textarea = document.createElement('textarea');
    textarea.className = 'monday-field-input';
    textarea.dataset.columnId = column.id;
    textarea.placeholder = `Enter ${column.title.toLowerCase()}`;
    textarea.rows = 3;
    return textarea;
  }

  function createNumberInput(column) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    input.placeholder = `Enter ${column.title.toLowerCase()}`;
    return input;
  }

  function createDateInput(column) {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    return input;
  }

  function createDropdownInput(column) {
    const select = document.createElement('select');
    select.className = 'monday-field-input';
    select.dataset.columnId = column.id;
    
    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- Leave unchanged --';
    select.appendChild(emptyOption);
    
    // Parse labels from settings
    if (column.settings && column.settings.labels) {
      column.settings.labels.forEach(label => {
        const option = document.createElement('option');
        option.value = label.id || label.name;
        option.textContent = label.name;
        select.appendChild(option);
      });
    }
    
    return select;
  }

  function createEmailInput(column) {
    const input = document.createElement('input');
    input.type = 'email';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    input.placeholder = 'email@example.com';
    return input;
  }

  function createPhoneInput(column) {
    const input = document.createElement('input');
    input.type = 'tel';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    input.placeholder = '+1234567890';
    return input;
  }

  function createLinkInput(column) {
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'monday-field-input';
    input.dataset.columnId = column.id;
    input.placeholder = 'https://example.com';
    return input;
  }

  function createCheckboxInput(column) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'monday-field-checkbox';
    checkbox.dataset.columnId = column.id;
    return checkbox;
  }

  function collectColumnValues() {
    const columnValues = {};
    const fields = document.querySelectorAll('.monday-field');
    
    console.log('Collecting column values from', fields.length, 'fields');
    
    fields.forEach(field => {
      const columnId = field.dataset.columnId;
      const columnType = field.dataset.columnType;
      
      console.log(`Processing field: ${columnId} (${columnType})`);
      
      // Handle custom status dropdown
      const customDropdown = field.querySelector('.custom-status-dropdown');
      if (customDropdown && customDropdown.getValue) {
        const value = customDropdown.getValue();
        if (value && value !== '') {
          const formatted = formatColumnValue(columnType, value, null);
          if (formatted !== null) {
            columnValues[columnId] = formatted;
            console.log(`  ✓ Added status value:`, formatted);
          }
        }
        return;
      }
      
      // Handle regular inputs
      const input = field.querySelector('.monday-field-input, .monday-field-checkbox');
      if (!input) {
        console.log('  ⚠️ No input found in field');
        return;
      }
      
      let value = input.value;
      
      // Skip empty values
      if (input.type === 'checkbox') {
        if (!input.checked) return;
        value = 'true';
      } else if (!value || value === '') {
        console.log('  - Empty value, skipping');
        return;
      }
      
      // Format value based on column type
      const formatted = formatColumnValue(columnType, value, input);
      if (formatted !== null) {
        columnValues[columnId] = formatted;
        console.log(`  ✓ Added value:`, formatted);
      } else {
        console.log('  - Formatted value is null, skipping');
      }
    });
    
    console.log('Final column values:', columnValues);
    return columnValues;
  }

  function formatColumnValue(columnType, value, input) {
    switch (columnType) {
      case 'status':
      case 'color':
        // Status columns use label object
        return { label: value };
      
      case 'text':
      case 'long_text':
      case 'email':
      case 'phone':
      case 'link':
        return value;
      
      case 'numbers':
      case 'numeric':
        return value;
      
      case 'date':
        // Format date as YYYY-MM-DD
        return { date: value };
      
      case 'checkbox':
        return { checked: value === 'true' ? 'true' : 'false' };
      
      case 'dropdown':
        return { ids: [parseInt(value)] };
      
      default:
        return value;
    }
  }

  async function captureScreenshot() {
    try {
      screenshotBtn.disabled = true;
      screenshotBtn.textContent = 'Capturing...';

      // Get ALL tabs and find the one that's NOT create-bug or extension pages
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const createBugUrl = chrome.runtime.getURL('create-bug.html');
      const annotateUrl = chrome.runtime.getURL('annotate.html');
      const popupUrl = chrome.runtime.getURL('popup.html');
      
      // Find the actual website tab (not extension pages)
      let targetTab = allTabs.find(tab => 
        !tab.url.startsWith(createBugUrl) && 
        !tab.url.startsWith(annotateUrl) &&
        !tab.url.startsWith(popupUrl) &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://')
      );

      // If no suitable tab found, use the most recently active non-extension tab
      if (!targetTab) {
        const recentTabs = await chrome.tabs.query({ });
        targetTab = recentTabs.find(tab => 
          !tab.url.startsWith('chrome://') && 
          !tab.url.startsWith('chrome-extension://')
        );
      }

      if (!targetTab) {
        alert('No suitable tab found to capture. Please navigate to a website first.');
        screenshotBtn.disabled = false;
        screenshotBtn.textContent = 'Take Screenshot';
        return;
      }

      console.log('Capturing screenshot from tab:', targetTab.id, targetTab.url);

      // Store state to resume after screenshot
      await chrome.storage.local.set({
        screenshotInProgress: true,
        returnToCreateBug: true,
        targetTabId: targetTab.id,
        createBugState: {
          title: document.getElementById('title').value,
          platform: document.getElementById('platform').value,
          version: document.getElementById('version').value,
          description: document.getElementById('description').value,
          stepsToReproduce: document.getElementById('stepsToReproduce').value,
          actualResult: document.getElementById('actualResult').value,
          expectedResult: document.getElementById('expectedResult').value,
          boardId: boardSelect.value,
          groupId: groupSelect.value,
          attachedFiles: attachedFiles
        }
      });

      // Send message to background to capture screenshot
      chrome.runtime.sendMessage(
        { action: 'captureScreenshot', tabId: targetTab.id },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            alert('Failed to capture screenshot: ' + chrome.runtime.lastError.message);
            screenshotBtn.disabled = false;
            screenshotBtn.textContent = 'Take Screenshot';
            chrome.storage.local.remove(['screenshotInProgress', 'returnToCreateBug', 'targetTabId']);
            return;
          }
          
          if (response && !response.success) {
            alert('Failed to capture screenshot: ' + response.error);
            screenshotBtn.disabled = false;
            screenshotBtn.textContent = 'Take Screenshot';
            chrome.storage.local.remove(['screenshotInProgress', 'returnToCreateBug', 'targetTabId']);
          } else {
            // Success - close this tab after a moment
            setTimeout(() => {
              window.close();
            }, 100);
          }
        }
      );
      
    } catch (error) {
      console.error('Screenshot error:', error);
      alert('Screenshot error: ' + error.message);
      screenshotBtn.disabled = false;
      screenshotBtn.textContent = 'Take Screenshot';
      chrome.storage.local.remove(['screenshotInProgress', 'returnToCreateBug', 'targetTabId']);
    }
  }

  function openAnnotationPage(screenshotDataUrl) {
    // Store screenshot in local storage temporarily
    chrome.storage.local.set({ 
      pendingScreenshot: screenshotDataUrl 
    }, () => {
      // Open annotation page
      window.open('annotate.html', '_blank', 'width=1200,height=800');
    });
  }

  // Listen for annotated screenshots
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.annotatedScreenshot) {
      const screenshot = changes.annotatedScreenshot.newValue;
      if (screenshot) {
        addScreenshot(screenshot);
        chrome.storage.local.remove('annotatedScreenshot');
      }
    }
  });

  function addScreenshot(dataUrl) {
    screenshotCount++;
    const screenshot = {
      id: `screenshot-${Date.now()}`,
      name: `screenshot-${screenshotCount}.png`,
      dataUrl: dataUrl,
      type: 'image/png'
    };

    attachedFiles.push(screenshot);
    displayScreenshot(screenshot);
  }

  function displayScreenshot(screenshot) {
    const screenshotsList = document.getElementById('screenshotsList');
    
    if (screenshotsList.querySelector('.empty-state')) {
      screenshotsList.innerHTML = '';
    }

    const item = document.createElement('div');
    item.className = 'screenshot-item';
    item.dataset.id = screenshot.id;
    
    item.innerHTML = `
      <img src="${screenshot.dataUrl}" alt="Screenshot">
      <button class="remove-btn" title="Remove">×</button>
    `;

    item.querySelector('.remove-btn').addEventListener('click', () => {
      attachedFiles = attachedFiles.filter(f => f.id !== screenshot.id);
      item.remove();
      
      if (screenshotsList.children.length === 0) {
        screenshotsList.innerHTML = '<div class="empty-state">No screenshots yet</div>';
      }
    });

    screenshotsList.appendChild(item);
  }

  function handleFiles(files) {
    const filesList = document.getElementById('filesList');
    
    Array.from(files).forEach(file => {
      // Check file size (Monday.com limit is 500MB)
      const MAX_SIZE = 500 * 1024 * 1024; // 500MB
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
      reader.onerror = (e) => {
        console.error('File read error:', e);
        showError(`Failed to read file "${file.name}". Please try again.`);
      };
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
        <div class="file-name">${file.name}</div>
        <div class="file-size">${size}</div>
      </div>
      <button class="remove-btn" title="Remove">×</button>
    `;

    item.querySelector('.remove-btn').addEventListener('click', () => {
      attachedFiles = attachedFiles.filter(f => f.id !== file.id);
      item.remove();
    });

    filesList.appendChild(item);
  }

  function getFileIcon(type) {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type === 'application/json' || type === 'application/har+json') return '📋';
    if (type === 'application/pdf') return '📄';
    return '📎';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function createBug() {
    try {
      console.log('Creating bug...');
      
      // Show loading state
      submitBtn.disabled = true;
      document.getElementById('submitBtnText').textContent = 'Creating...';
      document.getElementById('submitSpinner').style.display = 'inline-block';

      // Validate form
      const title = document.getElementById('title').value.trim();
      const description = document.getElementById('description').value;
      const stepsToReproduce = document.getElementById('stepsToReproduce').value;
      
      if (!title) {
        document.getElementById('titleError').style.display = 'block';
        showError('Title is required');
        submitBtn.disabled = false;
        document.getElementById('submitBtnText').textContent = 'Create & Upload';
        document.getElementById('submitSpinner').style.display = 'none';
        return;
      }
      
      if (!description || !stepsToReproduce) {
        showError('Please fill in required fields (Description and Steps to Reproduce)');
        submitBtn.disabled = false;
        document.getElementById('submitBtnText').textContent = 'Create & Upload';
        document.getElementById('submitSpinner').style.display = 'none';
        return;
      }

      // Validate board/group selection
      const boardId = boardSelect.value;
      const groupId = groupSelect.value;
      
      if (!boardId || !groupId) {
        showError('Please select a board and group from the dropdowns');
        submitBtn.disabled = false;
        document.getElementById('submitBtnText').textContent = 'Create & Upload';
        document.getElementById('submitSpinner').style.display = 'none';
        return;
      }

      console.log('Validation passed, creating bug with:', { title, boardId, groupId });

      // Save board/group selection
      await chrome.storage.sync.set({
        selectedBoardId: boardId,
        selectedGroupId: groupId
      });

      // Gather bug data
      const bugData = {
        title: title,
        platform: document.getElementById('platform').value,
        version: document.getElementById('version').value,
        description: description,
        stepsToReproduce: stepsToReproduce,
        actualResult: document.getElementById('actualResult').value,
        expectedResult: document.getElementById('expectedResult').value
      };

      console.log('Bug data:', bugData);
      console.log('Attachments:', attachedFiles.length);

      // Collect Monday column values
      const columnValues = collectColumnValues();
      console.log('Column values:', columnValues);

      // Show progress
      document.getElementById('uploadProgress').style.display = 'block';
      updateProgress(10, 'Preparing attachments...');

      console.log('Preparing bug data and attachments...');

      // Store attachments in local storage to avoid message size limit
      // Background script will read them from there
      await chrome.storage.local.set({
        pendingAttachments: attachedFiles
      });

      updateProgress(20, 'Creating bug item...');
      console.log('Sending message to background...');

      // Create bug via background script
      // Send only metadata, not the actual file data
      chrome.runtime.sendMessage(
        {
          action: 'createBug',
          bugData: bugData,
          attachmentCount: attachedFiles.length,
          columnValues: columnValues
        },
        (response) => {
          console.log('Received response from background:', response);
          
          if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            showError('Extension error: ' + chrome.runtime.lastError.message);
            submitBtn.disabled = false;
            document.getElementById('submitBtnText').textContent = 'Create & Upload';
            document.getElementById('submitSpinner').style.display = 'none';
            document.getElementById('uploadProgress').style.display = 'none';
            return;
          }
          
          if (response && response.success) {
            console.log('Bug created successfully!', response.item);
            
            // Show upload results
            if (response.uploadResults) {
              const uploaded = response.uploadResults.uploaded || [];
              const failed = response.uploadResults.failed || [];
              const skipped = response.uploadResults.skipped || [];
              
              if (uploaded.length > 0) {
                updateProgress(90, `Uploaded ${uploaded.length} file(s)...`);
              }
              
              // Check if there were any skipped files (too large)
              if (skipped.length > 0) {
                const skippedFiles = skipped.map(f => f.name).join(', ');
                showError(`Bug created successfully! However, ${skipped.length} file(s) were too large to upload via the extension: ${skippedFiles}. Please upload them directly to the Monday ticket.`);
                updateProgress(100, `Bug created (${skipped.length} file(s) skipped)`);
              } else if (failed.length > 0) {
                // Check if there were any other file upload issues
                const failedFiles = failed.map(f => f.name).join(', ');
                showError(`Bug created, but ${failed.length} file(s) failed to upload: ${failedFiles}. Please upload them manually.`);
                updateProgress(100, `Bug created (${failed.length} upload failed)`);
              } else if (uploaded.length > 0) {
                updateProgress(100, `Bug created with ${uploaded.length} attachment(s)! ✓`);
              } else {
                updateProgress(100, 'Bug created successfully! ✓');
              }
            } else {
              updateProgress(100, 'Bug created successfully! ✓');
            }
            
            setTimeout(() => {
              // Open created bug in Monday.com
              if (response.item && response.item.url) {
                chrome.tabs.create({ url: response.item.url });
              }
              window.close();
            }, 2000);
          } else {
            // Show detailed error message
            const errorMsg = response ? response.error : 'Unknown error - no response received';
            console.error('Bug creation failed:', errorMsg);
            
            let displayMessage = errorMsg;
            
            if (errorMsg.includes('token not set') || errorMsg.includes('not connected')) {
              displayMessage = 'Not connected to Monday.com. Please configure your API token in settings.';
            } else if (errorMsg.includes('File too large')) {
              displayMessage = 'File too large. Monday.com limits files to 500MB. Please compress or remove large files.';
            } else if (errorMsg.includes('Upload failed')) {
              displayMessage = 'Upload failed. Check your internet connection and try again.';
            } else if (errorMsg.includes('board')) {
              displayMessage = 'Board or group not found. Please select a valid board and group in settings.';
            }
            
            showError(displayMessage);
            submitBtn.disabled = false;
            document.getElementById('submitBtnText').textContent = 'Create & Upload';
            document.getElementById('submitSpinner').style.display = 'none';
            document.getElementById('uploadProgress').style.display = 'none';
          }
        }
      );
    } catch (error) {
      console.error('Error creating bug:', error);
      showError('Failed to create bug: ' + error.message);
      submitBtn.disabled = false;
      document.getElementById('submitBtnText').textContent = 'Create & Upload';
      document.getElementById('submitSpinner').style.display = 'none';
      document.getElementById('uploadProgress').style.display = 'none';
    }
  }

  function updateProgress(percent, text) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
  }
});
