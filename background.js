// Background Service Worker for Anti Bugs Extension
// Handles HAR capture via chrome.debugger, message routing, and state management

import { HARCapture } from './modules/har-capture.js';
import { MondayAPI } from './modules/monday-api.js';

const harCapture = new HARCapture();
const mondayAPI = new MondayAPI();

// Track active debugger sessions
const activeSessions = new Map();

// Listen for extension icon click
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked', tab);
});

// Message handler for popup/content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'captureScreenshot':
        await handleCaptureScreenshot(message, sendResponse);
        break;
      
      case 'createBug':
        await handleCreateBug(message, sendResponse);
        break;
      
      case 'fetchRecentBugs':
        await handleFetchRecentBugs(message, sendResponse);
        break;
      
      case 'testMondayConnection':
        await handleTestConnection(message, sendResponse);
        break;
      
      case 'fetchBoardColumns':
        await handleFetchBoardColumns(message, sendResponse);
        break;
      
      case 'getMe':
        await handleGetMe(message, sendResponse);
        break;
      
      case 'findItemByName':
        await handleFindItemByName(message, sendResponse);
        break;
      
      case 'updateBugCase':
        await handleUpdateBugCase(message, sendResponse);
        break;
      
      case 'fetchBoardTags':
        await handleFetchBoardTags(message, sendResponse);
        break;

      case 'fetchActiveStatusLabels':
        await handleFetchActiveStatusLabels(message, sendResponse);
        break;

      case 'fetchUsers':
        await handleFetchUsers(message, sendResponse);
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCaptureScreenshot(message, sendResponse) {
  const { tabId } = message;
  
  try {
    // Wait a moment for any popup/window to close
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Focus the tab to ensure it's visible
    await chrome.tabs.update(tabId, { active: true });
    
    // Wait another moment for tab to be fully focused
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Capture the visible tab (now without any extension popup)
    const screenshot = await chrome.tabs.captureVisibleTab(null, {
      format: 'png'
    });
    
    // Store screenshot and open annotation page
    await chrome.storage.local.set({ 
      pendingScreenshot: screenshot,
      screenshotInProgress: false
    });
    
    // Open annotation page in a new window
    chrome.windows.create({
      url: 'annotate.html',
      type: 'popup',
      width: 1200,
      height: 800
    });
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    await chrome.storage.local.set({ screenshotInProgress: false });
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCreateBug(message, sendResponse) {
  const { bugData, boardId, groupId, attachmentCount, columnValues, bodyHtml, mentionsList } = message;

  try {
    console.log(`Creating bug with ${attachmentCount} attachments...`);

    const settings = await chrome.storage.sync.get(['mondayToken']);

    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }

    // The create-bug form forwards the user's board/group selection. The
    // saved Default configuration is reserved for updating existing bug
    // cases — for new bug reports we always use what the user picked.
    if (!boardId || !groupId) {
      sendResponse({ success: false, error: 'Please select a board and group on the form' });
      return;
    }

    // Retrieve attachments from local storage (avoids message size limit)
    let attachments = [];
    if (attachmentCount > 0) {
      const storage = await chrome.storage.local.get(['pendingAttachments']);
      attachments = storage.pendingAttachments || [];
      console.log(`Retrieved ${attachments.length} attachments from storage`);
    }

    mondayAPI.setToken(settings.mondayToken);

    // Create the bug item with attachments first. When the page provides a
    // pre-rendered HTML body (with @-mention chips inline) and a deduped
    // mentions_list, route them through createBugItem → addUpdateToItem so
    // Monday's notification pipeline fires bell notifications for the
    // mentioned users. Without these, mention-chip HTML alone is not
    // enough — Monday only notifies based on `mentions_list`.
    console.log(`Creating bug item with ${attachments.length} attachments on board ${boardId}, group ${groupId}...`);
    const item = await mondayAPI.createBugItem(
      boardId,
      groupId,
      bugData,
      attachments,
      { bodyHtml: bodyHtml || null, mentionsList: mentionsList || null }
    );
    
    console.log('Bug creation complete:', item);
    console.log('Upload results:', item.uploadResults);
    
    // Fetch board columns to find default value column IDs
    console.log('Fetching board columns for updates...');
    const columns = await mondayAPI.fetchBoardColumns(boardId);
    
    // Find columns that need forced defaults
    const defaultColumns = {};
    columns.forEach(col => {
      if (col.title === 'Status') {
        defaultColumns.status = { id: col.id, type: col.type, settings: col.settings };
      } else if (col.title === 'Bug/Feature') {
        defaultColumns.bugFeature = { id: col.id, type: col.type, settings: col.settings };
      } else if (col.title === 'Bug Status') {
        defaultColumns.bugStatus = { id: col.id, type: col.type, settings: col.settings };
      }
    });
    
    // Apply enforced defaults FIRST (separate mutation)
    console.log('=== Applying enforced defaults ===');
    const forcedDefaults = {};
    
    if (defaultColumns.status && defaultColumns.status.settings) {
      const statusValue = mondayAPI.findLabelValue(defaultColumns.status.settings, 'Ready for Development');
      if (statusValue) {
        forcedDefaults[defaultColumns.status.id] = statusValue;
        console.log('✓ Forcing Status to "Ready for Development"');
      }
    }
    
    if (defaultColumns.bugFeature && defaultColumns.bugFeature.settings) {
      const bugFeatureValue = mondayAPI.findLabelValue(defaultColumns.bugFeature.settings, 'Bug');
      if (bugFeatureValue) {
        forcedDefaults[defaultColumns.bugFeature.id] = bugFeatureValue;
        console.log('✓ Forcing Bug/Feature to "Bug"');
      }
    }
    
    if (defaultColumns.bugStatus && defaultColumns.bugStatus.settings) {
      const bugStatusValue = mondayAPI.findLabelValue(defaultColumns.bugStatus.settings, 'Open');
      if (bugStatusValue) {
        forcedDefaults[defaultColumns.bugStatus.id] = bugStatusValue;
        console.log('✓ Forcing Bug Status to "Open"');
      }
    }
    
    // Apply enforced defaults
    if (Object.keys(forcedDefaults).length > 0) {
      try {
        await mondayAPI.updateColumnValues(
          boardId,
          item.id,
          forcedDefaults
        );
        console.log('✅ Enforced defaults applied successfully');
      } catch (defaultsError) {
        console.error('❌ Failed to apply enforced defaults:', defaultsError);
        // Continue anyway - we'll try individual updates
      }
    }
    
    // Apply user-selected values (one by one to prevent cascading failures)
    console.log('=== Applying user-selected values ===');
    if (columnValues && Object.keys(columnValues).length > 0) {
      const successfulUpdates = [];
      const failedUpdates = [];
      
      for (const [columnId, columnValue] of Object.entries(columnValues)) {
        // Skip if this is one of the enforced default columns (already set)
        const isDefaultColumn = Object.values(defaultColumns).some(col => col.id === columnId);
        if (isDefaultColumn) {
          console.log(`  ⏭️  Skipping ${columnId} (enforced default)`);
          continue;
        }
        
        try {
          console.log(`  🔄 Updating column ${columnId}:`, columnValue);
          
          // Find column metadata
          const columnMeta = columns.find(col => col.id === columnId);
          
          // Special handling for status/color columns - ensure we use label text
          if (columnMeta && (columnMeta.type === 'status' || columnMeta.type === 'color')) {
            const labelValue = mondayAPI.findLabelValue(columnMeta.settings, columnValue.label || columnValue);
            if (labelValue) {
              await mondayAPI.updateColumnValues(
                boardId,
                item.id,
                { [columnId]: labelValue }
              );
              successfulUpdates.push(columnId);
              console.log(`  ✅ ${columnId} updated`);
            } else {
              console.warn(`  ⚠️  Label not found for ${columnId}: ${columnValue.label || columnValue}`);
              failedUpdates.push({ columnId, error: 'Label not found or deactivated' });
            }
          }
          // Skip unsupported column types
          else if (columnMeta && (columnMeta.type === 'tag' || columnMeta.type === 'tags' || columnMeta.type === 'board_relation')) {
            console.log(`  ⏭️  Skipping unsupported column ${columnId} (${columnMeta.type})`);
            continue;
          }
          // Handle other columns normally
          else {
            await mondayAPI.updateColumnValues(
              boardId,
              item.id,
              { [columnId]: columnValue }
            );
            successfulUpdates.push(columnId);
            console.log(`  ✅ ${columnId} updated`);
          }
        } catch (columnError) {
          console.error(`  ❌ Failed to update ${columnId}:`, columnError.message);
          failedUpdates.push({ columnId, error: columnError.message });
          // Continue with other columns
        }
      }
      
      console.log(`✅ Updated ${successfulUpdates.length} columns successfully`);
      if (failedUpdates.length > 0) {
        console.warn(`⚠️  Failed to update ${failedUpdates.length} columns:`, failedUpdates);
      }
    }
    
    // Clean up stored attachments
    await chrome.storage.local.remove(['pendingAttachments']);
    
    // Show notification
    try {
      const bugTitle = bugData.title || bugData.description || 'New Bug';
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Bug Reported Successfully',
        message: `Bug "${bugTitle}" has been created on Monday.com`,
        priority: 2
      });
    } catch (notifError) {
      console.error('Notification failed:', notifError);
      // Don't fail the whole operation for notification errors
    }
    
    sendResponse({ success: true, item });
  } catch (error) {
    console.error('Bug creation failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFetchRecentBugs(message, sendResponse) {
  try {
    console.log('Handling fetchRecentBugs request...');
    const settings = await chrome.storage.sync.get(['mondayToken', 'selectedBoardId', 'selectedGroupId']);

    // Allow the popup to specify which saved configuration to view. Fall back
    // to the stored default (selectedBoardId/selectedGroupId) when not provided.
    const boardId = message.boardId || settings.selectedBoardId;
    const groupId = message.groupId || settings.selectedGroupId;

    console.log('Settings for fetch:', {
      hasToken: !!settings.mondayToken,
      boardId,
      groupId,
      overridden: !!(message.boardId && message.groupId)
    });

    if (!settings.mondayToken) {
      console.error('No Monday token found');
      sendResponse({ success: false, error: 'Monday.com not connected. Please configure your API token in settings.' });
      return;
    }

    if (!boardId || !groupId) {
      console.error('No board/group selected');
      sendResponse({ success: false, error: 'Please select a board and group in settings' });
      return;
    }

    mondayAPI.setToken(settings.mondayToken);

    console.log('Fetching bugs from Monday...');
    const bugs = await mondayAPI.fetchRecentItems(boardId, groupId);

    console.log('Bugs fetched successfully:', bugs.length);
    sendResponse({ success: true, bugs });
  } catch (error) {
    console.error('Fetch bugs failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleTestConnection(message, sendResponse) {
  const { token } = message;
  
  try {
    mondayAPI.setToken(token);
    const workspaces = await mondayAPI.fetchWorkspaces();
    
    sendResponse({ success: true, workspaces });
  } catch (error) {
    console.error('Connection test failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFetchBoardColumns(message, sendResponse) {
  const { boardId } = message;
  
  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    
    mondayAPI.setToken(settings.mondayToken);
    const columns = await mondayAPI.fetchBoardColumns(boardId);
    
    sendResponse({ success: true, columns });
  } catch (error) {
    console.error('Fetch columns failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFetchBoardTags(message, sendResponse) {
  const { boardId } = message;
  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    if (!boardId) {
      sendResponse({ success: false, error: 'Board is required' });
      return;
    }
    mondayAPI.setToken(settings.mondayToken);
    const result = await mondayAPI.fetchBoardTags(boardId);
    sendResponse({
      success: true,
      tags: result.tags || [],
      columnType: result.columnType || null,
      columnId: result.columnId || null
    });
  } catch (error) {
    console.error('fetchBoardTags failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFetchActiveStatusLabels(message, sendResponse) {
  const { boardId, columnTitle } = message;
  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    if (!boardId) {
      sendResponse({ success: false, error: 'Board is required' });
      return;
    }
    if (!columnTitle) {
      sendResponse({ success: false, error: 'Column title is required' });
      return;
    }
    mondayAPI.setToken(settings.mondayToken);
    const result = await mondayAPI.fetchActiveStatusLabels(boardId, columnTitle);
    sendResponse({
      success: true,
      labels: result.labels || [],
      columnId: result.columnId || null,
      columnType: result.columnType || null
    });
  } catch (error) {
    console.error('fetchActiveStatusLabels failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFetchUsers(message, sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    mondayAPI.setToken(settings.mondayToken);
    const users = await mondayAPI.fetchUsers();
    sendResponse({ success: true, users });
  } catch (error) {
    console.error('fetchUsers failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetMe(message, sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    mondayAPI.setToken(settings.mondayToken);
    const me = await mondayAPI.fetchMe();
    sendResponse({ success: true, me });
  } catch (error) {
    console.error('fetchMe failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFindItemByName(message, sendResponse) {
  const { boardId, name } = message;

  try {
    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    if (!boardId) {
      sendResponse({ success: false, error: 'Board is required' });
      return;
    }
    if (!name || !name.trim()) {
      sendResponse({ success: false, error: 'Item name is required' });
      return;
    }

    mondayAPI.setToken(settings.mondayToken);
    const items = await mondayAPI.findItemByName(boardId, name.trim());
    sendResponse({ success: true, items });
  } catch (error) {
    console.error('findItemByName failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleUpdateBugCase(message, sendResponse) {
  const {
    itemId,
    boardId,
    body,
    mentionsList,
    resolutionStatus,
    status,
    personId,
    tagIdsToAdd,
    existingTagIds,
    attachmentCount
  } = message;

  try {
    console.log('=== Handling updateBugCase ===', { itemId, boardId });

    const settings = await chrome.storage.sync.get(['mondayToken']);
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    if (!itemId || !boardId) {
      sendResponse({ success: false, error: 'Item and board are required' });
      return;
    }

    mondayAPI.setToken(settings.mondayToken);

    // 1. Post the update body. Mention-chip HTML in the body alone does NOT
    //    reliably fire Monday's bell notifications via the API, so we also
    //    forward the deduped `mentions_list` (collected in update-bug.js)
    //    which is what Monday's notification pipeline actually reads.
    if (body) {
      console.log('Posting update to item...');
      try {
        await mondayAPI.addUpdateToItem(itemId, body, mentionsList || null);
        console.log('Update posted successfully.');
      } catch (updateError) {
        console.error('Failed to post update:', updateError);
        sendResponse({ success: false, error: `Failed to post update: ${updateError.message}` });
        return;
      }
    }

    // 2. Fetch board columns so we can resolve IDs + label values
    console.log('Fetching board columns...');
    const columns = await mondayAPI.fetchBoardColumns(boardId);

    const findColumn = (title) => columns.find(col =>
      col.title && col.title.toLowerCase() === title.toLowerCase()
    );

    const resolutionColumn = findColumn('Resolution status');
    const statusColumn = findColumn('Status');
    const ownerColumn = findColumn('Tech support owner');
    const tagsColumn = findColumn('Tags Tech Support');

    // 3. Build per-column updates (applied one-by-one for resilience)
    const columnUpdates = [];

    if (personId && ownerColumn) {
      columnUpdates.push({
        columnId: ownerColumn.id,
        columnTitle: ownerColumn.title,
        value: {
          personsAndTeams: [{ id: parseInt(personId), kind: 'person' }]
        }
      });
    } else if (personId && !ownerColumn) {
      console.warn('No "Tech support owner" column found on board; skipping owner update');
    }

    if (resolutionStatus && resolutionColumn) {
      const labelValue = mondayAPI.findLabelValue(resolutionColumn.settings, resolutionStatus);
      if (labelValue) {
        columnUpdates.push({
          columnId: resolutionColumn.id,
          columnTitle: resolutionColumn.title,
          value: labelValue
        });
      } else {
        console.warn(`Resolution status label "${resolutionStatus}" not found on board`);
      }
    }

    if (status && statusColumn) {
      const labelValue = mondayAPI.findLabelValue(statusColumn.settings, status);
      if (labelValue) {
        columnUpdates.push({
          columnId: statusColumn.id,
          columnTitle: statusColumn.title,
          value: labelValue
        });
      } else {
        console.warn(`Status label "${status}" not found on board`);
      }
    }

    // 4. Merge chosen tag IDs with existing tag IDs (only existing tags can be selected).
    //    Payload format depends on the underlying column type:
    //      - "tag"/"tags"  → { tag_ids: [...] }
    //      - "dropdown"    → { ids: [...] }
    if (tagsColumn && Array.isArray(tagIdsToAdd) && tagIdsToAdd.length > 0) {
      const mergedIds = Array.isArray(existingTagIds) ? [...existingTagIds] : [];
      for (const rawId of tagIdsToAdd) {
        const numericId = parseInt(rawId);
        if (!Number.isNaN(numericId) && !mergedIds.includes(numericId)) {
          mergedIds.push(numericId);
        }
      }

      let tagValue;
      if (tagsColumn.type === 'dropdown') {
        tagValue = { ids: mergedIds };
      } else {
        // Default to tag format for "tag"/"tags" columns
        tagValue = { tag_ids: mergedIds };
      }

      columnUpdates.push({
        columnId: tagsColumn.id,
        columnTitle: tagsColumn.title,
        value: tagValue
      });
    }

    // 5. Apply column updates one-by-one
    const successfulUpdates = [];
    const failedUpdates = [];
    for (const upd of columnUpdates) {
      try {
        console.log(`Updating column "${upd.columnTitle}" (${upd.columnId}):`, upd.value);
        await mondayAPI.updateColumnValues(
          boardId,
          itemId,
          { [upd.columnId]: upd.value }
        );
        successfulUpdates.push(upd.columnTitle);
      } catch (colErr) {
        console.error(`Failed to update "${upd.columnTitle}":`, colErr.message);
        failedUpdates.push({ columnTitle: upd.columnTitle, error: colErr.message });
      }
    }

    // 6. Handle attachments
    let uploadResults = null;
    if (attachmentCount && attachmentCount > 0) {
      console.log(`Uploading ${attachmentCount} attachment(s)...`);
      const storage = await chrome.storage.local.get(['pendingAttachments']);
      const attachments = storage.pendingAttachments || [];
      try {
        uploadResults = await mondayAPI.addFilesToItem(itemId, attachments);
        console.log('Upload results:', uploadResults);
      } catch (uploadErr) {
        console.error('Attachment upload failed:', uploadErr);
        uploadResults = {
          uploaded: [],
          failed: attachments.map(f => ({ name: f.name, error: uploadErr.message })),
          skipped: []
        };
      } finally {
        await chrome.storage.local.remove(['pendingAttachments']);
      }
    }

    // 7. Fetch item URL for the success redirect
    let itemUrl = message.itemUrl || null;

    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Bug Case Updated',
        message: `Successfully updated ${successfulUpdates.length} field(s) on the ticket`,
        priority: 2
      });
    } catch (notifErr) {
      console.warn('Notification failed:', notifErr);
    }

    sendResponse({
      success: true,
      item: { id: itemId, url: itemUrl },
      successfulUpdates,
      failedUpdates,
      uploadResults
    });
  } catch (error) {
    console.error('updateBugCase failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Cleanup on extension unload
chrome.runtime.onSuspend.addListener(() => {
  harCapture.cleanup();
});

console.log('Anti Bugs background service worker loaded');
