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
  const { bugData, attachmentCount, columnValues } = message;
  
  try {
    console.log(`Creating bug with ${attachmentCount} attachments...`);
    
    const settings = await chrome.storage.sync.get(['mondayToken', 'selectedBoardId', 'selectedGroupId']);
    
    if (!settings.mondayToken) {
      sendResponse({ success: false, error: 'Monday.com not connected' });
      return;
    }
    
    if (!settings.selectedBoardId || !settings.selectedGroupId) {
      sendResponse({ success: false, error: 'Please select a board and group in settings' });
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
    
    // Fetch board columns to find default value column IDs
    console.log('Fetching board columns for forced defaults...');
    const columns = await mondayAPI.fetchBoardColumns(settings.selectedBoardId);
    
    // Find columns that need forced defaults
    const defaultColumns = {};
    columns.forEach(col => {
      if (col.title === 'Status') {
        defaultColumns.status = { id: col.id, type: col.type };
      } else if (col.title === 'Bug/Feature') {
        defaultColumns.bugFeature = { id: col.id, type: col.type };
      } else if (col.title === 'Bug Status') {
        defaultColumns.bugStatus = { id: col.id, type: col.type };
      }
    });
    
    // Merge forced defaults with user-provided column values
    const forcedDefaults = {};
    if (defaultColumns.status) {
      forcedDefaults[defaultColumns.status.id] = { label: 'Ready for Development' };
      console.log('Forcing Status to "Ready for Development"');
    }
    if (defaultColumns.bugFeature) {
      forcedDefaults[defaultColumns.bugFeature.id] = { label: 'Bug' };
      console.log('Forcing Bug/Feature to "Bug"');
    }
    if (defaultColumns.bugStatus) {
      forcedDefaults[defaultColumns.bugStatus.id] = { label: 'Open' };
      console.log('Forcing Bug Status to "Open"');
    }
    
    // Merge: forced defaults override user values for these specific columns
    const finalColumnValues = { ...columnValues, ...forcedDefaults };
    
    // Create the bug item with attachments
    // The mondayAPI will handle file uploads internally
    console.log(`Creating bug item with ${attachments.length} attachments...`);
    const item = await mondayAPI.createBugItem(
      settings.selectedBoardId,
      settings.selectedGroupId,
      bugData,
      attachments
    );
    
    console.log('Bug creation complete:', item);
    console.log('Upload results:', item.uploadResults);
    
    // Update column values if provided (including forced defaults)
    if (finalColumnValues && Object.keys(finalColumnValues).length > 0) {
      console.log('Updating column values:', finalColumnValues);
      try {
        await mondayAPI.updateColumnValues(
          settings.selectedBoardId,
          item.id,
          finalColumnValues
        );
        console.log('Column values updated successfully');
      } catch (columnError) {
        console.error('Failed to update column values:', columnError);
        // Don't fail the whole operation if column updates fail
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
    
    console.log('Settings for fetch:', {
      hasToken: !!settings.mondayToken,
      boardId: settings.selectedBoardId,
      groupId: settings.selectedGroupId
    });
    
    if (!settings.mondayToken) {
      console.error('No Monday token found');
      sendResponse({ success: false, error: 'Monday.com not connected. Please configure your API token in settings.' });
      return;
    }
    
    if (!settings.selectedBoardId || !settings.selectedGroupId) {
      console.error('No board/group selected');
      sendResponse({ success: false, error: 'Please select a board and group in settings' });
      return;
    }
    
    mondayAPI.setToken(settings.mondayToken);
    
    console.log('Fetching bugs from Monday...');
    const bugs = await mondayAPI.fetchRecentItems(
      settings.selectedBoardId,
      settings.selectedGroupId
    );
    
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

// Cleanup on extension unload
chrome.runtime.onSuspend.addListener(() => {
  harCapture.cleanup();
});

console.log('Anti Bugs background service worker loaded');
