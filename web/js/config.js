// Public connection details. The publishable key is meant to be public: every table is
// protected by row-level security in the database, not by hiding this key.
export const SUPABASE_URL = 'https://zeaiwvgktakbwnqpchbo.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Mjq5bLuJ8fX_dmIik_3VIg_oM_8MzNb';

// Turn on once the Google provider is configured in Supabase (Authentication > Providers).
export const GOOGLE_SIGN_IN = false;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
