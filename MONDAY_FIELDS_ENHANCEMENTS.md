# Monday Fields & Tags Enhancements

**Branch**: `cursor/monday-fields-and-tags-enhancements`  
**Date**: January 4, 2026

## Summary

This update implements significant improvements to the Monday.com integration in the Anti Bugs extension, focusing on field management, automatic defaults, and tags support.

## Changes Implemented

### 1. Removed Fields from UI

The following fields have been completely removed from the bug creation interface:

- **Internal Status**
- **Estimated SP**
- **Estimated QA**
- **Environment** (also removed from HTML form)
- **Actual SP**
- **Link to PR**
- **Custom AI prompt**
- **QA Item Created**

These fields will not appear in the tool and will not be sent in the GraphQL payload.

### 2. Forced Default Values

The following fields are now automatically set when creating bugs (not shown or configurable in UI):

| Field | Default Value |
|-------|--------------|
| Status | Ready for Development |
| Bug/Feature | Bug |
| Bug Status | Open |

**Implementation Details**:
- Default values are resolved dynamically by fetching board columns
- Column IDs are matched by title
- Defaults are merged with user-provided values (defaults take precedence)
- Applied programmatically in `background.js` before updating column values

### 3. Tags Column Support

Added comprehensive support for Monday.com Tags columns:

**Features**:
- ✅ Display existing tags from the selected board/group
- ✅ Multi-select tags (select one or more)
- ✅ Create new tags on the fly (not limited to predefined tags)
- ✅ Visual tag chips with remove buttons
- ✅ Search/filter existing tags
- ✅ Dropdown panel with checkboxes for existing tags
- ✅ "+ Create new" option when typing new tag name

**UI Components**:
- `tag-input-container`: Main container with click-to-open dropdown
- `selected-tags`: Display area showing selected tag chips
- `tag-dropdown-panel`: Dropdown with search input and tags list
- `tag-search-input`: Real-time search/filter input
- `tag-option`: Individual tag options with checkboxes

**Technical Implementation**:
- Column type: `tag`
- Format sent to Monday: `{ tag_ids: [123, 456], post_tags: ["Tag1", "Tag2"] }`
- Supports both existing tag IDs and new tag names
- Dynamic rendering based on column settings

### 4. Link to Bug Case Field

Added support for the "Link to Bug Case" column:

- Automatically included if present in the board (detected as `text` or `link` column type)
- User can optionally provide or edit its value
- If left empty, remains unchanged in Monday
- Standard text/link input field in the UI

## Files Modified

### `create-bug.html`
- Removed Environment field from form

### `scripts/create-bug.js`
- Updated `renderMondayFields()` to filter excluded columns
- Removed `env` field from bug data collection
- Added `createTagInput()` function for tag column support
- Updated `collectColumnValues()` to handle tag inputs
- Updated `formatColumnValue()` to format tag data correctly
- Added tag chip display and management logic

### `styles/create-bug.css`
- Added comprehensive styles for tag input component
- Tag chips, dropdown panel, search input
- Tag options with checkboxes and hover states
- Responsive and accessible design

### `background.js`
- Fetch board columns to find default value column IDs
- Build forced defaults object for Status, Bug/Feature, Bug Status
- Merge defaults with user column values
- Apply combined values when creating bug item

### `modules/monday-api.js`
- Removed `env` field from `addBugDetailsUpdate()`
- Removed `env` field from `buildColumnValues()`

## API Integration

### Tag Column Format

```json
{
  "tag_ids": [123, 456],
  "post_tags": ["New Tag", "Another Tag"]
}
```

- `tag_ids`: Array of existing tag IDs (integers)
- `post_tags`: Array of tag names (includes both existing and new tags)

### Forced Defaults Format

```json
{
  "status_column_id": { "label": "Ready for Development" },
  "bug_feature_column_id": { "label": "Bug" },
  "bug_status_column_id": { "label": "Open" }
}
```

## Testing Checklist

- [ ] Verify Environment field is removed from UI
- [ ] Verify excluded columns don't appear in Monday Fields section
- [ ] Verify Status defaults to "Ready for Development"
- [ ] Verify Bug/Feature defaults to "Bug"
- [ ] Verify Bug Status defaults to "Open"
- [ ] Test selecting existing tags
- [ ] Test creating new tags
- [ ] Test multi-selecting tags
- [ ] Test removing selected tags
- [ ] Test searching/filtering tags
- [ ] Test Link to Bug Case field (if present in board)
- [ ] Verify bug creation completes successfully
- [ ] Verify all fields are correctly set in Monday.com

## Deployment

Branch has been pushed to: `cursor/monday-fields-and-tags-enhancements`

**Next Steps**:
1. Review the implementation
2. Test in development environment
3. Iterate based on feedback
4. Merge to main when approved

## Notes

- All changes apply only to the new bug creation flow
- Fields removed are not sent at all in the GraphQL payload
- Defaults are enforced programmatically to avoid user error
- Column IDs are resolved dynamically per board/group
- Tag support works with Monday.com's native tag column type
- Link to Bug Case field is automatically supported as a text/link field type

---

**Commit**: `6433a4b - Implement Monday fields and tags enhancements`
