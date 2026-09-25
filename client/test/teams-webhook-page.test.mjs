import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('src/pages/management/TeamsWebhookPage.tsx');
const navigation = read('src/constants/workspaceNavigation.ts');
const routes = read('src/routes/workspace.routes.tsx');
const permissions = read('src/constants/permissions.ts');
const api = read('src/api/teams-workflows.service.ts');

describe('Teams Webhook admin page', () => {
  it('uses the teams_webhook permissions from the server', () => {
    assert.match(permissions, /TEAMS_WEBHOOK_VIEW: 'teams_webhook\.view'/);
    assert.match(permissions, /TEAMS_WEBHOOK_MANAGE: 'teams_webhook\.manage'/);
  });

  it('shows the menu and the route only with teams_webhook.view', () => {
    assert.match(navigation, /path: 'teams-webhook'[^}]*permission: PERMISSION_CODE\.TEAMS_WEBHOOK_VIEW/);
    assert.match(routes, /path: 'teams-webhook', element: guarded\(\[PERMISSION_CODE\.TEAMS_WEBHOOK_VIEW\]/);
  });

  it('lets only teams_webhook.manage edit, test or retry', () => {
    assert.match(page, /const canManage = hasPermission\(PERMISSION_CODE\.TEAMS_WEBHOOK_MANAGE\)/);
    assert.match(page, /\{canManage && \(\s*<div className="flex flex-wrap gap-2">/);
    assert.match(page, /canManage && item\.status === 'FAILED'/);
    assert.match(page, /disabled=\{!canManage \|\| busy \|\|/);
  });

  it('keeps the URL in the server .env: shows only the variable name and a masked value', () => {
    assert.match(page, /\{workflow\.url_env_key\}=\{workflow\.has_url \? workflow\.masked_url : '…'\}/);
    assert.doesNotMatch(page, /webhook_url|type="password"/);
    assert.match(page, /saveTeamsWorkflow\(workflow\.function_code, \{ is_active: isActive \}\)/);
    // Switching on needs a usable URL; switching off never does.
    assert.match(page, /disabled=\{!canManage \|\| busy \|\| \(!isActive && !urlReady\)\}/);
  });

  it('calls the documented endpoints', () => {
    for (const endpoint of [
      /'teams-workflows'/,
      /`teams-workflows\/\$\{encodeURIComponent\(functionCode\)\}`/,
      /`teams-workflows\/\$\{encodeURIComponent\(functionCode\)\}\/test`/,
      /'teams-workflows\/deliveries'/,
      /`teams-workflows\/deliveries\/\$\{id\}\/retry`/,
    ]) assert.match(api, endpoint);
  });
});
