# Tags Sanity Test Guide

**Purpose**: Verify the tags update pipeline is working end-to-end  
**Commit**: `52d65fb - Add sanity test for tags column`

---

## 🧪 What This Test Does

**Simplified Approach**:
- Sends a plain string `"test-tag-rrr"` to the tags column
- NOT the final tags format (tag_ids)
- Just to verify the pipeline works

**What We're Testing**:
1. ✅ Is the correct column ID targeted?
2. ✅ Does the update call include the tags column?
3. ✅ Does Monday receive the request?
4. ✅ Does Monday accept or reject the value?

---

## 📋 How to Test

### Step 1: Create a Bug with Tags

1. Open the extension
2. Create a new bug
3. **Select or type ANY tag** (it doesn't matter which)
4. Submit the bug

### Step 2: Check Console Logs

Look for these specific sections:

---

## 🔍 Expected Console Output

### Section 1: Sanity Test Start
```
🧪 ========== SANITY TEST MODE ==========
🧪 Sending PLAIN STRING to verify pipeline
🧪 This is NOT the final tags format
🧪 =======================================

🧪 Test payload (plain string): "test-tag-rrr"
🧪 Column ID: tags (or tags_XXX)
🧪 Item ID: 1234567890
🧪 Board ID: 9876543210

🧪 Sending update with:
🧪 {
🧪   "tags": "test-tag-rrr"
🧪 }
```

**What to Check**:
- [ ] Column ID looks correct (should be "tags" or similar)
- [ ] Item ID is a number
- [ ] Board ID is a number

---

### Section 2: Monday API Update
```
🔧 ========== Monday API Update ==========
🔧 Board ID: 9876543210
🔧 Item ID: 1234567890
🔧 Column values object:
{
  "tags": "test-tag-rrr"
}
🔧 ========================================

🔧 Stringified for Monday: {"tags":"test-tag-rrr"}
```

**What to Check**:
- [ ] Column values object contains tags column
- [ ] Value is the plain string "test-tag-rrr"

---

### Section 3: GraphQL Mutation
```
🔧 ========== GraphQL Mutation ==========
mutation {
  change_multiple_column_values(
    board_id: 9876543210,
    item_id: 1234567890,
    column_values: "{\"tags\":\"test-tag-rrr\"}"
  ) {
    id
    name
  }
}
🔧 ========================================
```

**What to Check**:
- [ ] board_id is correct
- [ ] item_id is correct  
- [ ] column_values includes `"tags":"test-tag-rrr"`

**⭐ COPY THIS ENTIRE MUTATION** - we need to see it!

---

### Section 4: Monday Response

**Case A: Success**
```
🔧 ========== Monday Response ==========
🔧 Response data: {
  "change_multiple_column_values": {
    "id": "1234567890",
    "name": "Bug Title"
  }
}
🔧 ========================================

🧪 ========== UPDATE RESULT ==========
🧪 Success! Update returned: { id: "...", name: "..." }
🧪 ====================================

✅ tags (tags) SANITY TEST completed
```

**This means**: 
- ✅ Column ID is correct
- ✅ Update call works
- ✅ Monday accepted the request
- ❓ Need to check if value was actually saved (check Monday board)

**Case B: Failure**
```
🧪 ========== UPDATE FAILED ==========
🧪 Error: [error message here]
🧪 Full error: [full error object]
🧪 ====================================
```

**This means**:
- ❌ Something is wrong with the request
- Check the error message for clues

---

## 📊 What to Share

**Please copy and share**:

1. **The GraphQL Mutation** (Section 3)
```
mutation {
  change_multiple_column_values(...)
}
```

2. **The Monday Response** (Section 4)
```
{
  "change_multiple_column_values": {...}
}
```

3. **Any Error Messages**

4. **Monday Board Check**:
   - Go to the created item in Monday
   - Check the Tags column
   - Screenshot or describe what you see

---

## 🎯 Possible Outcomes

### Outcome 1: Success + Value Saved ✅✅
**Console**: Success message  
**Monday**: "test-tag-rrr" appears in tags column (or column is populated)

**Diagnosis**: Pipeline works! Issue was with tag_ids format.  
**Next Step**: Implement proper tag_ids structure.

---

### Outcome 2: Success + No Value ✅❌
**Console**: Success message  
**Monday**: Tags column is empty

**Diagnosis**: Monday accepted request but rejected value (wrong format)  
**Meaning**: 
- Column ID is correct ✅
- Update call works ✅
- But Monday doesn't accept plain string for tags
- Need proper tag_ids format

**This is actually GOOD** - confirms pipeline works!

---

### Outcome 3: Error in Console ❌
**Console**: Error message  
**Monday**: N/A

**Possible Errors**:

**Error A**: "Column not found"
- Wrong column ID
- Column doesn't exist
- Need to check board columns

**Error B**: "Invalid column value"
- Column exists but value format wrong
- Expected behavior (we sent plain string)

**Error C**: "Permission denied"
- API token lacks permissions
- Need to check token permissions

---

### Outcome 4: No Tags Section in Logs ⚠️
**Console**: No "SANITY TEST MODE" section  
**Meaning**: Tags column not being processed at all

**Check**:
- Is tags column present in board?
- Is tags column detected in Step 2 logs?
- Look for: "📌 Tags column detected"

---

## 🔧 Troubleshooting

### If No Sanity Test Logs

**Check for**:
```
=== STEP 2: Applying user-selected values ===
  🔄 Updating column tags: ...
  📌 Tags column detected
```

**If missing**:
- Tags might not be in columnValues
- Tags column might not be detected
- Check earlier logs for column detection

**If present but no sanity test**:
- The if condition might not match
- Check column type in logs

---

### If Column ID Looks Wrong

**Example**: Column ID is "text_123" instead of "tags"

**This means**: We're updating the wrong column!

**Fix**: Need to verify column type detection in frontend

---

### If Monday Returns Error

**Share the exact error message**, it will tell us:
- Wrong column ID?
- Wrong value format?
- Permission issue?
- Column type mismatch?

---

## 🎯 What We Learn

### If Test Succeeds:
✅ Column ID is correct  
✅ Update pipeline works  
✅ Monday receives the request  
→ Issue is with tag value format (need tag_ids)

### If Test Fails:
❌ Something fundamental is wrong  
→ Check column ID, column type, permissions  
→ Fix pipeline before working on tag_ids format

---

## 📝 After Testing

**If pipeline works**:
1. Revert sanity test
2. Implement proper tag_ids format
3. Test with real tag structure

**If pipeline broken**:
1. Fix the identified issue
2. Re-run sanity test
3. Then implement tag_ids format

---

## 🚀 Next Steps

**After you share the logs**, we can:

1. **If success**: Implement proper `{ tag_ids: ["123", "456"] }` format
2. **If column wrong**: Fix column ID detection
3. **If error**: Address the specific error
4. **If no logs**: Debug why tags aren't being processed

---

**Ready for testing!** 🧪

Please run the test and share:
1. Full console output (especially the 🧪 sections)
2. GraphQL mutation
3. Monday response
4. What you see in Monday tags column

This will tell us exactly what's happening! 🎯
