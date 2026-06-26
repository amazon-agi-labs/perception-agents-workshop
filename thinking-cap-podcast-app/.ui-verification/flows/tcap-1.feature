# flow: tcap-1
# type: state_completeness
# app: http://localhost:5173

Feature: Podcast landing page displays all content sections

  Scenario: All main sections are visible on the page
    Given I am on the podcast landing page at "http://localhost:5173"
    Then the header should display "Probably Sentient Labs" as the site name
    And the navigation should show "Blog", "Careers", and "Podcast" links
    And the hero section should display "The Thinking Cap Podcast" as the main heading
    And the hero badge should read "NEW PODCAST"
    And 8 episode cards should be visible
    And each episode card should have a play button
    And the streaming section should show links for "YouTube", "Spotify", "Apple Podcasts", and "Wherever Podcasts Exist"
    And the footer should display the copyright text
