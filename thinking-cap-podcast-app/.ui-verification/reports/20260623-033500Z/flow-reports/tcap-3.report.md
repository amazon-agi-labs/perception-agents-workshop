# Flow Report: tcap-3

**Flow:** tcap-3 — Episode cards display correct structure  
**Type:** state_completeness  
**URL:** http://localhost:5173  
**Status:** PASS  
**Run date:** 2026-06-23T03:36:00Z

---

## Scenario: First episode card has all expected elements

| Step | Type | Assertion | Result |
|------|------|-----------|--------|
| Episode shows number "1" in badge | Then | number_badge | PASS |
| Title is correct | And | title_correct | PASS |
| Blockquote text matches | And | blockquote_correct | PASS |
| Guest line "Featuring: Dr. Sarah Chen..." | And | guest_correct | PASS |
| Player duration "42 min" | And | duration_correct | PASS |

**All 5 assertions passed.**

---

## Screenshot

![First episode card](../screenshots/tcap-3-episode1.png)
