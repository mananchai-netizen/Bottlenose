# Service Account JSON — Required Fields

> The system loads `~/.han/service-account.json` via `google.auth.GoogleAuth({ keyFile })` in
> `packages/agent/src/integrations/google-drive.ts`. Only the JWT service-account auth flow is used.

## Fields the library actually reads

| Field | Used for | Required? |
|---|---|---|
| `type` | Must equal `"service_account"` to pick the right auth strategy | **Yes** |
| `client_email` | JWT `iss` (issuer) claim | **Yes** |
| `private_key` | Signs the JWT assertion | **Yes** |
| `private_key_id` | JWT header `kid` field | **Yes** |
| `token_uri` | Where to exchange the JWT for an access token | **Yes** |

## Fields that are NOT read (safe to delete)

| Field | Why it's not needed |
|---|---|
| `project_id` | Only used by ADC (Application Default Credentials), not JWT |
| `client_id` | OAuth2 client ID — not used in server-to-server JWT flow |
| `auth_uri` | OAuth2 browser redirect — not used in server-to-server JWT flow |
| `auth_provider_x509_cert_url` | Public cert lookup — only needed for verifying tokens, not signing |
| `client_x509_cert_url` | Same — not needed for signing |
| `universe_domain` | Only needed for non-standard Google API universes |

## Minimal valid service-account.json

```json
{
  "type": "service_account",
  "client_email": "your-sa@your-project.iam.gserviceaccount.com",
  "private_key_id": "abc123",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

## Code reference

- **Auth init**: `packages/agent/src/integrations/google-drive.ts:36-44`
- **Callers**: `packages/agent/src/executors/doc.ts`, `sheet.ts`, `slide.ts`, `cli/commands/demo.ts`
- **Config key**: `google_key_path` in `~/.han/config.json`
