// ============================================================
// LoginPage.jsx — 登入 / 註冊頁面
// 使用 Supabase Auth（Email + 密碼）
// ============================================================
import { useState } from "react";
import { supabase } from "../supabase";
import { C } from "../constants/theme";

export default function LoginPage() {
  const [mode,     setMode]     = useState("login"); // "login" | "signup"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState(null);   // { type: "success"|"error", text }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ type: "success", text: "註冊成功！請確認你的信箱，點擊驗證連結後即可登入。" });
        setMode("login");
      }
    } catch (err) {
      const msg = err.message || "發生錯誤，請重試";
      // 友善化常見錯誤訊息
      if (msg.includes("Invalid login credentials")) {
        setMessage({ type: "error", text: "Email 或密碼錯誤，請重試" });
      } else if (msg.includes("Email not confirmed")) {
        setMessage({ type: "error", text: "請先確認信箱後再登入" });
      } else if (msg.includes("User already registered")) {
        setMessage({ type: "error", text: "此 Email 已註冊，請直接登入" });
      } else {
        setMessage({ type: "error", text: msg });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter','Noto Sans TC',sans-serif",
      padding: "24px 16px",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 60, height: 60,
            background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            borderRadius: 16,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
            boxShadow: `0 8px 28px ${C.accent}40`,
            marginBottom: 16,
          }}>💰</div>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>WealthOS</div>
          <div style={{ color: C.textMuted, fontSize: 12, marginTop: 4, letterSpacing: "0.05em" }}>
            {mode === "login" ? "登入你的帳號" : "建立新帳號"}
          </div>
        </div>

        {/* 表單卡片 */}
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "28px 24px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}>

          {/* 訊息提示 */}
          {message && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 20,
              fontSize: 13,
              background: message.type === "success" ? C.accentDim : C.redDim,
              border: `1px solid ${message.type === "success" ? C.accent + "40" : C.red + "40"}`,
              color: message.type === "success" ? C.accent : C.red,
              lineHeight: 1.5,
            }}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                EMAIL
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: C.surface3,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  color: C.text,
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>

            {/* 密碼 */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                密碼
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder={mode === "signup" ? "至少 6 個字元" : "••••••••"}
                minLength={6}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: C.surface3,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  color: C.text,
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>

            {/* 送出按鈕 */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                background: loading ? C.surface3 : `linear-gradient(135deg, ${C.accent}, #00A07A)`,
                color: loading ? C.textMuted : "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px",
                fontSize: 14,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "0.02em",
                transition: "filter 0.2s, transform 0.1s",
                boxShadow: loading ? "none" : `0 4px 14px ${C.accent}40`,
              }}
              onMouseEnter={e => { if (!loading) e.target.style.filter = "brightness(1.1)"; }}
              onMouseLeave={e => { e.target.style.filter = "brightness(1)"; }}
            >
              {loading ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
            </button>
          </form>

          {/* 切換模式 */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <span style={{ color: C.textMuted, fontSize: 13 }}>
              {mode === "login" ? "還沒有帳號？" : "已有帳號？"}
            </span>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(null); }}
              style={{
                background: "none", border: "none",
                color: C.accent, fontSize: 13, fontWeight: 600,
                cursor: "pointer", marginLeft: 6,
                padding: 0,
              }}
            >
              {mode === "login" ? "立即註冊" : "登入"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, color: C.textDim, fontSize: 11 }}>
          你的資料安全儲存於 Supabase，僅你本人可見
        </div>
      </div>
    </div>
  );
}
