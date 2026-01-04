// Monday.com API Integration Module
// Handles authentication, GraphQL queries, and file uploads

export class MondayAPI {
  constructor() {
    this.token = null;
    this.apiUrl = 'https://api.monday.com/v2';
  }

  setToken(token) {
    this.token = token;
  }

  async query(query, variables = {}) {
    if (!this.token) {
      console.error('Monday.com token not set');
      throw new Error('Monday.com token not set');
    }

    console.log('Monday API query:', { 
      query: query.substring(0, 100) + '...', 
      variables 
    });

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token,
          'API-Version': '2024-01'
        },
        body: JSON.stringify({ query, variables })
      });

      console.log('Monday API response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Monday API HTTP error:', response.status, errorText);
        throw new Error(`Monday API error (${response.status}): ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Monday API result:', result);
      
      if (result.errors && result.errors.length > 0) {
        const errorMsg = result.errors[0].message || 'Unknown error';
        const errorCode = result.errors[0].extensions?.code;
        const errorPath = result.errors[0].path ? ` (${result.errors[0].path.join('.')})` : '';
        
        // Only log full error details for non-authorization errors to reduce noise
        if (errorCode === 'UserUnauthorizedException') {
          console.warn(`Monday API: ${errorMsg}${errorPath} - This is normal if your token has limited board access`);
        } else {
          console.error('Monday GraphQL errors:', JSON.stringify(result.errors, null, 2));
        }
        
        throw new Error(`Monday GraphQL error: ${errorMsg}${errorPath}`);
      }

      if (!result.data) {
        console.error('No data in Monday response:', result);
        throw new Error('No data returned from Monday API');
      }

      return result.data;
    } catch (error) {
      console.error('Monday API query failed:', error);
      throw error;
    }
  }

  async fetchWorkspaces() {
    console.log('Fetching all boards with pagination...');
    const allBoards = [];
    let page = 1;
    const limit = 100; // Increase to 100 to fetch more boards per request
    let hasMore = true;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 2;

    while (hasMore && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
      console.log(`Fetching boards page ${page}...`);
      
      const query = `
        query ($page: Int!, $limit: Int!) {
          boards(limit: $limit, page: $page) {
            id
            name
            workspace {
              id
              name
            }
            groups {
              id
              title
            }
          }
        }
      `;

      try {
        const data = await this.query(query, { page, limit });
        const boards = data.boards || [];
        
        console.log(`✓ Received ${boards.length} boards on page ${page}`);
        consecutiveErrors = 0;
        
        if (boards.length > 0) {
          allBoards.push(...boards);
          
          // If we got less than the limit, we've reached the end
          if (boards.length < limit) {
            console.log(`✓ Reached end of boards (got ${boards.length} < ${limit})`);
            hasMore = false;
          } else {
            page++;
          }
        } else {
          console.log('✓ No more boards to fetch');
          hasMore = false;
        }
      } catch (error) {
        console.error(`⚠️ Error fetching boards page ${page}:`, error.message);
        consecutiveErrors++;
        
        if (error.message && (error.message.includes('unauthorized') || error.message.includes('UserUnauthorizedException'))) {
          console.warn(`⚠️ Unauthorized access at page ${page}`);
          console.log(`📌 Already fetched ${allBoards.length} boards`);
          
          // Try next page instead of stopping completely
          if (page === 1) {
            console.error('❌ Cannot access any boards with this token');
            hasMore = false;
          } else if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
            console.log(`🔄 Trying page ${page + 1}...`);
            page++;
          } else {
            hasMore = false;
          }
        } else {
          console.warn(`⚠️ Error on page ${page}: ${error.message}`);
          if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
            page++;
          } else {
            hasMore = false;
          }
        }
      }
    }

    console.log(`✅ Total boards fetched: ${allBoards.length}`);
    
    if (allBoards.length === 0) {
      console.error('❌ No boards accessible with current API token');
    }
    
    // Sort boards by workspace name, then by board name
    allBoards.sort((a, b) => {
      const workspaceA = a.workspace?.name || 'No Workspace';
      const workspaceB = b.workspace?.name || 'No Workspace';
      
      if (workspaceA !== workspaceB) {
        return workspaceA.localeCompare(workspaceB);
      }
      
      return a.name.localeCompare(b.name);
    });

    return allBoards;
  }

  async fetchRecentItems(boardId, groupId, limit = 10) {
    const query = `
      query ($boardId: [ID!]!, $limit: Int!) {
        boards(ids: $boardId) {
          groups(ids: ["${groupId}"]) {
            items_page(limit: $limit) {
              items {
                id
                name
                created_at
                updated_at
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.query(query, { 
      boardId: [boardId], 
      limit 
    });

    if (data.boards && data.boards[0] && data.boards[0].groups[0]) {
      return data.boards[0].groups[0].items_page.items;
    }

    return [];
  }

  async fetchBoardColumns(boardId) {
    console.log('Fetching columns for board:', boardId);
    
    const query = `
      query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const data = await this.query(query, { boardId: [boardId] });

    if (data.boards && data.boards[0]) {
      const columns = data.boards[0].columns;
      console.log(`Fetched ${columns.length} columns`);
      
      // Parse settings_str for each column to get additional metadata
      return columns.map(col => {
        let settings = {};
        try {
          if (col.settings_str) {
            settings = JSON.parse(col.settings_str);
          }
        } catch (e) {
          console.warn(`Failed to parse settings for column ${col.id}:`, e);
        }
        
        return {
          ...col,
          settings
        };
      });
    }

    return [];
  }

  async createOrGetTag(boardId, tagName) {
    /**
     * Create a new tag or get existing tag ID by name
     * Returns the tag ID as a string
     */
    console.log(`Creating/getting tag "${tagName}" for board ${boardId}`);
    
    const mutation = `
      mutation ($boardId: ID!, $tagName: String!) {
        create_or_get_tag(board_id: $boardId, tag_name: $tagName) {
          id
          name
        }
      }
    `;
    
    try {
      const data = await this.query(mutation, {
        boardId: parseInt(boardId),
        tagName: tagName
      });
      
      const tag = data.create_or_get_tag;
      console.log(`✓ Tag "${tagName}" has ID: ${tag.id}`);
      return tag.id.toString(); // Return as string
    } catch (error) {
      console.error(`Failed to create/get tag "${tagName}":`, error);
      throw error;
    }
  }

  findLabelValue(columnSettings, labelText) {
    /**
     * Find the correct label value format for a status/color column
     * Returns the proper format based on active labels in column settings
     */
    if (!columnSettings || !labelText) {
      return null;
    }

    console.log(`Finding label "${labelText}" in settings:`, columnSettings);

    // Monday status/color columns have labels and labels_colors
    const labels = columnSettings.labels || {};
    const labelsColors = columnSettings.labels_colors || {};

    // Find the label ID that matches the text (case-insensitive)
    let matchedLabelId = null;
    
    // labels is an object like { "0": "Not Started", "1": "Working on it", ... }
    for (const [labelId, labelName] of Object.entries(labels)) {
      if (labelName && labelName.toLowerCase() === labelText.toLowerCase()) {
        // Check if this label is active (has color info)
        if (labelsColors[labelId]) {
          matchedLabelId = labelId;
          console.log(`✓ Found active label: "${labelText}" with ID ${labelId}`);
          break;
        } else {
          console.warn(`⚠️  Label "${labelText}" (ID ${labelId}) exists but is deactivated`);
        }
      }
    }

    if (!matchedLabelId) {
      console.warn(`❌ Label "${labelText}" not found in active labels`);
      console.log('Available active labels:', 
        Object.entries(labels)
          .filter(([id]) => labelsColors[id])
          .map(([id, name]) => name)
      );
      return null;
    }

    // Return the format Monday expects: { label: "Label Text" }
    // Monday will match by text internally
    return { label: labelText };
  }

  async updateColumnValues(boardId, itemId, columnValues) {
    console.log('Updating column values for item:', itemId);
    console.log('Column values:', JSON.stringify(columnValues, null, 2));
    
    // Convert columnValues object to JSON string format expected by Monday
    const columnValuesJson = JSON.stringify(columnValues);
    console.log('Stringified column values:', columnValuesJson);
    
    const mutation = `
      mutation {
        change_multiple_column_values(
          board_id: ${parseInt(boardId)},
          item_id: ${parseInt(itemId)},
          column_values: ${JSON.stringify(columnValuesJson)}
        ) {
          id
          name
        }
      }
    `;
    
    console.log('GraphQL mutation:', mutation);

    const data = await this.query(mutation);

    return data.change_multiple_column_values;
  }

  async createBugItem(boardId, groupId, bugData, attachments = []) {
    // Create the item with the Title field as the item name
    const bugTitle = bugData.title || bugData.description || 'New Bug';
    
    const createQuery = `
      mutation ($boardId: ID!, $groupId: String!, $itemName: String!) {
        create_item(
          board_id: $boardId,
          group_id: $groupId,
          item_name: $itemName
        ) {
          id
          name
          url
        }
      }
    `;

    const result = await this.query(createQuery, {
      boardId: boardId,
      groupId: groupId,
      itemName: bugTitle
    });

    const item = result.create_item;

    // Add bug details as an update (post)
    try {
      await this.addBugDetailsUpdate(item.id, bugData);
    } catch (error) {
      console.error('Failed to add bug details:', error);
      // Continue anyway - item was created
    }

    // Attach files directly to the item's Files section
    if (attachments && attachments.length > 0) {
      console.log(`Attaching ${attachments.length} files to item ${item.id}...`);
      try {
        const uploadResults = await this.addFilesToItem(item.id, attachments);
        console.log('File upload results:', uploadResults);
        
        // Return item with upload results
        return {
          ...item,
          uploadResults: uploadResults
        };
      } catch (error) {
        console.error('Failed to attach files:', error);
        // Return item with error info but don't fail the whole operation
        return {
          ...item,
          uploadResults: {
            uploaded: [],
            failed: attachments.map(f => ({ name: f.name, error: error.message }))
          }
        };
      }
    }

    return item;
  }

  async addBugDetailsUpdate(itemId, bugData) {
    // Format bug details with clean formatting (Monday.com doesn't support markdown)
    let updateText = '🐛 BUG REPORT\n\n';
    
    // Add platform info
    if (bugData.platform) {
      updateText += `📱 Platform: ${bugData.platform}\n`;
    }
    
    // Add version
    if (bugData.version) {
      updateText += `📦 Version: ${bugData.version}\n`;
    }
    
    // Add description
    if (bugData.description) {
      updateText += `\n📝 Description:\n${bugData.description}\n`;
    }
    
    // Add steps to reproduce
    if (bugData.stepsToReproduce) {
      updateText += `\n🔢 Steps to reproduce:\n${bugData.stepsToReproduce}\n`;
    }
    
    // Add actual result
    if (bugData.actualResult) {
      updateText += `\n❌ Actual result:\n${bugData.actualResult}\n`;
    }
    
    // Add expected result
    if (bugData.expectedResult) {
      updateText += `\n✅ Expected result:\n${bugData.expectedResult}\n`;
    }
    
    // Add logs note
    if (bugData.stepsToReproduce || bugData.actualResult || bugData.expectedResult) {
      updateText += `\n📋 Logs: (HAR attached if available)`;
    }
    
    // Add media note
    updateText += `\n📸 Media: (screenshots attached if available)`;

    const mutation = `
      mutation ($itemId: ID!, $body: String!) {
        create_update(
          item_id: $itemId,
          body: $body
        ) {
          id
        }
      }
    `;

    await this.query(mutation, {
      itemId: itemId,
      body: updateText
    });
  }

  escapeMarkdown(text) {
    // Escape markdown special characters to prevent breaking formatting
    // But preserve newlines and basic formatting
    if (!text) return '';
    return text.toString();
  }

  buildColumnValues(bugData) {
    // Map bug data fields to Monday column values
    // This is a simplified version - actual implementation depends on board structure
    const values = {};

    // Example mapping (adjust based on actual Monday board columns)
    if (bugData.platform) {
      values.platform = { text: bugData.platform };
    }
    if (bugData.version) {
      values.version = { text: bugData.version };
    }

    // Long text fields
    if (bugData.description) {
      values.description = { text: bugData.description };
    }
    if (bugData.stepsToReproduce) {
      values.steps = { text: bugData.stepsToReproduce };
    }
    if (bugData.actualResult) {
      values.actual = { text: bugData.actualResult };
    }
    if (bugData.expectedResult) {
      values.expected = { text: bugData.expectedResult };
    }

    return values;
  }

  async addFilesToItem(itemId, files, progressCallback = null) {
    if (!files || files.length === 0) {
      return { success: true, uploaded: [], failed: [], skipped: [] };
    }

    const results = {
      uploaded: [],
      failed: [],
      skipped: []
    };

    // Create ONE update for all attachments
    console.log(`Creating attachments update for ${files.length} file(s)...`);
    
    const createUpdateMutation = `
      mutation {
        create_update(item_id: ${parseInt(itemId)}, body: "📎 Attachments (${files.length} files)") {
          id
        }
      }
    `;

    let updateId;
    try {
      const updateResult = await this.query(createUpdateMutation);
      
      if (!updateResult.create_update || !updateResult.create_update.id) {
        throw new Error('Failed to create attachments update');
      }
      
      updateId = parseInt(updateResult.create_update.id);
      console.log(`✓ Attachments update created: ${updateId}`);
    } catch (error) {
      console.error('Failed to create update:', error);
      return {
        uploaded: [],
        failed: [],
        skipped: files.map(f => ({ name: f.name, error: 'Could not create update for attachments' }))
      };
    }

    // Upload all files to this single update
    console.log(`Uploading ${files.length} file(s) to update ${updateId}...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total: files.length,
          fileName: file.name,
          status: 'uploading'
        });
      }

      try {
        const MAX_FILE_SIZE = 500 * 1024 * 1024;
        if (file.size && file.size > MAX_FILE_SIZE) {
          throw new Error(`File too large: ${file.name} exceeds 500MB limit`);
        }

        await this.uploadFileToUpdate(updateId, file);
        results.uploaded.push(file.name);

        if (progressCallback) {
          progressCallback({
            current: i + 1,
            total: files.length,
            fileName: file.name,
            status: 'completed'
          });
        }
      } catch (error) {
        console.error(`Failed to upload file ${file.name}:`, error);
        
        // Check if this is a quota exceeded error
        const isQuotaError = error.message && (
          error.message.includes('quota') || 
          error.message.includes('Resource::kQuotaBytes') ||
          error.message.includes('too large') ||
          error.message.includes('size limit')
        );
        
        if (isQuotaError) {
          results.skipped.push({
            name: file.name,
            error: 'File too large for upload via extension'
          });
        } else {
          results.failed.push({
            name: file.name,
            error: error.message
          });
        }

        if (progressCallback) {
          progressCallback({
            current: i + 1,
            total: files.length,
            fileName: file.name,
            status: isQuotaError ? 'skipped' : 'failed',
            error: error.message
          });
        }
      }
    }

    return results;
  }

  async uploadFileToUpdate(updateId, file, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    try {
      console.log(`  📤 ${file.name} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      
      // Convert data URL to blob
      let blob;
      let mimeType = file.type || 'application/octet-stream';

      if (file.dataUrl) {
        blob = await this.dataUrlToBlob(file.dataUrl);
        
        if (file.dataUrl.startsWith('data:')) {
          const match = file.dataUrl.match(/^data:([^;]+);/);
          if (match) {
            mimeType = match[1];
          }
        }
      } else if (file.blob) {
        blob = file.blob;
        mimeType = blob.type || mimeType;
      } else {
        throw new Error('File must have dataUrl or blob property');
      }

      if (blob.type !== mimeType) {
        blob = new Blob([blob], { type: mimeType });
      }

      // Monday.com Assets API approach:
      // Upload file directly, then add as asset to update
      const formData = new FormData();
      formData.append('query', `mutation ($file: File!) { add_file_to_update (file: $file, update_id: ${parseInt(updateId)}) { id } }`);
      
      // Map field is required for GraphQL multipart uploads
      const map = {
        "image": ["variables.file"]
      };
      formData.append('map', JSON.stringify(map));
      
      // Variables must include the file placeholder
      const variables = {
        "file": null,
        "update_id": parseInt(updateId)
      };
      formData.append('variables', JSON.stringify(variables));
      
      // The actual file goes in a field that matches the map
      formData.append('image', blob, file.name);
      
      const response = await fetch('https://api.monday.com/v2/file', {
        method: 'POST',
        headers: {
          'Authorization': this.token
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0].message);
      }

      if (!result.data || !result.data.add_file_to_update) {
        throw new Error('No file data returned');
      }

      console.log(`    ✓ ${file.name}`);
      return result;

    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.uploadFileToUpdate(updateId, file, retryCount + 1);
      }
      
      throw new Error(`Upload failed after ${MAX_RETRIES} attempts: ${error.message}`);
    }
  }


  async dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  // Test connection by fetching user info
  async testConnection() {
    const query = `
      query {
        me {
          id
          name
          email
        }
      }
    `;

    const data = await this.query(query);
    return data.me;
  }
}
