# Minimal Tags Test - Deterministic Approach

**Commit**: `685ab31 - Implement minimal deterministic tags flow`  
**Status**: Ready for Testing

---

## 🎯 What This Does

**Minimal, Deterministic Flow**:
1. Verify Tags column metadata (exact ID, type, existing tags)
2. Process tags in isolated update (separate from other columns)
3. Create new tags if needed (via create_or_get_tag)
4. Send minimal payload: `{ "tag_ids": [123, 456] }`

**Key Features**:
- Clear step-by-step logging
- Boxed sections for easy identification
- Tags failure doesn't block bug creation
- Numeric tag IDs only (integers)

---

## 📋 Expected Console Output

### STEP 1: Tags Column Metadata

```
========================================
STEP 1: TAGS COLUMN METADATA
========================================
✅ Tags column found:
   Column ID: tags
   Column Title: Tags
   Column Type: tags
   Existing tags in board:
     • Tag ID: 123 | Name: "setup" | Type: number
     • Tag ID: 456 | Name: "bug" | Type: number
     • Tag ID: 789 | Name: "urgent" | Type: number
========================================
```

**What to Copy**:
- [ ] Column ID (e.g., "tags")
- [ ] Column Type (should be "tags")
- [ ] Existing tag IDs with names

---

### STEP 2: Minimal Tags Update

#### Part A: Processing
```
========================================
STEP 2: MINIMAL TAGS UPDATE
========================================
✅ Tags column exists and user provided tags
   Column ID: tags
   Raw value from frontend: {"tag_ids":[123]}
   Tag IDs from frontend: [123]
   Existing tag IDs: [123]
   New tag names: []

   Final tag IDs to apply: [123]

   Sending tags-only update...
   Board ID: 9876543210
   Item ID: 1234567890
   Column ID: tags
   Tags payload: {"tag_ids":[123]}
```

#### Part B: Monday API Call
```
   ═══════════════════════════════════════
   MONDAY API: change_multiple_column_values
   ═══════════════════════════════════════
   Board ID: 9876543210
   Item ID: 1234567890
   Column values: {
     "tags": {
       "tag_ids": [123]
     }
   }
   Stringified: {"tags":{"tag_ids":[123]}}

   GraphQL Mutation:
   mutation {
     change_multiple_column_values(
       board_id: 9876543210,
       item_id: 1234567890,
       column_values: "{\"tags\":{\"tag_ids\":[123]}}"
     ) {
       id
       name
     }
   }

   📤 Sending to Monday...

   📥 Monday Response:
   {
     "change_multiple_column_values": {
       "id": "1234567890",
       "name": "Bug Title"
     }
   }
   ═══════════════════════════════════════

   ✅ TAGS UPDATE SUCCESS
   Response: {
     "id": "1234567890",
     "name": "Bug Title"
   }

✅ Tags applied to item
========================================
```

**What to Copy**:
- [ ] The GraphQL Mutation (complete mutation block)
- [ ] The Monday Response (what Monday returned)
- [ ] Any error messages if update failed

---

## 🧪 Test Cases

### Test 1: Single Existing Tag (Minimal)

**Setup**: Select ONE existing tag (e.g., "setup")

**Steps**:
1. Create bug
2. Select "setup" tag (ID: 123)
3. Submit

**Expected**:
```
Existing tag IDs: [123]
New tag names: []
Final tag IDs to apply: [123]
Tags payload: {"tag_ids":[123]}
✅ TAGS UPDATE SUCCESS
```

**Check Monday**: Tags column should show "setup"

---

### Test 2: Multiple Existing Tags

**Setup**: Select 2 existing tags

**Steps**:
1. Create bug
2. Select "setup" + "bug"
3. Submit

**Expected**:
```
Existing tag IDs: [123, 456]
New tag names: []
Final tag IDs to apply: [123, 456]
Tags payload: {"tag_ids":[123,456]}
✅ TAGS UPDATE SUCCESS
```

**Check Monday**: Both tags visible

---

### Test 3: One Existing + One New

**Setup**: Select existing + type new tag

**Steps**:
1. Create bug
2. Select "setup" (existing)
3. Type "TestTag" (new)
4. Submit

**Expected**:
```
Existing tag IDs: [123]
New tag names: ["TestTag"]

Creating new tags...
  • Creating tag: "TestTag"
    ✅ Created with ID: 999

Final tag IDs to apply: [123, 999]
Tags payload: {"tag_ids":[123,999]}
✅ TAGS UPDATE SUCCESS
```

**Check Monday**: Both tags visible, "TestTag" added to board

---

## 📊 What to Share

**For Complete Debugging**:

### 1. Step 1 Output
```
========================================
STEP 1: TAGS COLUMN METADATA
========================================
✅ Tags column found:
   Column ID: ?
   Column Title: ?
   Column Type: ?
   Existing tags:
     • Tag ID: ? | Name: "?" | Type: ?
```

### 2. Step 2 - GraphQL Mutation
```
mutation {
  change_multiple_column_values(
    board_id: ?,
    item_id: ?,
    column_values: "?"
  ) {
    id
    name
  }
}
```

### 3. Step 2 - Monday Response
```
{
  "change_multiple_column_values": {
    ...
  }
}
```

### 4. Monday Board Check
- Screenshot of Tags column
- Or describe what you see

---

## 🎯 Diagnosis

### ✅ Success: Tags Appear

**Console**: `✅ TAGS UPDATE SUCCESS`  
**Monday**: Tags visible in column

**Meaning**: Everything working! 🎉

---

### ⚠️ Success But No Tags

**Console**: `✅ TAGS UPDATE SUCCESS`  
**Monday**: Tags column empty

**Possible Causes**:

**A) Wrong Column ID**
```
STEP 1 shows: Column ID: tags_xyz
STEP 2 uses: Column ID: tags
```
→ Mismatch! Using wrong ID

**B) Wrong Tag IDs**
```
Tags payload: {"tag_ids":[999]}
But tag 999 doesn't exist in board
```
→ Use IDs from STEP 1 existing tags

**C) Monday Silent Rejection**
- Payload format not accepted
- Need to try alternative format

---

### ❌ Update Failed

**Console**: `❌ TAGS UPDATE FAILED`

**Check Error Message**:

**"Column not found"**
→ Wrong column ID, check STEP 1

**"Invalid column value"**  
→ Payload format wrong, try alternative

**"Permission denied"**
→ API token lacks permissions

---

## 🔧 Troubleshooting

### If Column ID Different

**STEP 1**: `Column ID: tags_123456`  
**Action**: This is the correct ID to use

### If Column Type Wrong

**STEP 1**: `Column Type: text`  
**Problem**: Not a tags column!  
**Action**: Create actual Tags column in Monday

### If No Existing Tags

**STEP 1**: `No existing tags found`  
**Action**: Can only test with new tags (create_or_get_tag)

### If Payload Rejected

**Try Alternative Formats**:
```javascript
// Format 1: Current (numeric array)
{ "tag_ids": [123, 456] }

// Format 2: String array
{ "tag_ids": ["123", "456"] }

// Format 3: Just array
[123, 456]

// Format 4: Comma-separated
"123,456"
```

We'll adjust based on what Monday accepts.

---

## 🚀 What's Different

**vs Previous Attempts**:
1. ✅ Clearer section headers (boxed)
2. ✅ Numeric validation (regex check)
3. ✅ Minimal payload (no extra fields)
4. ✅ Indented Monday API logs
5. ✅ Easy to copy mutation/response
6. ✅ Clear success/failure messages

**Benefits**:
- Easy to identify each step
- Easy to copy relevant logs
- Easy to see what's being sent
- Easy to see Monday's response

---

## ✅ Testing Checklist

**Before Testing**:
- [ ] Extension reloaded
- [ ] Service worker active
- [ ] Monday boards loading

**During Test**:
- [ ] Create bug with tags
- [ ] Copy STEP 1 output
- [ ] Copy STEP 2 mutation
- [ ] Copy STEP 2 response

**After Test**:
- [ ] Check Monday board
- [ ] Verify tags visible
- [ ] Share all logs

---

## 📝 Key Points

**What We're Verifying**:
1. Column ID is correct (STEP 1)
2. Mutation is sent correctly (STEP 2)
3. Monday accepts it (response)
4. Tags appear in board (visual check)

**If ANY of these fail**, logs will show exactly where!

---

**Ready for testing!** 🧪

This minimal approach will pinpoint the exact issue with tags. Please test and share all the requested sections above.
