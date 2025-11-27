```typescript
import { createClient } from '@supabase/supabase-js';
import { PoolConfig } from 'pg';

// Define the pool configuration to prevent calling end on the pool prematurely
const poolConfig: PoolConfig = {
  min: 1, // minimum number of connections
  max: 10, // maximum number of connections
  idleTimeoutMillis: 30000, // 30 seconds
  // Do not call end on the pool
  // This will prevent the pool from being closed before it's used
};

// Create a new Supabase client with the updated pool configuration
const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = 'your-supabase-key';
const supabaseSecret = 'your-supabase-secret';

const supabase = createClient(supabaseUrl, supabaseKey, supabaseSecret, {
  // Use the updated pool configuration
  pool: poolConfig,
});

export default supabase;
```

Note: Make sure to replace `'https://your-supabase-url.supabase.co'`, `'your-supabase-key'`, and `'your-supabase-secret'` with your actual Supabase URL, key, and secret. 

Also, ensure you have the `@supabase/supabase-js` and `pg` packages installed in your project. If not, you can install them using npm or yarn:

```bash
npm install @supabase/supabase-js pg
```

or

```bash
yarn add @supabase/supabase-js pg
```