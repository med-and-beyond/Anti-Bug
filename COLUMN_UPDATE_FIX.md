# Column Update Fix - Resilient Updates

**Commit**: `6a12265 - Fix critical column update issues - resilient updates`  
**Status**: Fixed ✅

## Problems Fixed

### ❌ Before: Single Failure Broke Everything
When `change_multiple_column_values` was called with all columns at once:
- One invalid column → entire mutation failed
- NO values were applied (including enforced defaults)
- Deactivated label → all updates cancelled
- Invalid structure → nothing saved

### ✅ After: Resilient Multi-Step Updates

**Step 1: Enforced Defaults (Always Applied First)**
```javascript
// ALWAYS set these first in a separate mutation:
Status = "Ready for Development"
Bug/Feature = "Bug"  
Bug Status = "Open"
```

**Step 2: User Values (One-by-One)**
```javascript
// Each column updated individually:
for (column in userValues) {
  try {
    updateColumn(column);
    ✅ success
  } catch (error) {
    ❌ log error, continue to next
  }
}
```

**Result**: Failed columns don't block successful ones!

---

## Fix Details

### 1. Enforced Defaults Always Applied ✅

**Implementation**:
```javascript
// In background.js:
// STEP 1: Apply enforced defaults FIRST (separate mutation)
const forcedDefaults = {
  [statusColumnId]: { label: 'Ready for Development' },
  [bugFeatureColumnId]: { label: 'Bug' },
  [bugStatusColumnId]: { label: 'Open' }
};

await mondayAPI.updateColumnValues(boardId, itemId, forcedDefaults);
```

**Validation**:
- Uses `findLabelValue()` to ensure label exists and is active
- Maps by label TEXT, not index
- Logs which defaults are being applied

### 2. Pltfrm (Status) Column - Fixed Label Mapping ✅

**Problem**: Sending `{"index": 6}` for deactivated label → Error

**Solution**:
```javascript
// New helper method in monday-api.js:
findLabelValue(columnSettings, labelText) {
  // 1. Find label by TEXT (case-insensitive)
  // 2. Check if label is ACTIVE (has color info)
  // 3. Return { label: "Label Text" } or null
  // 4. Log available active labels if not found
}
```

**Frontend Changes**:
- Only shows ACTIVE labels in dropdown (filters by `labels_colors`)
- Stores label TEXT, not index
- Skips deactivated labels with warning

**Backend Changes**:
- Validates label before sending
- Uses `findLabelValue()` for status columns
- Sends `{ label: "Text" }` format (Monday matches internally)

### 3. One-by-One Updates - Prevent Cascading Failures ✅

**Old Way** (all-or-nothing):
```javascript
// ❌ All columns in one mutation
change_multiple_column_values({
  column1: value1,
  column2: invalidValue, // ← This breaks EVERYTHING
  column3: value3
});
// Result: NONE applied
```

**New Way** (resilient):
```javascript
// ✅ Each column separately
for (column, value) {
  try {
    change_multiple_column_values({
      [column]: value  // Only one at a time
    });
    successfulUpdates.push(column);
  } catch (error) {
    failedUpdates.push({ column, error });
    continue; // Keep going!
  }
}
// Result: Some succeed, some fail, but no total loss
```

**Logging**:
```
=== STEP 1: Applying enforced defaults ===
✓ Forcing Status to "Ready for Development"
✓ Forcing Bug/Feature to "Bug"
✓ Forcing Bug Status to "Open"
✅ Enforced defaults applied successfully

=== STEP 2: Applying user-selected values ===
  🔄 Updating column priority: {label: "High"}
  ✅ priority updated
  🔄 Updating column tags: {tag_ids: [123]}
  ✅ tags updated
  🔄 Updating column status_2: {label: "APP"}
  ✅ status_2 updated
✅ Updated 3 columns successfully
```

### 4. Board-Relation (Link to Bug Case) - Skipped for Now ✅

**Problem**: Sending `{"url": "...", "text": "..."}` → "structure invalid" error

**Why**: Board-relation columns expect item IDs, not URLs:
```json
// ❌ Wrong (what we were sending):
{
  "url": "https://example.com",
  "text": "Bug Case"
}

// ✅ Correct (what Monday expects):
{
  "item_ids": [123, 456]  // Item IDs from the linked board
}
```

**Solution**: Skip board-relation columns entirely
```javascript
// Frontend: Don't render board_relation columns
if (col.type === 'board_relation') {
  return false;  // Filtered out
}

// Backend: Skip if board_relation
if (columnMeta.type === 'board_relation') {
  console.log('⏭️ Skipping board_relation (not yet supported)');
  continue;
}
```

**Future**: To support "Link to Bug Case":
- Add item search/selection UI
- Get item IDs from linked board
- Send `{ item_ids: [123] }` format

### 5. Tags Support - Correct Format ✅

**Format sent**:
```json
{
  "tag_ids": [123, 456]  // For existing tags
}
```

**Note**: New tag creation might need additional handling depending on board permissions.

---

## Testing Guide

### Step 1: Create a Bug

1. Fill out bug form
2. Select Pltfrm value (e.g., "APP", "SOW")
3. Add some tags (if Tags column exists)
4. Leave other fields as desired
5. Click "Create & Upload"

### Step 2: Check Console Logs

Look for this output pattern:
```
=== STEP 1: Applying enforced defaults ===
✓ Forcing Status to "Ready for Development"
✓ Forcing Bug/Feature to "Bug"
✓ Forcing Bug Status to "Open"
✅ Enforced defaults applied successfully

=== STEP 2: Applying user-selected values ===
  ⏭️  Skipping status (enforced default)
  🔄 Updating column status_2: {label: "APP"}
  ✅ status_2 updated
  🔄 Updating column tags: {tag_ids: [123]}
  ✅ tags updated
✅ Updated 2 columns successfully
```

### Step 3: Verify in Monday.com

**Enforced Defaults** (MUST be set):
- [ ] Status = "Ready for Development"
- [ ] Bug/Feature = "Bug"
- [ ] Bug Status = "Open"

**User Values** (if provided):
- [ ] Pltfrm = selected value (e.g., "APP")
- [ ] Tags = selected tags
- [ ] Other fields = provided values

### Expected Behavior

**✅ Success Cases**:
- All enforced defaults ALWAYS applied
- Valid user selections applied
- Bug created even if some columns fail
- Clear success/failure logs

**⚠️ Partial Success** (acceptable):
- Enforced defaults ✅
- Some user columns ✅
- Some user columns ❌ (logged)
- Bug still created successfully

**❌ Total Failure** (should not happen):
- Bug not created at all
- No logs in console
- Extension crashed

---

## Troubleshooting

### Enforced Defaults Not Applied

**Check Console for**:
```
✓ Forcing Status to "Ready for Development"
✅ Enforced defaults applied successfully
```

**If missing**:
- Column might not exist on board
- Label "Ready for Development" / "Bug" / "Open" might not exist
- Check available labels in logs

**Solution**: 
1. Verify exact label names in Monday.com
2. Update default values in code if needed
3. Ensure columns exist on board

### Pltfrm Still Showing "Deactivated Label" Error

**Check Console for**:
```
Skipping deactivated label: Old Value (ID: 5)
✓ Found active label: "APP" with ID 0
```

**If error persists**:
- Label might have been deactivated in Monday
- Settings might not have color info
- Frontend might be showing inactive labels

**Solution**: 
1. Reactivate label in Monday.com
2. Refresh extension (reload)
3. Check that only active labels appear in dropdown

### Some Columns Not Updating

**Check Console for**:
```
⚠️ Failed to update 1 columns: [{columnId: "xyz", error: "..."}]
```

**Common Reasons**:
- Invalid format for column type
- Required field not provided
- Column type not supported
- Board permissions

**Solution**: Check error message and:
1. Verify column format is correct
2. Add special handling for that column type
3. Skip column if not essential

---

## API Reference

### Enforced Defaults Mutation

```graphql
mutation {
  change_multiple_column_values(
    board_id: 123,
    item_id: 456,
    column_values: "{
      \"status\": {\"label\": \"Ready for Development\"},
      \"status_1\": {\"label\": \"Bug\"},
      \"status_3\": {\"label\": \"Open\"}
    }"
  ) {
    id
    name
  }
}
```

### Status/Color Column Update

```graphql
mutation {
  change_multiple_column_values(
    board_id: 123,
    item_id: 456,
    column_values: "{
      \"status_2\": {\"label\": \"APP\"}
    }"
  ) {
    id
  }
}
```

**Note**: Monday matches by label TEXT, not index/ID. Text must exactly match an active label.

### Tags Column Update

```graphql
mutation {
  change_multiple_column_values(
    board_id: 123,
    item_id: 456,
    column_values: "{
      \"tags\": {\"tag_ids\": [123, 456]}
    }"
  ) {
    id
  }
}
```

---

## Known Limitations

1. **Board-Relation Columns**: Not supported (requires item IDs)
2. **New Tag Creation**: May require additional permissions
3. **Mirror Columns**: Read-only, cannot be updated
4. **Formula Columns**: Calculated, cannot be set

## Next Steps

If issues persist:
1. Share full console logs (especially STEP 1 and STEP 2 sections)
2. Share Monday.com board structure (column types)
3. Check Monday.com item after creation to see what was actually set
4. Verify board permissions allow column updates

---

**Branch**: `cursor/monday-fields-and-tags-enhancements`  
**Last Updated**: January 4, 2026
