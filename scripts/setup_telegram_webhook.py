#!/usr/bin/env python3
"""
One-time setup: register the Telegram webhook URL with the bot.

Usage:
  TELEGRAM_BOT_TOKEN=xxx VERCEL_URL=wealthos.vercel.app python scripts/setup_telegram_webhook.py

To verify:
  curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

To remove:
  curl https://api.telegram.org/bot<TOKEN>/deleteWebhook
"""
import os
import sys
import json
import urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN")
vercel_url = os.environ.get("VERCEL_URL")

if not token or not vercel_url:
    print("Error: TELEGRAM_BOT_TOKEN and VERCEL_URL must be set")
    sys.exit(1)

base = vercel_url.rstrip("/")
if not base.startswith("http"):
    base = f"https://{base}"

webhook_url = f"{base}/api/telegram-webhook"
api_url = f"https://api.telegram.org/bot{token}/setWebhook"

payload = json.dumps({
    "url": webhook_url,
    "allowed_updates": ["message"],
}).encode()

req = urllib.request.Request(
    api_url,
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(req, timeout=10) as resp:
    result = json.loads(resp.read())

print(json.dumps(result, indent=2, ensure_ascii=False))

if result.get("ok"):
    print(f"\n✅ Webhook 已設定：{webhook_url}")
else:
    print(f"\n❌ 設定失敗：{result.get('description')}")
    sys.exit(1)
