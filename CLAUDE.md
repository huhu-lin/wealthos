# CLAUDE.md

WealthOS 是個人財務管理儀表板（繁體中文），支援台股、美股、加密貨幣與負債追蹤、FIRE 退休規劃、現金流管理，以及 KDJ + 布林通道策略訊號與多組合回測。

## 技術棧

- 前端：React + Vite → Vercel
- 後端：Vercel Edge Functions（`/api/*.js`）
- 資料庫：Supabase（PostgreSQL + Auth + RLS）
- K 線微服務：Python FastAPI（`kline-api/`）→ Render/Railway

## 開發指令

```bash
npm run dev      # Vite 開發伺服器（http://localhost:5173）
npm run build    # 生產建置
npm run lint     # ESLint 靜態分析
npm run preview  # 預覽生產建置
```

> 本專案**沒有測試框架**。

## 絕對禁止事項

1. **禁止 hardcode 色碼**：所有顏色與格式化必須使用 `src/constants/theme.js`（`C`、`TT`、`fmt`、`fmtM`、`pct`）
2. **Edge Function 必須宣告 runtime**：每個 `/api/*.js` 都要有 `export const config = { runtime: 'edge' }`
3. **禁止繞過 RLS**：用 JWT forward 而非 `SERVICE_KEY`（例外：kline-api 寫入 `kline_cache` 才用 `SUPABASE_SERVICE_KEY`）
4. **禁止引入 React Router**：Tab 路由固定用 `App.jsx` 的 `useState(tab)` 條件渲染
5. **禁止直接呼叫外部 API**：前端所有外部資料請求一律走 `src/utils/priceApi.js`

## 技能索引（按需載入）

| 主題 | 技能檔路徑 |
|------|------------|
| 前端慣例（主題常數、Tab 路由、共用元件、Price API） | `.claude/skills/frontend-conventions/SKILL.md` |
| Vercel Edge Functions 規範 | `.claude/skills/api-edge-functions/SKILL.md` |
| Supabase 資料表結構與 RLS | `.claude/skills/database-schema/SKILL.md` |
| KDJ + 布林策略指標邏輯 | `.claude/skills/strategy-logic/SKILL.md` |
| 環境變數 + GitHub Actions 排程 | `.claude/skills/devops-automation/SKILL.md` |
