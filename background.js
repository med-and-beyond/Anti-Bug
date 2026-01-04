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
    
    // Create the bug item with attachments first
    console.log(`Creating bug item with ${attachments.length} attachments...`);
    const item = await mondayAPI.createBugItem(
      settings.selectedBoardId,
      settings.selectedGroupId,
      bugData,
      attachments
    );
    
    console.log('Bug creation complete:', item);
    console.log('Upload results:', item.uploadResults);
    
    // Fetch board columns to find default value column IDs
    console.log('Fetching board columns for updates...');
    const columns = await mondayAPI.fetchBoardColumns(settings.selectedBoardId);
    
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
    
    // STEP 1: Apply enforced defaults FIRST (separate mutation)
    console.log('=== STEP 1: Applying enforced defaults ===');
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
          settings.selectedBoardId,
          item.id,
          forcedDefaults
        );
        console.log('✅ Enforced defaults applied successfully');
      } catch (defaultsError) {
        console.error('❌ Failed to apply enforced defaults:', defaultsError);
        // Continue anyway - we'll try individual updates
      }
    }
    
    // Handle Link to Bug Case from bugData (if provided)
    if (bugData.linkToBugCase && bugData.linkToBugCase.trim()) {
      console.log('🔗 Link to Bug Case provided:', bugData.linkToBugCase);
      console.log('🔍 Looking for Link or Text column (NOT board-relation)...');
      
      // Find a Link or Text column (explicitly exclude board-relation)
      const linkColumn = columns.find(col => {
        const titleMatches = col.title === 'Link to Bug Case' || 
                            col.title.toLowerCase().includes('link to bug') ||
                            col.title === 'Bug Case Link' ||
                            col.title === 'Bug Case URL';
        
        const isLinkOrText = col.type === 'text' || col.type === 'link' || col.type === 'url';
        const notBoardRelation = col.type !== 'board_relation';
        
        if (titleMatches) {
          console.log(`  Found column "${col.title}" with type: ${col.type}`);
        }
        
        return titleMatches && isLinkOrText && notBoardRelation;
      });
      
      if (linkColumn) {
        console.log(`✅ Using column: "${linkColumn.title}" (${linkColumn.type}) for Link to Bug Case`);
        
        // Add to columnValues with proper format
        if (linkColumn.type === 'link' || linkColumn.type === 'url') {
          columnValues[linkColumn.id] = {
            url: bugData.linkToBugCase,
            text: bugData.linkToBugCase
          };
          console.log(`  Format: Link column {url: "...", text: "..."}`);
        } else {
          // Text column - plain string
          columnValues[linkColumn.id] = bugData.linkToBugCase;
          console.log(`  Format: Text column (plain string)`);
        }
      } else {
        console.warn('⚠️  No suitable Link or Text column found for "Link to Bug Case"');
        console.log('Available columns:', columns.map(c => `${c.title} (${c.type})`).join(', '));
        console.log('💡 Please create a Link or Text column named "Link to Bug Case" in your Monday board');
      }
    }
    
    // STEP 2: Apply user-selected values (one by one to prevent cascading failures)
    console.log('=== STEP 2: Applying user-selected values ===');
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
                settings.selectedBoardId,
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
          // Special handling for tags columns
          else if (columnMeta && (columnMeta.type === 'tag' || columnMeta.type === 'tags')) {
            console.log(`  📌 Tags column detected, payload:`, columnValue);
            
            // Monday expects tag IDs as STRINGS, not integers
            // Format: { "tag_ids": ["id1", "id2", "id3"] }
            
            if (columnValue && columnValue.tag_ids && Array.isArray(columnValue.tag_ids)) {
              const existingTagIds = [];
              const newTagNames = [];
              
              // Separate existing IDs from new tag names
              for (const tagId of columnValue.tag_ids) {
                const idStr = tagId.toString();
                // If it's numeric, it's an existing tag ID
                if (!isNaN(parseInt(idStr))) {
                  existingTagIds.push(idStr); // Store as STRING
                } else {
                  // It's a new tag name
                  newTagNames.push(idStr);
                }
              }
              
              console.log(`  📌 Existing tag IDs (strings):`, existingTagIds);
              console.log(`  📌 New tag names to create:`, newTagNames);
              
              // Create new tags and get their IDs
              const allTagIds = [...existingTagIds];
              for (const tagName of newTagNames) {
                try {
                  console.log(`  🏷️  Creating/getting tag: "${tagName}"`);
                  const newTagId = await mondayAPI.createOrGetTag(settings.selectedBoardId, tagName);
                  allTagIds.push(newTagId); // Already a string
                  console.log(`  ✅ Tag "${tagName}" created with ID: ${newTagId}`);
                } catch (tagError) {
                  console.error(`  ❌ Failed to create tag "${tagName}":`, tagError.message);
                  // Continue with other tags
                }
              }
              
              // Now update the column with all tag IDs (as strings)
              if (allTagIds.length > 0) {
                const tagsPayload = { tag_ids: allTagIds };
                console.log(`  📌 Final tags payload (all IDs as strings):`, tagsPayload);
                
                await mondayAPI.updateColumnValues(
                  settings.selectedBoardId,
                  item.id,
                  { [columnId]: tagsPayload }
                );
                successfulUpdates.push(columnId);
                console.log(`  ✅ ${columnId} (tags) updated with ${allTagIds.length} tag(s)`);
              } else {
                console.warn(`  ⚠️  No valid tags to apply`);
              }
            } else {
              console.warn(`  ⚠️  Invalid tags payload format:`, columnValue);
            }
          }
          // Skip board-relation columns for now (Link to Bug Case needs item IDs)
          else if (columnMeta && columnMeta.type === 'board_relation') {
            console.log(`  ⏭️  Skipping board_relation column ${columnId} (not yet supported)`);
            continue;
          }
          // Handle other columns normally
          else {
            await mondayAPI.updateColumnValues(
              settings.selectedBoardId,
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
