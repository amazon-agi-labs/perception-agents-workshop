# Flow Report: tcap-1

**Flow:** Podcast landing page displays all content sections
**Type:** state_completeness
**URL:** http://localhost:5174
**Status:** PASS

## Scenario: All main sections are visible on the page

| Step | Type | Description | Result |
|------|------|-------------|--------|
| 1 | Given | I am on the podcast landing page | PASS |
| 2 | Then | Header displays "Some Labs" as site name | PASS |
| 3 | And | Navigation shows "Blog", "Careers", "Podcast" links | PASS |
| 4 | And | Hero section displays "Some Podcast" as main heading | PASS |
| 5 | And | Hero badge reads "NEW PODCAST" | PASS |
| 6 | And | 8 episode cards visible | PASS |
| 7 | And | Each episode card has a play button | PASS |
| 8 | And | Streaming section shows YouTube, Spotify, Apple Podcasts, Wherever Podcasts Exist | PASS |
| 9 | And | Footer displays copyright text | PASS |
