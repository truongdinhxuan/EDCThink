import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('src/pages/management/TeamsWebhookPage.tsx');
const navigation = read('src/constants/workspaceNavigation.ts');
const routes = read('src/routes/workspace.routes.tsx');
const permissions = read('src/constants/permissions.ts');
const api = read('src/api/teams-webhooks.service.ts');
const types = read('src/types/teams-webhooks.ts');

describe('Teams Webhook admin page', () => {
  it('uses the teams_webhook permissions from the server', () => {
    assert.match(permissions, /TEAMS_WEBHOOK_VIEW: 'teams_webhook\.view'/);
    assert.match(permissions, /TEAMS_WEBHOOK_MANAGE: 'teams_webhook\.manage'/);
  });

  it('shows the menu and the route only with teams_webhook.view', () => {
    assert.match(navigation, /path: 'teams-webhook'[^}]*permission: PERMISSION_CODE\.TEAMS_WEBHOOK_VIEW/);
    assert.match(routes, /path: 'teams-webhook', element: guarded\(\[PERMISSION_CODE\.TEAMS_WEBHOOK_VIEW\]/);
  });

  it('renders one card per row from the API, with no hardcoded function', () => {
    assert.match(page, /webhooksQuery\.data\.map\(\(webhook\) => \(\s*<WebhookCard key=\{webhook\.code\}/);
    assert.doesNotMatch(page, /ORDER_STATUS_CHANGED/);
  });

  it('shows only title, switch, test button and last send on each card', () => {
    assert.match(page, /\{webhook\.title\}/);
    assert.match(page, /<Toggle/);
    assert.match(page, /'Đang gửi…' : 'Gửi thử'/);
    assert.match(page, /Lần gửi gần nhất:/);
    assert.match(page, /Chưa gửi/);
    assert.match(page, /timeZone: 'Asia\/Bangkok'/);
    assert.match(page, /<AppTooltip content=\{webhook\.last_error/);
    assert.doesNotMatch(page, /DataTable|Nhật ký/);
  });

  it('locks switch and test without teams_webhook.manage or without a Vault secret', () => {
    assert.match(page, /const canManage = hasPermission\(PERMISSION_CODE\.TEAMS_WEBHOOK_MANAGE\)/);
    assert.match(page, /const locked = !canManage \|\| !webhook\.configured \|\| busy;/);
    assert.equal((page.match(/disabled=\{locked\}/g) ?? []).length, 2);
    // Saving a URL is how an unconfigured card gets configured, so it is not locked by `configured`.
    assert.match(page, /disabled=\{busy \|\| !urlInput\.trim\(\)\}/);
    assert.match(page, /Chưa cấu hình URL trong Supabase/);
  });

  it('takes the Workflow URL write-only, like a password, and never shows one', () => {
    assert.match(page, /type="password"/);
    assert.match(page, /autoComplete="off"/);
    assert.match(page, /\{canManage && \(\s*<form onSubmit=\{submitUrl\}/);
    assert.match(page, /onSuccess: async \(\) => \{\s*setUrlInput\(''\);/);
    // The API model has no URL field, so nothing can render one.
    assert.doesNotMatch(types, /^\s*\w*url\w*\??:/im);
    assert.doesNotMatch(page, /webhook\.(webhook_url|masked_url|url)/);
    assert.equal(existsSync(resolve(process.cwd(), 'src/api/teams-workflows.service.ts')), false);
  });

  it('calls the documented endpoints', () => {
    assert.match(api, /'teams-webhooks'/);
    assert.match(api, /instance\.patch<[^>]+>[^(]*\(\s*`teams-webhooks\/\$\{encodeURIComponent\(code\)\}`,\s*\{ is_active: isActive \}/);
    assert.match(api, /instance\.put<[^>]+>[^(]*\(\s*`teams-webhooks\/\$\{encodeURIComponent\(code\)\}\/url`,\s*\{ webhook_url: webhookUrl \}/);
    assert.match(api, /`teams-webhooks\/\$\{encodeURIComponent\(code\)\}\/test`/);
  });
});
