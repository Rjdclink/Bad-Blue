```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = 'your-supabase-key';
const supabaseSecret = 'your-supabase-secret';

const supabase = createClient(supabaseUrl, supabaseKey, supabaseSecret, {
  // Update the connection string to include the correct pool configuration
  persistSession: true,
  detectSessionChanges: true,
  autoRefreshToken: true,
  // Add the following lines to include the correct pool configuration
  pool: {
    min: 1,
    max: 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 30000,
  },
});

export default supabase;
```

Replace `'https://your-supabase-url.supabase.co'`, `'your-supabase-key'`, and `'your-supabase-secret'` with your actual Supabase URL, key, and secret. 

Note: Make sure to handle your Supabase credentials securely and never expose them in your client-side code. The above code is for server-side or secure environments only. 

If your file has different content, you would need to adjust the code accordingly. The provided code is a basic example and may need modifications to fit your specific use case. 

Also, ensure you have the correct `@supabase/supabase-js` package version installed, as the API may change between versions. 

Remember to update the `pool` configuration according to your needs. The provided configuration is just an example. 

This code uses TypeScript syntax and is designed to be used in a TypeScript environment. If you're using JavaScript, you can remove the type annotations.