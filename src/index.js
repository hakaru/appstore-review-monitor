import * as core from '@actions/core';
import * as github from '@actions/github';
import crypto from 'crypto';

const STATUS_EMOJI = {
  'WAITING_FOR_REVIEW': '\u{1F550}',
  'IN_REVIEW': '\u{1F50D}',
  'REJECTED': '\u{1F6A8}',
  'METADATA_REJECTED': '\u{1F6A8}',
  'READY_FOR_DISTRIBUTION': '\u{1F389}',
  'PROCESSING_FOR_DISTRIBUTION': '\u{23F3}',
  'PENDING_DEVELOPER_RELEASE': '\u{1F4E6}',
};

function generateJWT(keyId, issuerId, privateKey) {
  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    kid: keyId,
    typ: 'JWT'
  })).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: issuerId,
    iat: now,
    exp: now + 1200,
    aud: 'appstoreconnect-v1'
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const key = privateKey.replace(/\\n/g, '\n');
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(
    { key, dsaEncoding: 'ieee-p1363' },
    'base64url'
  );
  return `${signingInput}.${signature}`;
}

async function ascFetch(path, jwt) {
  const res = await fetch(
    `https://api.appstoreconnect.apple.com/v1${path}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App Store Connect API ${res.status}: ${body}`);
  }
  return res.json();
}

async function getLatestVersion(appId, jwt, versionId) {
  if (versionId) {
    const data = await ascFetch(`/appStoreVersions/${versionId}`, jwt);
    return data.data;
  }

  const data = await ascFetch(
    `/apps/${appId}?include=appStoreVersions&fields[appStoreVersions]=versionString,appStoreState,appVersionState,createdDate`,
    jwt
  );

  const versions = data.included || [];
  if (versions.length === 0) return null;

  return versions.sort((a, b) =>
    new Date(b.attributes.createdDate) - new Date(a.attributes.createdDate)
  )[0];
}

async function getRejectionDetails(versionId, appId, jwt) {
  let details = '';

  try {
    const reviewDetail = await ascFetch(
      `/appStoreVersions/${versionId}/appStoreReviewDetail`,
      jwt
    );
    const attrs = reviewDetail.data?.attributes;
    if (attrs) {
      details += '\n\n### Review Detail\n```json\n' +
        JSON.stringify(attrs, null, 2) + '\n```';
    }
  } catch (e) {
    core.warning(`Could not fetch review details: ${e.message}`);
  }

  try {
    const submissions = await ascFetch(
      `/reviewSubmissions?filter[app]=${appId}`,
      jwt
    );
    const unresolved = submissions.data?.find(
      s => s.attributes.state === 'UNRESOLVED_ISSUES'
    );
    if (unresolved) {
      details += `\n\n### Submission\n- ID: \`${unresolved.id}\`\n- State: \`${unresolved.attributes.state}\``;
    }
  } catch (e) {
    core.warning(`Could not fetch submissions: ${e.message}`);
  }

  details += '\n\n### Next Steps\n' +
    '1. Check rejection reason in App Store Connect Resolution Center\n' +
    '2. Fix the issues\n' +
    '3. Resubmit for review';

  return details;
}

// --- Notification helpers ---

async function notifySlack(webhookUrl, { title, emoji, versionString, previousStatus, currentStatus, isRejected, issueUrl }) {
  const color = isRejected ? '#dc3545' : currentStatus === 'READY_FOR_DISTRIBUTION' ? '#28a745' : '#0969da';
  const payload = {
    attachments: [{
      color,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${title}*\n\n` +
              `*Version:* ${versionString}\n` +
              `*Previous:* ${previousStatus ?? 'N/A'}\n` +
              `*Current:* ${currentStatus}\n` +
              (issueUrl ? `*Issue:* <${issueUrl}|View on GitHub>` : '')
          }
        }
      ]
    }]
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
  core.info('Slack notification sent');
}

async function notifyDiscord(webhookUrl, { title, emoji, versionString, previousStatus, currentStatus, isRejected, issueUrl }) {
  const color = isRejected ? 0xdc3545 : currentStatus === 'READY_FOR_DISTRIBUTION' ? 0x28a745 : 0x0969da;
  const payload = {
    embeds: [{
      title: `${emoji} ${title}`,
      color,
      fields: [
        { name: 'Version', value: versionString, inline: true },
        { name: 'Previous', value: previousStatus ?? 'N/A', inline: true },
        { name: 'Current', value: currentStatus, inline: true },
      ],
      url: issueUrl || undefined,
      timestamp: new Date().toISOString()
    }]
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Discord webhook ${res.status}: ${await res.text()}`);
  core.info('Discord notification sent');
}

async function notifyTeams(webhookUrl, { title, emoji, versionString, previousStatus, currentStatus, isRejected, issueUrl }) {
  const color = isRejected ? 'attention' : currentStatus === 'READY_FOR_DISTRIBUTION' ? 'good' : 'default';
  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: `${emoji} ${title}`,
            weight: 'bolder',
            size: 'medium',
            style: color
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Version', value: versionString },
              { title: 'Previous', value: previousStatus ?? 'N/A' },
              { title: 'Current', value: currentStatus },
            ]
          }
        ],
        actions: issueUrl ? [{
          type: 'Action.OpenUrl',
          title: 'View on GitHub',
          url: issueUrl
        }] : []
      }
    }]
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Teams webhook ${res.status}: ${await res.text()}`);
  core.info('Teams notification sent');
}

// --- Main ---

async function run() {
  try {
    const appId = core.getInput('app-id', { required: true });
    const keyId = core.getInput('asc-key-id', { required: true });
    const issuerId = core.getInput('asc-issuer-id', { required: true });
    const privateKey = core.getInput('asc-private-key', { required: true });
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN;
    const issueLabel = core.getInput('issue-label') || 'asc-monitor';
    const versionId = core.getInput('version-id') || '';
    const slackWebhookUrl = core.getInput('slack-webhook-url') || '';
    const discordWebhookUrl = core.getInput('discord-webhook-url') || '';
    const teamsWebhookUrl = core.getInput('teams-webhook-url') || '';

    const jwt = generateJWT(keyId, issuerId, privateKey);
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Get version status
    const version = await getLatestVersion(appId, jwt, versionId || null);
    if (!version) {
      core.info('No app store versions found.');
      core.setOutput('status', 'NONE');
      core.setOutput('changed', 'false');
      return;
    }

    const currentStatus = version.attributes.appStoreState;
    const versionString = version.attributes.versionString || 'unknown';
    const currentVersionId = version.id;

    core.info(`Version: ${versionString}, Status: ${currentStatus}`);
    core.setOutput('status', currentStatus);
    core.setOutput('version', versionString);

    // Check previous status from cache issue
    const { data: cacheIssues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      labels: issueLabel,
      state: 'open',
      per_page: 1
    });

    const cacheIssue = cacheIssues[0];
    const previousStatus = cacheIssue?.body?.match(/\*\*Current Status:\*\* `(.+?)`/)?.[1] ?? null;

    if (previousStatus === currentStatus) {
      core.info(`Status unchanged: ${currentStatus}`);
      core.setOutput('changed', 'false');
      return;
    }

    core.info(`Status changed: ${previousStatus ?? '(first run)'} -> ${currentStatus}`);
    core.setOutput('changed', 'true');

    // Gather rejection details
    const isRejected = currentStatus?.includes('REJECTED');
    let rejectionBody = '';
    if (isRejected) {
      rejectionBody = await getRejectionDetails(currentVersionId, appId, jwt);
    }

    // Close old cache issue
    if (cacheIssue) {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: cacheIssue.number,
        state: 'closed'
      });
    }

    // Create status issue
    const emoji = STATUS_EMOJI[currentStatus] ?? '\u{1F4CB}';
    let title;
    if (isRejected) {
      title = `${emoji} App Store Review REJECTED - v${versionString}`;
    } else if (currentStatus === 'READY_FOR_DISTRIBUTION') {
      title = `${emoji} App Store Review APPROVED - v${versionString}`;
    } else {
      title = `${emoji} App Store Review: ${currentStatus} - v${versionString}`;
    }

    const labels = [issueLabel];
    if (isRejected) labels.push('review-rejected');
    if (currentStatus === 'READY_FOR_DISTRIBUTION') labels.push('review-approved');

    const { data: newIssue } = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: [
        '## App Store Review Status Update',
        '',
        `- **App ID:** \`${appId}\``,
        `- **Version:** \`${versionString}\``,
        `- **Previous Status:** \`${previousStatus ?? 'N/A'}\``,
        `- **Current Status:** \`${currentStatus}\``,
        `- **Detected at:** ${new Date().toISOString()}`,
        rejectionBody
      ].join('\n'),
      labels
    });

    const issueUrl = newIssue.html_url;
    core.info(`Created issue #${newIssue.number}: ${title}`);
    core.setOutput('issue-number', String(newIssue.number));

    // Send notifications to external services
    const notifyContext = { title, emoji, versionString, previousStatus, currentStatus, isRejected, issueUrl };

    if (slackWebhookUrl) {
      try { await notifySlack(slackWebhookUrl, notifyContext); }
      catch (e) { core.warning(`Slack notification failed: ${e.message}`); }
    }

    if (discordWebhookUrl) {
      try { await notifyDiscord(discordWebhookUrl, notifyContext); }
      catch (e) { core.warning(`Discord notification failed: ${e.message}`); }
    }

    if (teamsWebhookUrl) {
      try { await notifyTeams(teamsWebhookUrl, notifyContext); }
      catch (e) { core.warning(`Teams notification failed: ${e.message}`); }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
