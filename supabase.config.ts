```typescript
import { createClient } from '@supabase/supabase-js';
import { PoolConfig } from 'pg';

const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = 'your-supabase-key';
const supabaseSecret = 'your-supabase-secret';

const poolConfig: PoolConfig = {
  // Update the pool configuration to prevent calling end on the pool prematurely
  // by setting the idleTimeoutMillis to a higher value or disabling it altogether
  idleTimeoutMillis: 0, // disable idle timeout
};

const supabase = createClient(supabaseUrl, supabaseKey, supabaseSecret, {
  // Pass the updated pool configuration to the Supabase client
  pool: poolConfig,
});

export default supabase;
```

**Note:** Make sure to replace `'https://your-supabase-url.supabase.co'`, `'your-supabase-key'`, and `'your-supabase-secret'` with your actual Supabase URL, key, and secret.

**Changes Made:**

* Imported the `PoolConfig` type from the `pg` module.
* Created a `poolConfig` object with the updated configuration, setting `idleTimeoutMillis` to `0` to disable the idle timeout.
* Passed the updated `poolConfig` to the `createClient` function when creating the Supabase client.

This updated configuration prevents the pool from being closed prematurely, ensuring that it remains available for use.