# BTCA Setup Notes

This project now has BTCA configured for source-first research with these resources:

- `better-auth` (git): `https://github.com/better-auth/better-auth`
- `effect` (git): `https://github.com/Effect-TS/effect`
- `ai-sdk` (git): `https://github.com/vercel/ai`

Configuration is stored in `btca.config.jsonc` and currently uses:

- `provider`: `opencode`
- `model`: `gpt-5-mini`
- `dataDirectory`: `.btca`

Useful commands:

- `btca resources` — list configured resources
- `btca ask -r better-auth -q "<question>"` — ask against Better Auth source
- `btca ask -r effect -q "<question>"` — ask against Effect source
- `btca ask -r ai-sdk -q "<question>"` — ask against AI SDK source
- `btca ask -r better-auth -r effect -q "<question>"` — ask across multiple
