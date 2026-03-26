# App Store Review Monitor

A GitHub Action that monitors your App Store Connect review status and creates GitHub Issues on status changes. Supports Slack, Discord, and Microsoft Teams notifications.

## Features

- Checks App Store Connect review status on a schedule
- Creates GitHub Issues when status changes
- Detailed rejection information when app is rejected
- Status emoji for quick visual scanning
- Tracks previous status via issue labels (no external storage needed)
- Optional notifications to **Slack**, **Discord**, and **Microsoft Teams**

## Usage

```yaml
name: App Store Review Monitor
on:
  schedule:
    - cron: '0 */3 * * *'  # Every 3 hours
  workflow_dispatch: {}

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: hakaru/appstore-review-monitor@v1
        with:
          app-id: ${{ secrets.APP_STORE_APP_ID }}
          asc-key-id: ${{ secrets.ASC_KEY_ID }}
          asc-issuer-id: ${{ secrets.ASC_ISSUER_ID }}
          asc-private-key: ${{ secrets.ASC_PRIVATE_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: add notification channels
          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          discord-webhook-url: ${{ secrets.DISCORD_WEBHOOK }}
          teams-webhook-url: ${{ secrets.TEAMS_WEBHOOK }}
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `app-id` | Yes | App Store Connect App ID |
| `asc-key-id` | Yes | API Key ID |
| `asc-issuer-id` | Yes | Issuer ID |
| `asc-private-key` | Yes | `.p8` private key contents |
| `github-token` | No | GitHub token (defaults to `GITHUB_TOKEN` env) |
| `issue-label` | No | Label for cache issues (default: `asc-monitor`) |
| `version-id` | No | Specific version ID to monitor (defaults to latest) |
| `slack-webhook-url` | No | Slack Incoming Webhook URL |
| `discord-webhook-url` | No | Discord Webhook URL |
| `teams-webhook-url` | No | Microsoft Teams Incoming Webhook URL |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Current review status |
| `version` | Version string |
| `changed` | Whether status changed (`true`/`false`) |
| `issue-number` | Created issue number (if changed) |

## Notifications

### GitHub Issues (always enabled)

Status changes are tracked via labeled issues. Old status issues are auto-closed when status changes.

### Slack

Sends rich messages with color-coded attachments.

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace
2. Add the webhook URL as `SLACK_WEBHOOK` secret

### Discord

Sends embedded messages with status fields.

1. Go to your Discord channel > Settings > Integrations > Webhooks
2. Create a webhook and copy the URL
3. Add as `DISCORD_WEBHOOK` secret

### Microsoft Teams

Sends Adaptive Card messages.

1. In your Teams channel, add an Incoming Webhook connector
2. Copy the webhook URL
3. Add as `TEAMS_WEBHOOK` secret

## Status Notifications

| Status | Emoji | Color |
|--------|-------|-------|
| WAITING_FOR_REVIEW | 🕐 | Blue |
| IN_REVIEW | 🔍 | Blue |
| REJECTED | 🚨 | Red |
| READY_FOR_DISTRIBUTION | 🎉 | Green |
| PROCESSING_FOR_DISTRIBUTION | ⏳ | Blue |
| PENDING_DEVELOPER_RELEASE | 📦 | Blue |

## Setup

### 1. Create App Store Connect API Key

1. Go to [App Store Connect > Users and Access > Integrations > Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a new API key
3. Download the `.p8` file

### 2. Add GitHub Secrets

```bash
gh secret set ASC_KEY_ID --body "YOUR_KEY_ID"
gh secret set ASC_ISSUER_ID --body "YOUR_ISSUER_ID"
gh secret set ASC_PRIVATE_KEY < AuthKey_XXXXXXXX.p8
gh secret set APP_STORE_APP_ID --body "YOUR_APP_ID"
# Optional
gh secret set SLACK_WEBHOOK --body "https://hooks.slack.com/services/..."
gh secret set DISCORD_WEBHOOK --body "https://discord.com/api/webhooks/..."
gh secret set TEAMS_WEBHOOK --body "https://outlook.office.com/webhook/..."
```

### 3. Find Your App ID

Your App ID can be found in the App Store Connect URL:
`https://appstoreconnect.apple.com/apps/XXXXXXXXXX/appstore`

## Chaining with Other Actions

Use outputs to trigger additional actions:

```yaml
- uses: hakaru/appstore-review-monitor@v1
  id: review
  with:
    app-id: ${{ secrets.APP_STORE_APP_ID }}
    asc-key-id: ${{ secrets.ASC_KEY_ID }}
    asc-issuer-id: ${{ secrets.ASC_ISSUER_ID }}
    asc-private-key: ${{ secrets.ASC_PRIVATE_KEY }}

- if: steps.review.outputs.status == 'READY_FOR_DISTRIBUTION'
  run: echo "App approved! 🎉"

- if: contains(steps.review.outputs.status, 'REJECTED')
  run: echo "App rejected. Check issue #${{ steps.review.outputs.issue-number }}"
```

## License

MIT
