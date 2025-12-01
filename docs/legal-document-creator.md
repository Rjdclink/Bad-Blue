# Legal Document Creator

The Legal Document Creator is an AI-powered feature that generates professional legal documents customized to the user's jurisdiction. It uses BadBlue's multi-provider AI system (Gemini/Groq) to produce high-quality, jurisdiction-aware legal documents.

## Features

- **Intelligent Questionnaire**: AI-guided questions to understand your document needs
- **Document Type Inference**: Automatically determines the best document type based on your description
- **Jurisdiction-Aware**: Fetches and applies state-specific legal requirements
- **Draft Preview**: Review your document before payment (copy-protected)
- **Edit Requests**: Request changes to your draft before finalizing
- **Secure Payment**: Stripe Checkout integration ($5.99 per document)
- **Email Delivery**: Final document delivered via email after payment

## Supported Document Types

1. **Demand Letter** - For requesting payment or action from another party
2. **Cease and Desist** - For ordering someone to stop an action
3. **Settlement Agreement** - For documenting resolution of a dispute
4. **Power of Attorney** - For granting legal authority to another person
5. **Affidavit** - For sworn statements of fact
6. **Complaint Letter** - For formal complaints to organizations
7. **Notice of Intent** - For formal notice of planned legal action
8. **Declaration** - For written statements under penalty of perjury
9. **Simple Will** - For basic estate planning
10. **Lease Agreement** - For rental/lease arrangements

## User Flow

### 1. Start Session
Click the "Legal Document Creator" panel on the home page to begin.

### 2. Answer Questions
The system will guide you through a series of questions:
- What is the purpose of your document?
- Who are the parties involved?
- Which U.S. state will this document be used in?
- What are the key facts or circumstances?
- What outcome do you want from this document?

Follow-up questions may be asked based on your answers.

### 3. Generate Draft
Once all required information is collected, click "Generate Document" to create your draft.

### 4. Review & Edit
Review the generated document in the preview area. If changes are needed:
- Click "Request Changes"
- Describe the modifications you want
- Click "Apply Changes"

### 5. Payment
When satisfied with your document:
1. Enter your email address
2. Click "Pay $5.99 & Receive Document"
3. Complete payment via Stripe Checkout
4. Receive your document via email

## Technical Architecture

### Server Components

- **`server/legalDocumentCreator.ts`** - Core business logic
  - Session management (in-memory store)
  - AI orchestration for document type inference
  - Document generation with jurisdiction research
  - Stripe checkout integration
  - Webhook handling for payment confirmation

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/legal/session` | Initialize a new session |
| POST | `/api/legal/session/:id/answer` | Submit questionnaire answers |
| POST | `/api/legal/session/:id/generate` | Generate draft document |
| POST | `/api/legal/session/:id/edit` | Request changes to draft |
| GET | `/api/legal/session/:id/preview` | Get draft preview |
| POST | `/api/legal/session/:id/checkout` | Create Stripe checkout |
| GET | `/api/legal/session/:id` | Get session status |

### Client Components

- **`client/src/components/LegalDocumentCreatorPanel.tsx`**
  - Home page panel card
  - Modal dialog for document creation flow
  - Questionnaire form
  - Draft preview with copy protection
  - Edit request form
  - Payment checkout flow

### AI Integration

The feature uses the unified AI provider system (`server/aiProvider.ts`):

1. **Document Type Inference**: Uses `TaskComplexity.MODERATE` to analyze user answers and determine the appropriate document type

2. **Jurisdiction Research**: Uses `TaskComplexity.MODERATE` to fetch state-specific legal requirements

3. **Document Generation**: Uses `TaskComplexity.COMPREHENSIVE` for final document drafting

All AI usage is tracked via `aiTokenGovernor` for quota management.

## Security Features

### Input Sanitization
- All user inputs are sanitized to prevent XSS attacks
- HTML and script tags are stripped from answers

### Copy Protection
- Draft preview is displayed with `user-select: none`
- `onCopy` events are prevented on the preview area
- Full document only delivered via email after payment

### Payment Security
- Stripe Checkout handles all payment processing
- Webhook signature verification for payment confirmation
- Session metadata stored in Stripe for verification

### Rate Limiting
- Standard authentication required for all endpoints
- AI quota management via token governor

## Testing Locally

### Prerequisites
- Stripe API keys (test mode)
- AI provider API keys (Gemini or Groq)

### Environment Variables
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GEMINI_API_KEY=...
# or
GROQ_API_KEY=...
```

### Running Tests
```bash
# Run the test suite
npm run test server/tests/legalDocumentCreatorTests.ts
```

### Local Webhook Testing
Use Stripe CLI to forward webhooks:
```bash
stripe listen --forward-to localhost:5000/api/legal/webhook
```

## Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   User Client   │────▶│   API Endpoints  │────▶│ legalDocCreator   │
└─────────────────┘     └──────────────────┘     └───────────────────┘
         │                       │                        │
         │                       │                        ▼
         │                       │              ┌───────────────────┐
         │                       │              │   AI Provider     │
         │                       │              │ (Gemini/Groq)     │
         │                       │              └───────────────────┘
         │                       │                        │
         │                       ▼                        │
         │              ┌──────────────────┐              │
         │◀────────────│  Session Store   │◀─────────────┘
         │              │   (In-Memory)    │
         │              └──────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│ Stripe Checkout │────▶│  Email Service   │
└─────────────────┘     └──────────────────┘
```

## Session Lifecycle

1. **`questionnaire`** - Initial state, collecting user answers
2. **`drafting`** - Document generation in progress
3. **`preview`** - Draft ready for review
4. **`paid`** - Payment completed
5. **`delivered`** - Document sent via email

## Error Handling

- Sessions expire after 24 hours
- Failed AI generations revert to questionnaire state
- Payment failures allow retry without losing draft
- Email delivery failures logged for admin follow-up

## Future Enhancements

- Database persistence for sessions (currently in-memory)
- PDF document generation
- Document templates library
- Multi-party document support
- Electronic signature integration
- Document revision history
