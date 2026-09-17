# BadBlue - Complete Supabase Migration Guide

## Overview
This guide provides step-by-step instructions for migrating BadBlue from its current PostgreSQL/filesystem storage architecture to Supabase's integrated platform (Database, Auth, Storage).

## Current Architecture
- **Database**: PostgreSQL (Neon/Railway)
- **Authentication**: Local passport.js with bcrypt
- **Storage**: Filesystem fallback (Google Cloud Storage optional)
- **Email**: Resend API
- **Hosting**: Railway.com
- **DNS/CDN**: Cloudflare
- **Domain**: Network Solutions

## Target Architecture
- **Database**: Supabase PostgreSQL
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage
- **Email**: Resend API (unchanged)
- **Hosting**: Railway.com (unchanged)
- **DNS/CDN**: Cloudflare (unchanged)
- **Domain**: Network Solutions (unchanged)

## Prerequisites
1. Supabase account and project created
2. Railway account configured
3. Resend API key
4. All AI API keys (Mistral, Groq, Gemini, Claude)

## Migration Steps

### Phase 1: Database Migration

#### 1.1 Export Current Schema
```bash
# Connect to current database
pg_dump $DATABASE_URL --schema-only > schema.sql

# Export data
pg_dump $DATABASE_URL --data-only > data.sql
```

#### 1.2 Setup Supabase Database
```sql
-- Connect to Supabase database and import schema
psql $SUPABASE_DB_URL < schema.sql

-- Import data
psql $SUPABASE_DB_URL < data.sql
```

#### 1.3 Update Database Connection
```typescript
// server/db.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Update Drizzle to use Supabase connection
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

const connectionString = process.env.SUPABASE_DB_URL!
const client = postgres(connectionString)
export const db = drizzle(client)
```

### Phase 2: Authentication Migration

#### 2.1 Enable Supabase Auth
1. In Supabase Dashboard, enable Email/Password authentication
2. Configure JWT secret and expiry

#### 2.2 Migrate User Accounts
```typescript
// migration-scripts/migrate-users.ts
import { supabase } from './supabase-client'
import { db } from '../server/db'

async function migrateUsers() {
  const users = await db.select().from(schema.users)
  
  for (const user of users) {
    // Create Supabase auth user
    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email: user.email,
      email_confirm: true,
      user_metadata: {
        firstName: user.firstName,
        lastName: user.lastName,
        legacyId: user.id
      }
    })
    
    if (!error) {
      // Update user record with Supabase auth ID
      await db.update(schema.users)
        .set({ supabaseAuthId: authUser.user.id })
        .where(eq(schema.users.id, user.id))
    }
  }
}
```

#### 2.3 Replace Passport.js with Supabase Auth
```typescript
// server/auth.ts - NEW
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export async function authenticateUser(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  
  if (!token) return null
  
  const { data: { user }, error } = await supabase.auth.getUser(token)
  return error ? null : user
}
```

#### 2.4 Update Client Authentication
```typescript
// client/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// client/src/hooks/useAuth.ts
import { supabase } from '@/lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )
    
    return () => subscription.unsubscribe()
  }, [])
  
  return { user }
}
```

### Phase 3: Storage Migration

#### 3.1 Create Supabase Storage Buckets
```sql
-- In Supabase SQL Editor
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('evidence-files', 'evidence-files', false),
  ('public-assets', 'public-assets', true);
```

#### 3.2 Migrate Existing Files
```typescript
// migration-scripts/migrate-storage.ts
import { supabase } from './supabase-client'
import fs from 'fs/promises'
import path from 'path'

async function migrateEvidenceFiles() {
  const evidenceDir = './evidence_files'
  const files = await fs.readdir(evidenceDir)
  
  for (const fileName of files) {
    if (fileName.endsWith('.meta.json')) continue
    
    const filePath = path.join(evidenceDir, fileName)
    const fileBuffer = await fs.readFile(filePath)
    
    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from('evidence-files')
      .upload(fileName, fileBuffer, {
        contentType: 'application/octet-stream',
        upsert: true
      })
      
    if (error) {
      console.error(`Failed to upload ${fileName}:`, error)
    }
  }
}
```

#### 3.3 Update Evidence Storage Implementation
```typescript
// server/evidenceStorage.ts - NEW
import { createClient } from '@supabase/supabase-js'

class SupabaseEvidenceStorage implements IEvidenceStorage {
  private supabase: SupabaseClient
  
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  
  async getUploadURL(): Promise<string> {
    const fileName = `${randomUUID()}`
    const { data, error } = await this.supabase.storage
      .from('evidence-files')
      .createSignedUploadUrl(fileName)
      
    if (error) throw error
    return data.signedUrl
  }
  
  async saveFile(fileURL: string, userId: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    // File is already uploaded via signed URL
    const fileName = fileURL.split('/').pop()
    
    // Store metadata in database
    await this.supabase
      .from('evidence_metadata')
      .insert({
        file_name: fileName,
        user_id: userId,
        visibility: aclPolicy.visibility,
        uploaded_at: new Date()
      })
      
    return `/evidence/${fileName}`
  }
  
  async downloadFile(filePath: string, userId: string, res: Response): Promise<void> {
    const fileName = filePath.replace('/evidence/', '')
    
    const { data, error } = await this.supabase.storage
      .from('evidence-files')
      .createSignedUrl(fileName, 60) // 60 second expiry
      
    if (error) throw error
    res.redirect(data.signedUrl)
  }
}
```

### Phase 4: Environment Variables

#### 4.1 Remove Old Variables
```bash
# Remove these from Railway/production
GOOGLE_APPLICATION_CREDENTIALS
GCS_PROJECT_ID
PRIVATE_OBJECT_DIR
EVIDENCE_STORAGE_DIR
SESSION_SECRET
```

#### 4.2 Add Supabase Variables
```bash
# Add these to Railway/production
SUPABASE_URL=your-project-url.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
SUPABASE_DB_URL=postgresql://postgres:[password]@[host]:5432/postgres

# Keep these existing variables
DATABASE_URL=$SUPABASE_DB_URL # Use Supabase DB
RESEND_API_KEY=your-resend-key
STRIPE_SECRET_KEY=your-stripe-key
VITE_STRIPE_PUBLIC_KEY=your-stripe-public-key
MISTRAL_API_KEY=your-mistral-key
GROQ_API_KEY=your-groq-key
GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-claude-key
ADMIN_BYPASS_ID=$ADMIN85
ADMIN_BYPASS_PASSWORD=<configured master password>
```

### Phase 5: Update Package Dependencies

#### 5.1 Remove Unused Packages
```bash
npm uninstall @google-cloud/storage connect-pg-simple express-session passport passport-local bcrypt
```

#### 5.2 Install Supabase
```bash
npm install @supabase/supabase-js @supabase/auth-helpers-react
```

### Phase 6: Railway Deployment

#### 6.1 Update Railway Configuration
```yaml
# railway.toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[[services]]
name = "badblue"
region = "us-west1"
```

#### 6.2 Deploy to Railway
```bash
# From project root
railway login
railway link [project-id]
railway up
```

### Phase 7: Post-Migration Validation

#### 7.1 Test Authentication
```typescript
// test-scripts/test-auth.ts
const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!'
}

// Test signup
const { data: signUpData, error: signUpError } = await supabase.auth.signUp(testUser)

// Test signin
const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword(testUser)

// Test session
const { data: { session } } = await supabase.auth.getSession()
console.assert(session !== null, 'Session should exist')
```

#### 7.2 Test Storage
```typescript
// test-scripts/test-storage.ts
const testFile = new File(['test content'], 'test.txt', { type: 'text/plain' })

// Upload file
const { data: uploadData, error: uploadError } = await supabase.storage
  .from('evidence-files')
  .upload('test.txt', testFile)

// Download file
const { data: downloadData } = await supabase.storage
  .from('evidence-files')
  .download('test.txt')
```

#### 7.3 Test Database
```typescript
// test-scripts/test-database.ts
// Test read
const { data: users } = await supabase
  .from('users')
  .select('*')
  .limit(1)

// Test write
const { data: newComplaint, error } = await supabase
  .from('complaints')
  .insert({ /* complaint data */ })
  .single()
```

### Phase 8: Cleanup

1. Remove old authentication routes (`/api/login/local`, `/api/register/local`)
2. Remove filesystem storage directory
3. Remove unused environment variables from Railway
4. Update documentation to reflect new architecture

## Rollback Plan

If issues arise during migration:

1. **Database Rollback**: Keep PostgreSQL backup for 30 days
2. **Auth Rollback**: Maintain user password hashes for fallback
3. **Storage Rollback**: Keep filesystem backup for 30 days
4. **Quick Switch**: Use environment variable to toggle between old/new systems

```typescript
// server/config.ts
export const USE_SUPABASE = process.env.USE_SUPABASE === 'true'

// Conditionally load appropriate modules
const storage = USE_SUPABASE 
  ? require('./supabaseStorage') 
  : require('./evidenceStorage')
```

## Security Considerations

1. **API Keys**: Never expose Supabase service keys client-side
2. **RLS Policies**: Enable Row Level Security on all tables
3. **Storage Policies**: Configure bucket policies for user access
4. **Admin Access**: Maintain admin bypass for emergency access
5. **Audit Logging**: Implement comprehensive logging for all operations

## Performance Optimization

1. **Connection Pooling**: Use Supabase's built-in connection pooler
2. **Edge Functions**: Move heavy operations to Supabase Edge Functions
3. **Caching**: Implement Redis for frequently accessed data
4. **CDN**: Use Cloudflare for static assets
5. **Database Indexes**: Create indexes for frequently queried columns

## Monitoring

1. **Supabase Dashboard**: Monitor database, auth, and storage metrics
2. **Railway Metrics**: Track deployment health and resource usage
3. **Error Tracking**: Implement Sentry or similar for error monitoring
4. **Uptime Monitoring**: Use Cloudflare Analytics for availability

## Support Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Railway Documentation](https://docs.railway.app)
- [Cloudflare Documentation](https://developers.cloudflare.com)
- [Resend Documentation](https://resend.com/docs)

## Timeline Estimate

- Phase 1 (Database): 2-3 days
- Phase 2 (Auth): 3-4 days
- Phase 3 (Storage): 2-3 days
- Phase 4-5 (Config): 1 day
- Phase 6 (Deploy): 1 day
- Phase 7 (Testing): 2-3 days
- Phase 8 (Cleanup): 1 day

**Total: 12-18 days for complete migration**

## Notes

- Keep admin bypass functionality as requested
- Maintain backward compatibility during migration
- Test thoroughly in staging before production deployment
- Document all custom modifications for future reference