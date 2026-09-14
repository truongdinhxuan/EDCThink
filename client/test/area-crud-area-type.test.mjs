import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Area CRUD Area Type contract', () => {
  it('models and sends the nullable Area Type relationship', () => {
    const types = read('src/types/areas.ts');
    const form = read('src/components/forms/AreaForm.tsx');

    assert.match(types, /area_type_id: string \| null/);
    assert.match(types, /area_type: AreaTypeSummary \| null/);
    assert.match(types, /areaTypeId\?: string/);
    assert.match(form, /register\('area_type_id'/);
    assert.match(form, /Chưa phân loại/);
    assert.match(form, /areaType\.code.*areaType\.name/);
  });

  it('shows Area Type in the filter, table and detail drawer', () => {
    const page = read('src/pages/management/AreasPage.tsx');

    assert.match(page, /listAreaTypes/);
    assert.match(page, /queryKeys\.areaTypes\.all/);
    assert.match(page, /resource\.query\.areaTypeId/);
    assert.match(page, /header: 'Area Type'/);
    assert.match(page, /label: 'Area Type'/);
    assert.match(page, /queryKeys\.meAreaScopes\.all/);
  });
});
