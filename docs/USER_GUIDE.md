# Hire.AI V2 - User Guide

> Scope note: this guide describes the available product flows, not authority to submit applications or act on external services. Hire.AI prepares reviewable work and keeps external actions behind explicit user confirmation and connected-provider authorization. See `CURRENT_STATUS.md` for current limitations.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Setting Up Your Profile](#setting-up-your-profile)
4. [Job Search](#job-search)
5. [AI-Powered Features](#ai-powered-features)
6. [Application Preparation And Handoffs](#application-preparation-and-handoffs)
7. [Application Tracking](#application-tracking)
8. [Career Intelligence](#career-intelligence)
9. [Diversity & Inclusion Support](#diversity--inclusion-support)
10. [Tips for Success](#tips-for-success)

---

## Getting Started

### Welcome to Hire.AI V2

Hire.AI V2 is a job-search operating platform that helps you discover remote roles from configured sources, evaluate fit, and prepare reviewable application materials. Hire.AI never opens an employer portal, fills a third-party form, uploads documents, or submits an application on your behalf. You review and complete the external handoff, then record confirmation evidence in the application ledger.

### First Steps

1. **Sign In**: Click "Get Started" on the landing page to sign in with your Manus account
2. **Complete Your Profile**: Upload your resume and fill in your preferences
3. **Connect Social Profiles**: Link your LinkedIn, GitHub, and other professional profiles
4. **Set Job Preferences**: Define your ideal job type, salary range, and location preferences
5. **Start Searching**: Browse jobs or let AI find matches for you

---

## Dashboard Overview

The dashboard uses a **health monitoring metaphor** to visualize your job search progress:

The ranges below are illustrative planning benchmarks, not Hire.AI product
results, promises, or user outcome statistics.

### Vital Signs

| Metric | Description | Healthy Range |
|--------|-------------|---------------|
| **Application Rate** | Jobs applied per week | 10-20 applications |
| **Response Rate** | Percentage of applications receiving responses | 15-30% |
| **Interview Rate** | Percentage of responses leading to interviews | 20-40% |
| **Offer Rate** | Percentage of interviews resulting in offers | 10-25% |

### Health Indicators

- **🟢 Excellent**: Your job search is performing above average
- **🟡 Good**: Steady progress, room for improvement
- **🟠 Needs Attention**: Some metrics need optimization
- **🔴 Critical**: Immediate action required

### Quick Actions

- **Prepare Top Matches**: Create reviewable materials for high-match roles, then complete the employer handoff yourself
- **Review Pending Applications**: Check status of submitted applications
- **Schedule Interviews**: Manage upcoming interview appointments
- **Update Profile**: Keep your information current

---

## Setting Up Your Profile

### Resume Upload

1. Navigate to **Profile** → **Resume**
2. Click **Upload Resume** and select your file (PDF, DOCX, or TXT)
3. The AI will automatically extract:
   - Contact information
   - Work experience
   - Education history
   - Skills and certifications
4. Review and edit the extracted information
5. Click **Save Profile**

### Skills & Preferences

Configure your job search preferences:

- **Job Types**: Full-time, Part-time, Contract, Freelance
- **Experience Level**: Entry, Mid, Senior, Executive
- **Salary Range**: Minimum and target salary
- **Location**: Remote-only, Hybrid, or specific regions
- **Industries**: Tech, Finance, Healthcare, etc.
- **Company Size**: Startup, SMB, Enterprise

### Social Connections

Link your professional profiles for better matching:

| Platform | Benefits |
|----------|----------|
| **LinkedIn** | Import work history, endorsements, recommendations |
| **GitHub** | Showcase coding projects and contributions |
| **Portfolio** | Display creative work and case studies |
| **Twitter/X** | Professional presence and thought leadership |
| **Dribbble** | Design portfolio for creative roles |
| **Behance** | Creative project showcase |

---

## Job Search

### Browse Jobs

1. Go to **Jobs** → **Search**
2. Use filters to narrow results:
   - Keywords
   - Job type
   - Salary range
   - Experience level
   - Company
   - Platform source
3. Sort by: Relevance, Date Posted, Salary, Match Score

### AI Matching

The AI matching system scores jobs based on:

- **Skills Match** (40%): How well your skills align with requirements
- **Experience Match** (25%): Years of experience fit
- **Salary Match** (15%): Alignment with your expectations
- **Culture Fit** (10%): Company values alignment
- **Location Match** (10%): Geographic preferences

### Saved Jobs

- Click the **bookmark icon** to save jobs for later
- Access saved jobs from **Jobs** → **Saved**
- Add notes to saved jobs for reference
- Set reminders for application deadlines

---

## AI-Powered Features

### Cover Letter Generation

1. Open a job listing
2. Click **Generate Cover Letter**
3. The AI will create a personalized cover letter based on:
   - Your resume and experience
   - Job requirements
   - Company information
4. Edit and customize as needed
5. Download or copy to clipboard

### Interview Preparation

1. Select a job you're interviewing for
2. Click **Prepare for Interview**
3. Receive:
   - Common interview questions for the role
   - Company-specific questions
   - Behavioral question suggestions
   - Technical assessment topics
4. Practice with mock interview simulator

### Decision Maker Identification

For each job, the system identifies:

- **Hiring Manager**: Direct supervisor for the role
- **Recruiter**: HR contact handling applications
- **Team Lead**: Potential interviewer
- **Department Head**: Final decision maker

Use this information to:
- Personalize your application
- Send follow-up messages
- Network on LinkedIn

---

## Application Preparation And Handoffs

### How It Works

1. **Enable Autonomous Preparation**: Go to **Settings** → **Automation**
2. **Set Criteria**: Define your target roles, locations, match score, and daily preparation limit
3. **Review Queue**: Inspect the prepared materials, evidence gates, and decision rationale
4. **Approve Or Skip**: Approve a manual employer handoff only after reviewing the record
5. **Confirm Delivery**: Complete the external application yourself, then record deterministic confirmation evidence in Hire.AI

### Supported ATS Systems

| ATS | Handoff Level | Notes |
|-----|------------------|-------|
| **Greenhouse** | Manual handoff | Hire.AI can prepare ledger materials; the employer form remains under your control |
| **Lever** | Manual handoff | Hire.AI can prepare ledger materials; the employer form remains under your control |
| **Workday** | Manual handoff | Complete the employer portal, login, and any required questions directly |
| **Taleo** | Manual handoff | Complete the employer portal, login, and any required questions directly |
| **iCIMS** | Manual handoff | Complete the employer portal directly |
| **SmartRecruiters** | Manual handoff | Complete the employer portal directly |

### Safety Features

- **Daily Preparation Limit**: Configurable from 1 to 25 prepared application records per day
- **Review Mode**: Inspect materials and evidence before any external handoff
- **Blacklist**: Exclude specific companies or job types
- **Approval And Evidence**: External delivery is never assumed; confirmation evidence is required before an application becomes applied
- **Pause/Resume**: Control autonomous preparation at any time

### Sensitive Document Retention And Deletion

- Resume versions, offer letters, and verification documents are stored as private object references, never as public asset URLs. Downloads are requested through the authenticated backend and use a fresh storage-provider URL.
- Uploads are limited to 10 MiB, checked against allowed MIME types and file signatures before storage, and require a configured malware scanner in production. A scanner failure rejects the upload.
- Deleting a resume version first removes its private storage object. Its ledger record is removed only after that cleanup succeeds; a failed deletion leaves the record intact so the user can retry.
- Offer and quarterly-verification documents are compliance evidence. They remain retained while the associated success-fee obligation, verification review, payment recovery, dispute, or legal review is open. They require an operator-controlled retention decision once those obligations are closed.
- Settings can open one idempotent account-deletion review at a time. The request can be cancelled while open and remains visible as a status; submitting it does not immediately erase data.
- An admin resolution records the retention decision and audit trail only. Provider revocation, private-object deletion, database erasure, and any legally required retained evidence remain separate execution work.

---

## Application Tracking

### Application Statuses

| Status | Description |
|--------|-------------|
| **Draft** | Application started but not submitted |
| **Applied** | Application submitted successfully |
| **Viewed** | Employer viewed your application |
| **Interview** | Interview scheduled or completed |
| **Offer** | Job offer received |
| **Rejected** | Application not selected |
| **Withdrawn** | You withdrew the application |

### Managing Applications

1. Go to **Applications** to see all your applications
2. Click on any application for details
3. Add notes and updates
4. Schedule follow-ups
5. Track interview dates

### Follow-Up System

- **Automatic Reminders**: Get notified when to follow up
- **Email Templates**: Pre-written follow-up messages
- **Tracking**: Log all communications

---

## Career Intelligence

### Salary Analysis

Get market insights for any role:

- **Market Range**: 25th to 75th percentile salaries
- **Location Adjustments**: Cost of living factors
- **Experience Premiums**: How experience affects pay
- **Negotiation Tips**: Strategies for salary discussions

### Company Culture Analysis

Before applying, understand:

- **Work-Life Balance**: Employee reviews and ratings
- **Growth Opportunities**: Career advancement paths
- **Management Style**: Leadership approach
- **Team Dynamics**: Collaboration culture
- **Remote Work**: Policies and flexibility

### Networking Strategy

AI-generated networking recommendations:

- **Key Contacts**: People to connect with
- **Conversation Starters**: Personalized outreach messages
- **Events**: Relevant industry events and meetups
- **Communities**: Online groups to join

---

## Diversity & Inclusion Support

### D&I Categories

Hire.AI supports job seekers from diverse backgrounds:

| Category | Specialized Platforms |
|----------|----------------------|
| Women in Tech | PowerToFly, Women Who Code Jobs |
| Veterans | Hire Heroes USA, Military.com |
| People with Disabilities | Inclusively, AbilityJobs |
| LGBTQ+ | Out & Equal, Pride at Work |
| Black Professionals | Jopwell, Black Tech Jobs |
| Hispanic/Latino | Latinas in Tech, HACE |
| Indigenous | Native American Jobs |
| Refugees | Upwardly Global, Tent Partnership |
| Formerly Incarcerated | 70 Million Jobs, Honest Jobs |
| Neurodivergent | Specialisterne, Autism Speaks |
| Age 50+ | RetirementJobs, AARP |
| Caregivers | FlexJobs, Working Mother |
| First Generation | Handshake, FirstGen Forward |
| Low Income | Year Up, Opportunity@Work |
| Rural Communities | Remote OK, FlexJobs |

### Visa Sponsorship Analysis

For international job seekers:

- **Sponsorship Likelihood**: Probability of visa support
- **Company History**: Past sponsorship records
- **Visa Types**: H-1B, L-1, O-1, etc.
- **Timeline**: Typical processing times

---

## Tips for Success

### Optimize Your Profile

1. **Complete 100%**: Fill in all profile sections
2. **Use Keywords**: Include industry-relevant terms
3. **Quantify Achievements**: Use numbers and metrics
4. **Update Regularly**: Keep information current

### Application Best Practices

1. **Quality Over Quantity**: Focus on well-matched jobs
2. **Customize Applications**: Tailor cover letters
3. **Follow Up**: Send thank-you notes after interviews
4. **Track Everything**: Use the application tracker

### Leverage AI Features

1. **Trust the Match Score**: Higher scores = better fit
2. **Use Generated Content**: Start with AI, then personalize
3. **Review Suggestions**: AI learns from your feedback
4. **Stay Active**: Regular activity improves recommendations

### Stay Organized

1. **Set Daily Goals**: Aim for 3-5 quality applications
2. **Schedule Time**: Dedicate specific hours to job search
3. **Take Notes**: Document insights about companies
4. **Celebrate Wins**: Acknowledge progress

---

## Support

### Getting Help

- **FAQ**: Check our frequently asked questions
- **Chat Support**: Available 9 AM - 6 PM EST
- **Email**: support@hire.ai
- **Community**: Join our Discord server

### Feedback

We're constantly improving! Share your feedback:
- **Feature Requests**: Let us know what you need
- **Bug Reports**: Help us fix issues
- **Success Stories**: Share your wins!

---

*Last Updated: January 2026*
*Version: 2.0.0*
