# Flow Report: tcap-2

**Flow:** Page scrolls to reveal all episodes and streaming links
**Type:** happy_path
**URL:** http://localhost:5174
**Status:** PASS

## Scenario: User scrolls through the full podcast page

| Step | Type | Description | Result |
|------|------|-------------|--------|
| 1 | Given | I am on the podcast landing page | PASS |
| 2 | When | I scroll down to the bottom of the page | PASS |
| 3 | Then | Streaming section heading "Listen Wherever You Pretend to Pay Attention" is visible | PASS |
| 4 | And | Footer with copyright "2026 Some Labs" is visible | PASS |
