# Budabit Kanban Extension

NIP-100 Kanban board extension for Flotilla repository issue tracking and project management.

This extension provides a **repo-tab Smart Widget** that integrates with Flotilla repositories, displaying as a "Kanban" tab alongside Issues and Patches.

## Features

- **NIP-100 Kanban board** for repository issue tracking
- **Repo-tab integration** - appears as a tab in repository views
- **Smart Widget** published to Nostr (kind `30033`)
- **Sandboxed iframe UI** (Svelte 5)
- **Typed postMessage bridge** compatible with Flotilla

## Quick Start

### 1) Install

```bash
pnpm install
```

### 2) Run the iframe app locally

```bash
pnpm dev
```

The widget iframe app will be available at `http://localhost:5178`.

### 3) Build

```bash
pnpm build
```

### 4) Generate & Publish to Nostr

#### Generate the Smart Widget event (unsigned)

```bash
pnpm manifest:generate
```

This generates:
- `dist/widget/event.json` (unsigned kind `30033` event with slot configuration)
- `dist/widget/widget.json` (optional discovery file)
- `dist/widget/PUBLISHING.md` (manual signing instructions)

#### Publish to Nostr relays

**Option A: Local signing (secret key)**

Set your Nostr secret key as an environment variable:

```bash
export NOSTR_SK=your_hex_secret_key
pnpm widget:publish
```

**Option B: Remote signing with NIP-46 (recommended)**

Use a remote signer (bunker) for better security:

```bash
export NOSTR_BUNKER="bunker://remote-signer-pubkey?relay=wss://relay.example.com&secret=your-secret"
pnpm widget:publish
```

Or pass the bunker URL directly:

```bash
pnpm manifest:publish -- --bunker "bunker://..."
```

**Dry run first:**

```bash
pnpm widget:publish:dry-run
```

The publish script will:
1. Build the widget
2. Generate the Smart Widget event
3. Sign it (locally or via NIP-46 remote signer)
4. Publish to relays (yakihonne, damus, nos.lol)
5. Output the `naddr` for installation in Flotilla

### 5) Install in Flotilla

Copy the printed `naddr` and install it in Flotilla:
- Settings → Extensions → Install Smart Widget (naddr)

Or use the `installWidgetByNaddr` function programmatically.

## Slot Configuration

This extension uses a **repo-tab slot** which means it appears as a tab in repository views:

```
["slot", "repo-tab", "Kanban", "kanban"]
```

- **type**: `repo-tab` - integrates with repository tab bar
- **label**: `Kanban` - display name in the tab
- **path**: `kanban` - URL path segment

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NOSTR_SK` or `NOSTR_SECRET_KEY` | Hex-encoded Nostr secret key for local signing |
| `NOSTR_BUNKER` or `BUNKER_URL` | NIP-46 bunker URL for remote signing |
| `GITHUB_TOKEN` or `GH_TOKEN` | GitHub token for release uploads |
| `KANBAN_APP_URL` | Override the app URL (default: `http://localhost:5178`) |

## Artifact Uploads

The publish script can upload your built extension artifact to remote storage, making it accessible via a public URL for the Smart Widget event.

### Upload to Blossom Servers

[Blossom](https://github.com/hzrd149/blossom) is a decentralized blob storage protocol for Nostr. Upload your artifact to one or more Blossom servers:

```bash
pnpm manifest:publish-widget \
  --blossom https://blossom.example.com \
  --blossom https://cdn.other.com \
  --artifact packages/iframe-app/dist/index.html
```

The script will:
1. Compute the SHA256 hash of the artifact
2. Create a signed Blossom upload auth event (kind 24242)
3. Upload to each server
4. Report the resulting URLs

### Upload to GitHub Releases

Upload your artifact as a GitHub Release asset:

```bash
export GITHUB_TOKEN=your_github_token
pnpm manifest:publish-widget \
  --github-repo owner/repo \
  --github-tag v1.0.0 \
  --artifact packages/iframe-app/dist/index.html
```

If the release doesn't exist, it will be created automatically.

### Combined Example

Publish the widget event and upload artifacts in one command:

```bash
export NOSTR_BUNKER="bunker://..."
export GITHUB_TOKEN="ghp_..."

pnpm manifest:publish-widget \
  --blossom https://blossom.primal.net \
  --github-repo budabit/kanban-extension \
  --github-tag v1.0.0 \
  --artifact packages/iframe-app/dist/index.html
```

## NIP-46 Remote Signing

The publish script supports [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) remote signing for enhanced security. This allows you to sign events using a hardware device or dedicated signing application without exposing your private key.

**Bunker URL format:**
```
bunker://<remote-signer-pubkey>?relay=<wss://relay>&secret=<optional-secret>
```

The script will:
1. Generate a temporary client keypair
2. Connect to the remote signer via the specified relays
3. Request the user's public key via `get_public_key`
4. Request event signing via `sign_event`
5. Handle auth challenges if the signer requires additional authentication

## Bridge Protocol (Action-Based)

Flotilla uses an action-based postMessage protocol:

- Widget -> Host requests:
  - `{ type: 'request', id, action, payload }`
- Host -> Widget responses:
  - `{ type: 'response', id, action, payload }`
- Host -> Widget events:
  - `{ type: 'event', action, payload }`

This template’s shared package provides a typed `WidgetBridge` with:

- `request(action, payload) -> Promise<responsePayload>`
- `onEvent(action, handler)` for host-initiated events (demo: `context:update`)
- `onRequest(action, handler)` for bidirectional "tool" widgets (host can request work from the iframe)

### Example: publish a note + show a toast

```ts
import { WidgetBridge, createEvent } from '@flotilla/ext-shared';

const bridge = new WidgetBridge();

async function publishNote(content: string) {
  const event = createEvent(1, content, []);
  const res = await bridge.request('nostr:publish', event);

  if ('error' in res) {
    await bridge.request('ui:toast', { message: res.error, type: 'error' });
    return;
  }

  await bridge.request('ui:toast', { message: 'Published', type: 'success' });
}
```

### Optional/demo: receive host context

Hosts may send context information as an event:

```ts
bridge.onEvent('context:update', (ctx) => {
  console.log('Context:', ctx.contextId, ctx.userPubkey, ctx.relays);
});
```

This is optional: the widget should still run without context.

## Permissions

Smart Widgets can declare permissions using `permission` tags (one per permission). This template defaults to:

- `nostr:publish`
- `ui:toast`

Flotilla may treat some actions as privileged (for example `nostr:*` and `storage:*`) and enforce them based on the widget’s declared permissions.

## Project Structure (Monorepo)

```
flotilla-extension-template/
├── packages/
│   ├── shared/          # Framework-agnostic bridge + types + signaling helpers
│   ├── iframe-app/      # Svelte 5 iframe app (Smart Widget tool demo)
│   ├── worker/          # Optional stubbed worker bridge (action protocol)
│   ├── manifest/        # CLI: generates kind 30033 + widget.json + instructions
│   └── test-utils/      # Mocks for bridge/testing
├── docs/                # Documentation (Smart Widget-focused)
├── e2e/                 # Playwright E2E tests
└── [config files]       # ESLint, Prettier, TypeScript, etc.
```

## Package Overview

### `@flotilla/ext-shared`

Shared, framework-agnostic code:

- `WidgetBridge`: typed action-based postMessage bridge compatible with Flotilla
- Smart Widget message/types: `WidgetWireMessage`, `WidgetActionMap`, `WidgetContext`
- Nostr helpers: `createEvent`, `validateEvent`, and related signaling utilities

### `@flotilla/ext-iframe`

Svelte 5 iframe app demonstrating a Smart Widget "tool":

- Calls host actions via `bridge.request('nostr:publish', ...)`
- Calls UI actions via `bridge.request('ui:toast', ...)`
- Displays optional host context received via `context:update`

### `@flotilla/ext-manifest`

Smart Widget generator CLI:

- Generates unsigned kind `30033` event JSON
- Generates `widget.json` for optional `/.well-known/widget.json` hosting
- Generates `PUBLISHING.md` with signing + publishing steps (including naddr hint when possible)

### `@flotilla/test-utils`

Testing helpers and bridge mocks compatible with the action protocol.

### `@flotilla/ext-worker`

Optional worker stub aligned with the same action-based protocol.

## Common Commands

```bash
pnpm dev
pnpm build
pnpm test
pnpm test:coverage
pnpm e2e
pnpm verify
pnpm manifest:generate
```

## Publishing (High Level)

1) Build the iframe app:
```bash
pnpm build
```

2) Host the iframe HTML somewhere reachable by Flotilla (typically on HTTPS):
- `packages/iframe-app/dist/index.html`

3) Generate Smart Widget files:
```bash
pnpm manifest:generate \
  --type tool \
  --title 'My Smart Widget' \
  --app-url 'https://cdn.example.com/my-widget/index.html' \
  --icon 'https://cdn.example.com/my-widget/icon.png' \
  --image 'https://cdn.example.com/my-widget/preview.png'
```

4) Sign and publish the generated kind `30033` event using `nostr-tools` (see `dist/widget/PUBLISHING.md`).

## Documentation

Smart Widget docs live in `docs/` and cover:
- Architecture
- Host bridge expectations
- Security guidelines
- Generator output formats

## License

MIT License - see [LICENSE](LICENSE) file for details.
