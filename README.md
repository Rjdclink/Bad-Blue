# BadBlue - Police Accountability Platform

## Overview
BadBlue is a privacy-focused police accountability platform designed to empower citizens in filing complaints and initiating civil rights lawsuits against police officers. It leverages AI for officer identification, legal analysis, intelligent form prefill, automated routing, and jurisdiction-specific legal document generation. The platform supports secure evidence uploads and offers services like LegalAI Consultation, Officer Search, and various legal document generations to enhance police accountability through accessible legal avenues.

## System Architecture
The platform utilizes a modern web stack featuring:
- **Frontend**: React 18 with TypeScript, Vite bundler, Wouter routing, Radix UI/shadcn/ui components with Tailwind CSS
- **Backend**: Node.js/Express.js RESTful API
- **Database**: PostgreSQL (Neon serverless) with Drizzle ORM
- **Authentication**: Local username/password authentication with session management
- **File Storage**: Google Cloud Storage or local filesystem fallback
- **State Management**: TanStack Query for client-side data fetching
- **Form Validation**: React Hook Form with Zod schemas

## Key Features

### Intelligent AI Architecture
A coordinated Gemini (primary) to Groq (fallback) system is implemented across all AI services for resilience and cost-efficiency. Smart rate limiting ensures proactive detection and switching between providers before user disruption.

### AI Sub-Agent
An admin-only AI Sub-Agent provides advanced autonomous capabilities for system management, error recovery, and learning. It includes:
- Intelligent auto-repair system that analyzes errors and generates fixes
- Self-modification capabilities for autonomous code updates
- Persistent learning and performance tracking across sessions
- Enhanced security safeguards with rollback capabilities

### Background Worker System
A robust background diagnostics and maintenance system runs continuously, performing:
- 6-hour diagnostic cycles
- Daily repair operations
- Comprehensive weekly tests
- Maintenance mode for scheduled activities
- Severity-classified failure reporting

### Privacy & Security
- Automated data cleanup system (14 days post-payment for user data, 30 days for error logs)
- 4-layer security firewall to prevent vulnerabilities
- Secure evidence upload with access control
- Session-based authentication with PostgreSQL storage

## Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Google Cloud Storage account (optional, for file storage)
- Square account for payment processing
- Google Gemini API key
- Groq API key

### Environment Variables
Create a `.env` file with the following configuration:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database
SUPABASE_DATABASE_URL=postgresql://... # Optional alternative

# Authentication
SESSION_SECRET=your-session-secret

# AI Services
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key

# Payment Processing
SQUARE_ACCESS_TOKEN=your_production_access_token
SQUARE_APPLICATION_ID=sq0idp-n5aXRG01aPrZ4KqxIh33Sw
SQUARE_LOCATION_ID=L0DRZCZ8YRK5K
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_signature_key

# File Storage (Optional)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCS_PROJECT_ID=your-gcs-project
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public,assets

# Application
PORT=5000
BASE_URL=https://your-domain.com
NODE_ENV=production

# Email Service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Setup Instructions

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/badblue.git
cd badblue
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up the database**
```bash
npm run db:push
```

4. **Build the application**
```bash
npm run build
```

5. **Start the application**
```bash
# Development
npm run dev

# Production
npm start
```

## Deployment

### Docker Deployment
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 5000
CMD ["npm", "start"]
```

### Platform-Specific Deployment

#### Railway
The application automatically detects Railway environment using `RAILWAY_PUBLIC_DOMAIN`.

#### Heroku
Deploy using the Heroku CLI or GitHub integration. The app detects Heroku via `HEROKU_APP_NAME`.

#### AWS/Google Cloud/Azure
Deploy as a containerized application or use platform-specific Node.js services.

## Development

### Project Structure
```
badblue/
├── client/               # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Route pages
│   │   ├── hooks/       # Custom React hooks
│   │   └── lib/         # Utility functions
├── server/              # Express backend
│   ├── routes.ts        # API endpoints
│   ├── storage.ts       # Database operations
│   └── *.ts            # Service modules
├── shared/              # Shared types/schemas
└── public/              # Static assets
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run check` - TypeScript type checking
- `npm run db:push` - Push database schema changes

## API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/logout` - User logout
- `GET /api/auth/user` - Get current user

### Core Services
- `POST /api/complaints` - File a complaint
- `POST /api/lawsuits` - Generate lawsuit documents
- `POST /api/officer-search` - Search for officer information
- `POST /api/evidence/upload` - Upload evidence files

## Contributing
Please read our contributing guidelines before submitting pull requests.

## License
Copyright (c) 2025 - All rights reserved.

## Support
For support inquiries, please contact support@badblue.com

## Critical Bug Fixes Log

### November 9, 2025
- **Database Pool Reset**: Fixed critical bug in database connection pooling
- **Auto-Repair Guard**: Added null-safety checks for error handling
- **API Quota Management**: Implemented tiered test coverage to prevent API exhaustion

## External Dependencies
- **Payment Processing**: Square Payment Links API
- **AI/ML Services**: Google Gemini API, Groq API
- **File Upload Libraries**: react-dropzone, Uppy
- **Date Formatting**: date-fns
- **CSV Processing**: csv-parse, csv-stringify