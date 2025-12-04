# LegalWhat Platform Documentation

## Overview

LegalWhat is a comprehensive subscription-based legal services platform integrated into the Bad Blue application. It provides AI-powered legal consultation, document creation, and deep OSINT people search capabilities for all types of law.

**Subscription Cost:** $25.99/month (processed via Square)

## Features

### 1. Landing Page
- Professional Lady of Justice SVG illustration
- Comprehensive service descriptions
- Eight AI systems showcase
- Clear pricing and subscription information
- Login/Sign Up call-to-action

### 2. Authentication System
- User registration with first name, last name, email, and password
- Secure password hashing using bcrypt
- Session-based authentication via Passport.js
- Subscription status tracking

### 3. Welcome Dashboard
- Displays 40+ law type categories including:
  - Family Law
  - Criminal Law
  - Civil Litigation
  - Employment Law
  - Corporate Law
  - Intellectual Property
  - Real Estate Law
  - Bankruptcy Law
  - Immigration Law
  - Personal Injury
  - Tax Law
  - And 30+ more categories
- Search functionality to filter law types
- Selection interface with "Let's Go" button
- Link to original Bad Blue app

### 4. Consultation/Document Workflow
- Law-type specific consultation tool
- Real-time data transfer to document creator
- Review and edit capabilities
- AI-powered assistance throughout

### 5. People Search - Deep OSINT Reports
- Comprehensive background research
- Multi-source data aggregation:
  - Public records
  - Social media profiles
  - Court records
  - Professional networks
  - News articles and online mentions
- Professional report generation with sections:
  - Identity Summary
  - Contact Information
  - Social Media Presence
  - Employment & Education
  - Location History
  - Public Records & Court Data
  - Online Mentions
  - Risk & Reputation Analysis
  - Summary & Confidence Assessment
- Downloadable formatted reports

## Eight Coordinated AI Systems

### System 1: Law Type Classification
Analyzes user input to automatically identify the appropriate legal category with confidence scoring.

### System 2: Document Drafting Suggestions
Provides intelligent, context-aware suggestions for document content based on law type and case details.

### System 3: Legal Language Optimization
Enhances text with proper legal terminology, formality, and precision.

### System 4: Consultation Question Generation
Creates relevant follow-up questions to gather comprehensive case information.

### System 5: Input Validation
Validates user input for completeness, accuracy, and identifies missing information.

### System 6: Outcome Prediction
Analyzes case details to predict likelihood of success and identify strengthening factors.

### System 7: Auto-fill Legal Data
Automatically populates repetitive legal fields from user profile and previous entries.

### System 8: Consultation Summarization
Synthesizes consultation data into structured summaries for document generation.

### Master Coordinator
Orchestrates all eight systems in parallel for comprehensive legal assistance.

## Technical Architecture

### Frontend Stack
- React 18 with TypeScript
- Wouter for routing
- Radix UI components
- Tailwind CSS styling
- TanStack Query for data fetching
- Zod for validation

### Backend Stack
- Node.js/Express.js
- PostgreSQL database with Drizzle ORM
- bcrypt for password hashing
- Square API for payments (placeholder)
- Session-based authentication

### Database Schema

#### `legalizo_subscriptions`
Tracks user subscription status and payment information.

```sql
CREATE TABLE legalizo_subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  square_subscription_id VARCHAR UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  plan_amount INTEGER NOT NULL DEFAULT 2599,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### `legalizo_consultation_sessions`
Stores consultation workflow data and progress.

```sql
CREATE TABLE legalizo_consultation_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  law_type VARCHAR(100) NOT NULL,
  conversation_state JSONB NOT NULL DEFAULT '[]',
  consultation_data JSONB,
  document_data JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

#### `people_search_reports`
Stores OSINT report data and status.

```sql
CREATE TABLE people_search_reports (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  subject_name VARCHAR(255),
  report_data JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'processing',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

## API Endpoints

### Authentication

#### `POST /api/legalizo/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "hasActiveSubscription": false
}
```

#### `POST /api/legalizo/auth/login`
Login to existing account.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

### Subscription Management

#### `POST /api/legalizo/subscription/create`
Create a subscription checkout session.

**Response:**
```json
{
  "checkoutUrl": "https://square.link/..."
}
```

#### `GET /api/legalizo/subscription/status`
Check current subscription status.

**Response:**
```json
{
  "hasActiveSubscription": true,
  "subscription": {
    "status": "active",
    "currentPeriodEnd": "2024-02-01T00:00:00Z"
  }
}
```

### People Search

#### `POST /api/legalizo/people-search`
Initiate a new people search report.

**Request Body:**
```json
{
  "searchQuery": "John Smith"
}
```

**Response:**
```json
{
  "reportId": "uuid",
  "status": "processing"
}
```

#### `GET /api/legalizo/people-search/:reportId`
Get report status and data.

**Response:**
```json
{
  "id": "uuid",
  "status": "completed",
  "reportData": {
    "identitySummary": {...},
    "contactInformation": [...],
    "confidenceScore": 75
  }
}
```

#### `GET /api/legalizo/people-search/:reportId/download`
Download formatted report.

### Consultation Sessions

#### `POST /api/legalizo/consultation/session`
Create a new consultation session.

**Request Body:**
```json
{
  "lawType": "Family Law"
}
```

#### `PUT /api/legalizo/consultation/session/:sessionId`
Update session with new data.

**Request Body:**
```json
{
  "consultationData": {...},
  "documentData": {...},
  "status": "completed"
}
```

## Security Features

### Authentication & Authorization
- bcrypt password hashing with salt rounds
- Session-based authentication via Passport.js
- Subscription verification middleware on protected routes
- User input validation with Zod schemas

### Data Protection
- All passwords hashed before storage
- Subscription-based access control
- User data isolation (users can only access own data)
- Input sanitization on all endpoints

### Production Security Requirements
⚠️ **Before deploying to production:**

1. **Implement Square webhook signature verification**
   - Verify `x-square-hmacsha256-signature` header
   - Validate webhook authenticity
   - Prevent unauthorized subscription manipulation

2. **Add rate limiting**
   - Protect authentication endpoints from brute force
   - Limit API requests per user/IP
   - Prevent OSINT search abuse

3. **Implement HTTPS only**
   - Force SSL/TLS for all connections
   - Secure cookie flags (httpOnly, secure, sameSite)

4. **Add CSRF protection**
   - Implement CSRF tokens
   - Validate origin headers

## Deployment

### Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Square Payment (Production)
SQUARE_ACCESS_TOKEN=your-production-token
SQUARE_LOCATION_ID=your-location-id
SQUARE_APPLICATION_ID=your-app-id
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=your-webhook-key

# Session
SESSION_SECRET=your-session-secret

# Application
BASE_URL=https://yourdomain.com
NODE_ENV=production
```

### Production Setup Steps

1. **Database Migration**
   ```bash
   npm run db:push
   ```

2. **Square Dashboard Setup**
   - Create subscription plans in Square Dashboard
   - Set up webhook endpoints
   - Configure pricing and billing cycles
   - Test in sandbox environment first

3. **OSINT API Integration**
   - Obtain API keys for public records services
   - Set up social media API access
   - Configure court records access
   - Implement rate limiting

4. **Job Queue System**
   - Implement Bull, Agenda, or AWS SQS
   - Replace setTimeout with proper job queue
   - Add retry logic and error handling
   - Monitor job completion rates

5. **Build and Deploy**
   ```bash
   npm run build
   npm start
   ```

## Development

### Running Locally

```bash
# Install dependencies
npm install

# Run database migrations
npm run db:push

# Start development server
npm run dev
```

### Testing

```bash
# Type checking
npm run check

# Build
npm run build
```

## Production Readiness Checklist

### Critical (Required for Production)
- [ ] Implement Square subscription API integration
- [ ] Add Square webhook signature verification
- [ ] Implement proper job queue system
- [ ] Add rate limiting to all endpoints
- [ ] Set up OSINT data source APIs
- [ ] Implement CSRF protection
- [ ] Add comprehensive error logging
- [ ] Set up monitoring and alerting

### Important (Recommended)
- [ ] Add WebSockets or SSE for real-time updates
- [ ] Implement caching layer (Redis)
- [ ] Add automated testing suite
- [ ] Set up CI/CD pipeline
- [ ] Create admin dashboard for subscription management
- [ ] Add analytics and usage tracking
- [ ] Implement email notifications
- [ ] Create user documentation

### Nice to Have
- [ ] Add PDF generation for reports
- [ ] Implement dark mode
- [ ] Add multi-language support
- [ ] Create mobile app
- [ ] Add AI chat interface
- [ ] Implement document templates library

## Maintenance

### Regular Tasks
- Monitor subscription webhook processing
- Review OSINT data source availability
- Check AI system performance metrics
- Update legal content and disclaimers
- Review and respond to user feedback

### Monitoring Metrics
- User registration rate
- Subscription conversion rate
- People search success rate
- AI system accuracy
- API response times
- Error rates by endpoint

## Support & Documentation

### User Support
- Email: support@legalwhat.com (placeholder)
- In-app contact form
- Knowledge base (to be created)

### Developer Documentation
- API documentation: See API Endpoints section
- Database schema: See Technical Architecture
- AI systems: See server/legalizoAI.ts
- OSINT search: See server/peopleSearch.ts

## Legal & Compliance

### Disclaimers
The platform includes appropriate disclaimers that:
- AI assistance does not replace licensed attorney advice
- OSINT reports are for informational purposes
- Users should verify all information independently
- Compliance with FCRA and other regulations

### Terms of Service
Platform usage requires:
- Active subscription
- Acceptance of terms
- Compliance with usage policies
- Respect for privacy laws

## Contributing

This platform is part of the Bad Blue application. For contributions:
1. Follow existing code style
2. Add tests for new features
3. Update documentation
4. Submit pull requests with clear descriptions

## License

Copyright (c) 2024 - All rights reserved.

## Version History

### v1.0.0 (Current)
- Initial release with all core features
- Eight AI systems implementation
- People Search OSINT framework
- Complete frontend and backend
- Database schema and migrations
- Placeholder Square integration
