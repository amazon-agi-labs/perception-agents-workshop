# flow: tcap-3
# type: state_completeness
# app: http://localhost:5173

Feature: Episode cards display correct structure

  Scenario: First episode card has all expected elements
    Given I am on the podcast landing page at "http://localhost:5173"
    Then the first episode should show number "1" in a badge
    And the first episode title should be "What Even Is Intelligence? (Asking for a Friend's Neural Network)"
    And the first episode should have a blockquote with the text "If my toaster could pass a Turing test, would I still be allowed to unplug it?"
    And the first episode should show "Featuring: Dr. Sarah Chen, Cognitive Systems Research"
    And the first episode player should display duration "42 min"
