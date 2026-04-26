import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://arnquhroncgsrlmyxmyj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_BYbNCuzsEHf8cNd-zBwPGA_-coCffO_'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
