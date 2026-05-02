import { createClient } from '@supabase/supabase-js'

// 從 Vite 環境變數讀取，本機開發請設定 .env.local
// Vercel 部署請在 Project Settings → Environment Variables 設定
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[supabase] Missing env vars: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY\n' +
    'Please copy .env.example to .env.local and fill in the values.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
