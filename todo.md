# Hire.AI V2 - Project TODO

> Historical implementation checklist. Checked items are not release certification; current controls, gaps, and operational gates are documented in `CURRENT_STATUS.md` and `docs/GOAL_COMPLETION_MATRIX.md`.

## Phase 1: Database Schema & Core Structure
- [x] Design and implement job listings table schema
- [x] Design and implement user profiles table with skills and preferences
- [x] Design and implement applications tracking table
- [x] Design and implement job platforms configuration table
- [x] Design and implement job deduplication tracking table
- [x] Design and implement decision makers table
- [x] Design and implement user resume/CV storage table
- [x] Design and implement social media profiles table
- [x] Push database schema migrations

## Phase 2: Landing Page & Dashboard UI
- [x] Create attractive landing page with clear service explanation
- [x] Implement "Get Started" button flow
- [x] Design dashboard with health monitoring metaphor (vital signs, health metrics)
- [x] Create job search health indicators (application rate, response rate, interview rate)
- [x] Build user profile setup page
- [x] Implement resume/CV upload functionality
- [x] Create social media profile connection interface
- [x] Design skills and preferences configuration page

## Phase 3: Job Aggregation System (50+ Platforms)
- [x] Implement job platform configuration system
- [x] Add Tier 1 platforms (FlexJobs, We Work Remotely, Remote.co, RemoteOK, Indeed, LinkedIn)
- [x] Add Tier 2 platforms (Remotive, JustRemote, Jobspresso, Working Nomads, NoDesk, etc.)
- [x] Add Tier 3 industry-specific platforms (Arc, Gun.io, Stack Overflow, Behance, Dribbble, etc.)
- [x] Add Tier 4 niche platforms (Remote100K, Jobgether, Contra, etc.)
- [x] Implement job data normalization system
- [x] Build job deduplication algorithm (TF-IDF, cosine similarity)
- [ ] Create job format variation handler
- [x] Implement real-time job discovery system
- [ ] Add social media integration (Facebook Pages/Groups, Twitter)
- [ ] Build job scraping scheduler
- [ ] Implement error handling and retry mechanisms

## Phase 4: AI Matching & Controlled Application Handoff
- [x] Implement AI-powered job matching algorithm
- [x] Build user skill extraction from resume
- [x] Create job requirements analysis system
- [x] Implement job-candidate scoring system
- [x] Build application process detection (Greenhouse, Lever, Workday, Taleo, etc.)
- [x] Create approval-gated application preparation and manual submission handoff
- [x] Implement decision maker identification feature
- [x] Build application tracking system
- [x] Create application status monitoring
- [x] Implement automated follow-up system
- [x] Add application notes feature
- [x] Add interview scheduling feature
- [x] Add job alerts feature
- [x] Add mock interview simulator
- [x] Add video interview tips

## Phase 5: Advanced Features (From Requirements)
- [x] AI-Powered Interview Preparation
  - [x] Analyze job descriptions for interview questions

## Phase 9: Testing
- [x] Comprehensive test suite (63 tests passing)

## Phase 10: Documentation
- [x] User Guide (comprehensive 500+ line guide)
- [x] API Reference (complete tRPC endpoint documentation)
- [x] Platform list (PLATFORMS.md with 50 platforms)
- [x] Status report (STATUS_REPORT.md)
- [x] Master TODO list (MASTER_TODO.md)
- [x] Platform tests
- [x] Scraping infrastructure tests
- [x] Job normalization tests
- [x] Real-time discovery tests
- [x] Resume management tests
- [x] Job alerts tests
- [x] Interview preparation tests
- [x] Career intelligence tests
- [x] D&I support tests
- [x] Application automation tests
- [x] Application features tests
- [x] Jobs router tests
- [x] Profile router tests
- [x] Matching router tests
- [x] AI router tests
- [x] Decision makers router tests
- [x] Social connections tests
- [x] Auth tests
- [x] Scheduler tests
  - [ ] Generate company-specific interview questions
  - [ ] Provide personalized interview coaching
- [ ] Salary Negotiation Assistant
  - [ ] Collect and analyze salary data
  - [ ] Provide negotiation scripts
  - [ ] Suggest optimal timing for discussions
- [ ] Company Culture Analysis
  - [ ] Analyze company reviews and social media
  - [ ] Match company values with user preferences
  - [ ] Provide team dynamics insights
- [ ] Automated Follow-up System
  - [ ] Generate personalized follow-up messages
  - [ ] Analyze response patterns
  - [ ] Maintain engagement with hiring managers
- [ ] Networking Intelligence
  - [ ] Identify connections at target companies
  - [ ] Suggest networking approaches
  - [ ] Provide conversation starters
- [ ] Continuous Learning Integration
  - [ ] Recommend courses based on skill gaps
  - [ ] Track skill development progress
  - [ ] Provide learning roadmaps
- [ ] Visa and Relocation Support
  - [ ] Identify jobs with visa sponsorship
  - [ ] Provide relocation information
  - [ ] Offer cost of living comparisons
- [ ] Enhanced D&I Insights
  - [ ] Support for people with disabilities
  - [ ] Opportunities for those with criminal records
  - [ ] Resources for ex-drug addicts
  - [ ] Protection against age and racial discrimination
  - [ ] Filters for "Open Hiring" companies
  - [ ] Support for long-term unemployed
  - [ ] Support for veterans transitioning to civilian work
  - [ ] Support for refugees and asylum seekers
  - [ ] Support for single parents returning to work
  - [ ] Support for individuals experiencing homelessness
  - [ ] Support for people with mental health conditions
  - [ ] Support for economically disadvantaged backgrounds
  - [ ] Support for those with employment gaps
  - [ ] Support for neurodivergent individuals
  - [ ] Support for individuals without formal education

## Phase 6: Testing & Refinement
- [ ] Write unit tests for job aggregation
- [ ] Write unit tests for deduplication algorithm
- [ ] Write unit tests for AI matching
- [ ] Write unit tests for automated application
- [ ] Test all 50+ platform integrations
- [ ] Test job format variations handling
- [ ] Test real-time discovery performance
- [ ] Test application submission flows
- [ ] Conduct end-to-end user testing

## Phase 7: Documentation & Deployment
- [ ] Document all 50 remote job platforms
- [ ] Create user guide for platform usage
- [ ] Document API endpoints
- [ ] Create admin documentation
- [ ] Prepare deployment configuration
- [ ] Set up monitoring and alerting
- [ ] Create backup and recovery procedures

## Future Features (Documented for Later)
- [ ] Career Progression Planning
  - [ ] Map potential career paths
  - [ ] Recommend skill development opportunities
  - [ ] Provide timeline estimates for advancement
  - [ ] Integrate learning resources
  - [ ] Offer mentorship recommendations
  - [ ] Track progress toward career goals

---

**Project Status**: In Development
**Current Focus**: Database schema and core structure
**Next Milestone**: Complete Phase 1 and move to UI development


## Phase 6: Resume Upload & Parsing
- [x] Add file upload component to Profile page
- [x] Implement S3 storage for resume files
- [x] Create AI-powered resume parser using LLM
- [x] Extract skills, experience, education from resume
- [x] Auto-populate user profile from parsed resume data
- [x] Support PDF and DOCX formats
- [x] Add resume preview functionality

## Phase 7: Job Scraping Infrastructure
- [x] Design scraper architecture (base scraper class)
- [x] Implement rate limiting and retry logic
- [x] Create job deduplication algorithm
- [x] Build Tier 1 platform scrapers (6/6 platforms - RemoteOK, We Work Remotely, FlexJobs, Indeed, LinkedIn, Remote.co)
- [x] Build Tier 2 platform scrapers (9/9 platforms - Remotive, JustRemote, Jobspresso, Working Nomads, NoDesk, Pangian, Virtual Vocations, Skip The Drive)
- [x] Build Tier 3 platform scrapers (10/10 platforms - Arc, Gun.io, Stack Overflow, Behance, Dribbble, Creativepool, ProBlogger, Built In, Crossover, Wellfound)
- [x] Build Tier 4 platform scrapers (25/25 platforms - All niche platforms implemented with GenericScraper)
- [x] Implement scraping scheduler (daily/hourly)
- [x] Add scraping status monitoring
- [x] Create error logging and alerting

## Phase 8: Controlled Application Handoff
- [x] Detect ATS system type (Greenhouse, Lever, Workday, Taleo)
- [x] Prepare application material in the internal operating ledger
- [x] Require explicit approval before a manual employer-portal handoff
- [x] Require deterministic confirmation evidence before recording submission
- [x] Keep CAPTCHA, login, and final submission on the employer portal
- [x] Keep follow-up delivery behind explicit approval and manual confirmation
- [x] Enforce preparation limits without evasion or proxy rotation


## Phase 11: End User Testing Fixes (23 Issues)

### Critical Issues
- [x] Fix landing page copy - change to captivating "Jobs Find You" messaging
- [x] Seed database with sample jobs so users see actual content (20 jobs added)
- [x] Fix empty applications page with helpful guidance
- [x] Fix dashboard to show real data instead of hardcoded fake stats
- [x] Fix sidebar navigation - shows "Page 1, Page 2" instead of proper nav

### High Priority Issues
- [x] Update profile page file upload label (supports PDF/DOCX now)
- [x] Fix profile placeholder data - show empty or load real user data
- [x] Add Save button to profile page
- [x] Fix landing page navigation for logged-in users
- [x] Create Settings page for preferences
### Medium Priority Issues

- [x] Add onboarding flow for new users (in Dashboard)
- [x] Add helpful empty states with CTAs
- [x] Fix Quick Actions buttons on dashboard
- [x] Add job scanning trigger button in UI
- [x] Add job alerts configuration UI
- [x] Add saved jobs feature in UI

### Lower Priority / Polish
- [x] Standardize page layouts across authenticated pages (DashboardLayout)
- [ ] Add dark/light mode toggle
- [ ] Add user avatar/profile picture upload
- [x] Add logout button in UI (sidebar footer + header dropdown)
- [ ] Test and fix mobile responsiveness
- [x] Add error handling UI with toast notifications (sonner toasts)
- [ ] Fix "Learn More" button on landing page


## Phase 12: Landing Page Visual Edits
- [x] Make headline smaller to fit on one line with quicker, more captivating statement ("Apply to 100 Jobs While You Sleep.")
- [x] Remove "AI-Powered Job Hunting" badge
- [x] Replace "Job Search Vitals" card with Live Activity Feed showing real-time user activity
- [x] Add real testimonials with actual user names (Marcus Johnson, Sarah Kim, David Chen) and face icons
- [x] Move Testimonials section above "How It Works"
- [x] Merge Platform Tiers into "How It Works" step 2 with inline platform tags
- [x] Remove meaningless stats section


## Phase 13: Social Mission & Landing Page Refinements
- [x] Add social mission statement (reducing worldwide unemployment)
- [x] Tie Live Activity Feed to real-time data from actual user activity
- [x] Remove redundant features section
- [x] Add "Job hunting done right." tagline


## Phase 14: Live Impact Counter
- [x] Add live impact counter showing total jobs applied, interviews scheduled, and offers received


## Phase 15: Remove Social Mission Section
- [x] Remove entire Social Mission section from landing page


## Phase 16: Update Headline
- [x] Change headline from "Apply to 100 Jobs While You Sleep." to "Unemployment no more"


## Phase 17: Animated Live Activity Feed
- [x] Make Live Activity feed animated with scrolling items that move up
- [x] Add new activity items appearing at the top and pushing others down
- [x] Show real-time system activity for users (12 different activities cycling)


## Phase 18: Landing Page Enhancements (Jan 8, 2026)
- [x] Add mobile hamburger menu to header navigation
- [x] Update hero subtext to focus on impact (align with "Unemployment no more")
- [x] Add FAQ section with trust-building questions about automated applications


## Phase 19: Remove Offer Tracking (Jan 8, 2026)
- [x] Remove Offer Rate from Dashboard vital signs (user responsible for acing interviews)
- [x] Remove "Received offer from..." entries from Live Activity feed on landing page
- [x] Move Quick Actions to top of Dashboard (like a navigation menu)


## Phase 20: Consolidate to AI-First UX (Jan 8, 2026)
- [x] Create shared AppHeader component for consistent navigation
- [x] Update database schema for work_experiences and education tables
- [x] Add profile API endpoints for structured data (work experience, education, skills, projects)
- [x] Redesign Profile page with connect buttons (LinkedIn, GitHub, Resume) and structured sections
- [x] Redesign Job Alerts → AI Preferences (AI config + activity log + accountability metrics)
- [x] Remove Jobs page entirely (consolidate into AI Preferences)
- [x] Update all navigation to remove Jobs link
- [x] Update remaining pages to use shared header (remove DashboardLayout)


## Phase 21: Dashboard Quick Actions Redesign (Jan 8, 2026)
- [x] Redesign Quick Actions to match header navigation style (cleaner, more cohesive)
- [x] Make action buttons look like primary navigation extensions


## Phase 22: Settings Dropdown & Navigation Streamline (Jan 8, 2026)
- [x] Remove duplicate Add buttons from Profile page empty states (keep only header buttons)
- [x] Add social media & portfolio links section (LinkedIn URL, GitHub URL, Portfolio URL, Twitter)
- [x] Convert blue N icon to settings dropdown menu (Profile, AI Preferences, Settings, Logout)
- [x] Remove Profile and AI Preferences from main navigation (keep only Dashboard, Applications)
- [x] Remove Quick Actions section from Dashboard (redundant with dropdown menu)


## Phase 23: Fix Navigation & Remove Useless Metrics (Jan 8, 2026)
- [x] Fix AppHeader - AI Preferences and Profile still showing in main nav (should only be in dropdown)
- [x] Remove Job Search Health metric from Dashboard (useless for automated workflow)


## Phase 24: Consolidate Applications into Dashboard (Jan 8, 2026)
- [x] Integrate Applications list into Dashboard page (Dashboard should show metrics + application data in one view)
- [x] Remove Applications from main navigation (only Dashboard should remain)
- [x] Update AppHeader to remove Applications link
- [x] Clean up routes - remove separate Applications page


## Phase 25: Fix Applications Button Still Showing (Jan 8, 2026)
- [x] Investigate why Applications button still appears in Dashboard header despite AppHeader changes
- [x] Remove Applications button from Dashboard page header completely
- [x] Verify only Dashboard button remains in main navigation


## Phase 26: Clean Up Broken Routes and Browse Jobs Button (Jan 8, 2026)
- [x] Remove "Browse Jobs" button from Recent Activity empty state in Dashboard
- [x] Search for all references to /jobs and /applications routes
- [x] Fix all broken route references to point to /dashboard or /profile
- [x] Update CTAs to direct users to complete profile instead of browsing jobs


## Phase 27: Remove How It Works and FAQ from Landing Page
- [x] Remove "How It Works" link from landing page header navigation
- [x] Remove "FAQ" link from landing page header navigationation
- [ ] Dashboard button should trigger login for unauthenticated users

## Phase 29: Hybrid Success Fee System

### Business Model
- Free to use the platform
- 5% of monthly salary, ongoing while employed at job landed via Hire.AI
- Minimum salary threshold: $300/month
- Enforcement: legal action for non-compliance

### Bug Fixes (pre-existing)
- [x] Fix TypeScript error in Applications.tsx (currentPage type mismatch)
- [x] Fix JSX syntax error in SavedJobs.tsx (missing closing tag line 244)

### Database Schema
- [x] Add success_fees table (userId, applicationId, employerName, jobTitle, monthlySalary, currency, feePercent, stripeSubscriptionId, status, startDate, endDate)
- [x] Add employment_verifications table (id, successFeeId, userId, type [initial|quarterly], documentUrl, verifiedAt, status, notes)
- [x] Add stripe_customer_id to users table

### Server Procedures
- [x] Create successFees tRPC router
- [x] reportHire procedure: create success fee record, upload offer letter, create Stripe subscription
- [x] getMyFees procedure: list user's active/past success fees
- [x] submitVerification procedure: upload quarterly verification document
- [x] Stripe webhook: handle subscription payment success/failure
- [x] Admin: listAllFees, updateFeeStatus, flagNonCompliant

### Report Hire UI
- [x] "I Got Hired!" button/flow accessible from Dashboard
- [x] Form: employer name, job title, monthly salary, start date
- [x] Offer letter upload (required - PDF/image)
- [x] Terms acceptance checkbox
- [x] Stripe subscription setup (5% of salary as monthly charge)
- [x] Confirmation page with fee breakdown

### Billing Dashboard
- [x] /billing page showing active fees, payment history, verification status
- [x] Next verification due date with countdown
- [x] Upload quarterly verification documents
- [x] Payment history with amounts and dates
- [x] Account suspension warning if verification overdue

### Verification & Compliance
- [x] Quarterly verification reminders (notification)
- [x] Grace period: 14 days to submit verification after due date
- [x] Account suspension after grace period expires


## Phase 30: CTA Fix, Admin Panel & Terms of Service

### Fix See How It Works CTA
- [x] Update "See How It Works" button on landing page hero to scroll to testimonials or sign-in flow
- [x] Remove or repurpose scrollToFeatures/scrollToFaq references that no longer exist

### Admin Panel
- [x] Create /admin route protected by admin role check
- [x] Admin dashboard showing all active success fees (user, employer, salary, fee amount, status)
- [x] Overdue verifications list with days overdue and user contact info
- [x] Non-compliant accounts queue (missed payments, failed verifications)
- [x] Legal escalation action (mark account as escalated, add notes)
- [x] Account suspension/reinstatement controls
- [x] Revenue overview (total monthly fees collected, outstanding)
- [x] Add admin role check to server procedures (adminProcedure)
- [x] Add admin tRPC router with all admin procedures

### Terms of Service Page
- [x] Create /terms route with full ToS content covering 5% fee obligation
- [x] ToS must explicitly cover: fee calculation, payment schedule, quarterly verification, legal enforcement
- [x] Add ToS acceptance checkbox to Report Hire dialog (already partially done)
- [x] Add ToS acceptance to onboarding flow (first Dashboard visit for new users)
- [x] Store ToS acceptance timestamp in database (users table: tosAcceptedAt)
- [x] Gate Dashboard access behind ToS acceptance for new users
- [x] Add ToS link in footer of all pages
