# Flow Report: tcap-3

**Flow:** Episode cards display correct structure
**Type:** state_completeness
**URL:** http://localhost:5174
**Status:** PASS

## Scenario: First episode card has all expected elements

| Step | Type | Description | Result |
|------|------|-------------|--------|
| 1 | Given | I am on the podcast landing page | PASS |
| 2 | Then | First episode shows number "1" in badge | PASS |
| 3 | And | First episode title is "What Even Is Intelligence? (Asking for a Friend's Neural Network)" | PASS |
| 4 | And | First episode has blockquote "If my toaster could pass a Turing test, would I still be allowed to unplug it?" | PASS |
| 5 | And | First episode shows "Featuring: Dr. Sarah Chen, Cognitive Systems Research" | PASS |
| 6 | And | First episode player displays duration "42 min" | PASS |
