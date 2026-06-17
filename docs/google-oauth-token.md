# Google OAuth Token

`google-oauth-token.json` stores the Google OAuth tokens Han can use for Google Drive, Docs, Sheets, and Slides access with a real Google user account.

By default, Han looks for the token at:

```txt
~/.han/google-oauth-token.json
```

The config UI also has an optional `Google OAuth Token Path` field. When set, Han reads the OAuth token from that path. When left blank, Han uses the default path above.

## Create The Token

1. Create an OAuth client in Google Cloud Console.
2. Use an installed app or web OAuth client.
3. Add this redirect URI:

```txt
http://127.0.0.1:53682/oauth2callback
```

4. Download the OAuth client JSON.
5. Save it as:

```txt
~/.han/google-oauth-client.json
```

6. Build the agent if needed:

```bash
npm run build -w packages/agent
```

7. Run Google auth:

```bash
node packages/agent/dist/cli/index.js google-auth
```

8. Open the URL shown in the terminal, approve access, and return to the terminal.

After approval succeeds, Han writes:

```txt
~/.han/google-oauth-token.json
```

## Notes

- Do not commit `google-oauth-client.json` or `google-oauth-token.json`.
- If both OAuth files exist, `GoogleDriveClient` prefers OAuth over the service account flow.
- The service account key path is still required by the current config UI and constructor, even when OAuth is available.
