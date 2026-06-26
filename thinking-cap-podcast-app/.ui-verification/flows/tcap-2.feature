# flow: tcap-2
# type: happy_path
# app: http://localhost:5173

Feature: Page scrolls to reveal all episodes and streaming links

  Scenario: User scrolls through the full podcast page
    Given I am on the podcast landing page at "http://localhost:5173"
    When I scroll down to the bottom of the page
    Then the streaming section heading "Listen Wherever You Pretend to Pay Attention" should be visible
    And the footer with copyright "2026 Probably Sentient Labs" should be visible
