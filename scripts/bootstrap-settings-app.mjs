#!/usr/bin/env node
// Create the GitHub App that applies .github/repository-settings.yml, and store
// its credentials in the repo-settings environment.
//
// Usage: node scripts/bootstrap-settings-app.mjs [--code CODE]
//
// The desired state is: the repo-settings environment holds the variable
// SETTINGS_APP_CLIENT_ID and the secret SETTINGS_APP_PRIVATE_KEY, and the app is
// installed on this repository. The script checks that state first, so running
// it again is safe:
//
//   - both present: does nothing.
//   - only one present: stops with guidance instead of creating a second app.
//   - neither present: creates the app from a manifest, stores both, then waits
//     until the app is installed on this repository.
//
// GitHub requires two clicks in the browser, which cannot be automated:
// "Create GitHub App" and "Install". The private key is passed straight from
// GitHub's response to `gh secret set` and never written to disk.
//
// --code CODE resumes after the browser step, with the code from the
// ?code= query of the page GitHub redirected to. A code is valid for one hour.
//
// Requires Node.js 22+ and gh, logged in as an admin of the repository.
// https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';

const ENVIRONMENT = 'repo-settings';
const CLIENT_ID_VARIABLE = 'SETTINGS_APP_CLIENT_ID';
const PRIVATE_KEY_SECRET = 'SETTINGS_APP_PRIVATE_KEY';
const API = 'https://api.github.com';

function gh(args, input) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function names(path, key) {
  return JSON.parse(gh(['api', path, '--jq', `[.${key}[].name]`]));
}

function openInBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  console.log(`Opened ${url}`);
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Serve a page that POSTs the manifest to GitHub, and wait for GitHub to
// redirect back with ?code=...&state=...
async function codeFromBrowser(repo) {
  const state = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        const { port } = server.address();
        const manifest = JSON.stringify({
          name: `${repo.split('/')[0].toLowerCase()}-aitranslate-settings`,
          url: `https://github.com/${repo}`,
          description: `Applies .github/repository-settings.yml to ${repo}.`,
          public: false,
          redirect_url: `http://127.0.0.1:${port}/callback`,
          default_permissions: { administration: 'write' },
          default_events: [],
        });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Create settings app</title>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<p>Sending the app manifest to GitHub...</p><noscript><button>Continue</button></noscript>
</form><script>document.getElementById('f').submit()</script>`);
        return;
      }
      if (url.pathname === '/callback') {
        const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(ok ? 'App created. You can close this tab and return to the terminal.' : 'State mismatch.');
        server.close();
        ok ? resolve(url.searchParams.get('code')) : reject(new Error('state mismatch in callback'));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => openInBrowser(`http://127.0.0.1:${server.address().port}/`));
  });
}

async function convert(code) {
  const res = await fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json' },
  });
  if (res.status !== 201) throw new Error(`manifest conversion failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function appJwt(clientId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: clientId })}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pem).toString('base64url')}`;
}

async function waitForInstallation(repo, clientId, pem) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const res = await fetch(`${API}/repos/${repo}/installation`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${appJwt(clientId, pem)}` },
    });
    if (res.status === 200) return (await res.json()).permissions;
    if (res.status !== 404) throw new Error(`installation check failed: ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('the app was not installed on the repository within 10 minutes');
}

async function main() {
  const codeIndex = process.argv.indexOf('--code');
  const code = codeIndex === -1 ? undefined : process.argv[codeIndex + 1];
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const envPath = `repos/${repo}/environments/${ENVIRONMENT}`;

  // Desired state check. A missing environment fails here with gh's error.
  const hasClientId = names(`${envPath}/variables`, 'variables').includes(CLIENT_ID_VARIABLE);
  const hasKey = names(`${envPath}/secrets`, 'secrets').includes(PRIVATE_KEY_SECRET);
  if (hasClientId && hasKey) {
    console.log(`Nothing to do: ${ENVIRONMENT} already has ${CLIENT_ID_VARIABLE} and ${PRIVATE_KEY_SECRET}.`);
    return;
  }
  if (hasClientId !== hasKey) {
    const missing = hasClientId ? PRIVATE_KEY_SECRET : CLIENT_ID_VARIABLE;
    console.error(`Partial setup: ${ENVIRONMENT} is missing only ${missing}. Not creating a second app.`);
    console.error(hasClientId
      ? `Generate a private key on the app's settings page, then run:\n  gh secret set ${PRIVATE_KEY_SECRET} --env ${ENVIRONMENT} --repo ${repo} < KEY.pem`
      : `Copy the Client ID from the app's settings page, then run:\n  gh variable set ${CLIENT_ID_VARIABLE} --env ${ENVIRONMENT} --repo ${repo} --body CLIENT_ID`);
    process.exitCode = 1;
    return;
  }

  const app = await convert(code ?? (await codeFromBrowser(repo)));
  console.log(`Created app ${app.slug} (${app.html_url}).`);
  // Store the key first: if storing the Client ID then fails, the next run
  // reports the partial state instead of creating another app.
  gh(['secret', 'set', PRIVATE_KEY_SECRET, '--env', ENVIRONMENT, '--repo', repo], app.pem);
  gh(['variable', 'set', CLIENT_ID_VARIABLE, '--env', ENVIRONMENT, '--repo', repo, '--body', app.client_id]);
  console.log(`Stored ${CLIENT_ID_VARIABLE} and ${PRIVATE_KEY_SECRET} in ${ENVIRONMENT}.`);

  console.log(`Install the app on ${repo} only ("Only select repositories"). Waiting up to 10 minutes...`);
  openInBrowser(`https://github.com/apps/${app.slug}/installations/new`);
  const permissions = await waitForInstallation(repo, app.client_id, app.pem);
  console.log(`Installed on ${repo} with permissions ${JSON.stringify(permissions)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
