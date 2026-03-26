# App Store Review Monitor

A GitHub Action that monitors your App Store Connect review status and creates GitHub Issues on status changes.

## Features

- Checks App Store Connect review status on a schedule
- Creates GitHub Issues when status changes
- Detailed rejection information when app is rejected
- Status emoji for quick visual scanning
- Tracks previous status via issue labels (no external storage needed)

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
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `app-id` | Yes | App Store Connect App ID |
| `asc-key-id` | Yes | API Key ID |
| `asc-issuer-id` | Yes | Issuer ID |
| `asc-private-key` | Yes | `.p8` private key contents |
| `github-token` | No | GitHub token (defaults to `${{ github.token }}`) |
| `issue-label` | No | Label for cache issues (default: `asc-monitor`) |
| `version-id` | No | Specific version ID to monitor (defaults to latest) |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Current review status |
| `version` | Version string |
| `changed` | Whether status changed (`true`/`false`) |
| `issue-number` | Created issue number (if changed) |

## Status Notifications

| Status | Issue Title |
|--------|------------|
| 🕐 WAITING_FOR_REVIEW | App Store Review: WAITING_FOR_REVIEW |
| 🔍 IN_REVIEW | App Store Review: IN_REVIEW |
| 🚨 REJECTED | App Store Review REJECTED |
| 🎉 READY_FOR_DISTRIBUTION | App Store Review APPROVED |

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
