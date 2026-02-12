import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://yibfknfdsvkzcmamnjxx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpYmZrbmZkc3ZremNtYW1uanh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI0NTUsImV4cCI6MjA4MjA0ODQ1NX0.1gPMqI0cw76GIxntzJQ_HKvlm4Ca_7J-D4H-LDGM5T8'
)
