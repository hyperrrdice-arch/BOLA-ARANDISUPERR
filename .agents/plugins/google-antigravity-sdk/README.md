# Google Antigravity SDK Plugin (Workspace Scoped)

Plugin ini dipasang khusus di workspace **football-agent** (`.agents/plugins/google-antigravity-sdk/`) untuk menyediakan integrasi, rules, dan skills terkait **Google Antigravity SDK** dan **Antigravity Agent Runtime**.

## Struktur Plugin
* `plugin.json`: Manifest identitas dan suggested prompts plugin.
* `rules/AGENTS.md`: Panduan runtime safety, isolation, dan event handling untuk Antigravity SDK.
* `skills/antigravity-sdk/SKILL.md`: Skill komprehensif untuk Python SDK (`google-antigravity`) dan ConnectRPC Language Server API (Node.js/TypeScript).

## Cakupan
Plugin ini hanya aktif di dalam project ini (workspace level) dan tidak mengubah konfigurasi mesin global (`~/.gemini/config/`).
