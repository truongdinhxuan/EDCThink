import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Area CRUD Area Type contract', () => {
  const schema = read('src/schemas/master-data.ts');
  const interfaces = read('src/interfaces/master-data.ts');
  const service = read('src/services/areas.service.ts');
  const areaTypeRoute = read('src/routes/area-types/index.ts');

  it('accepts a nullable area_type_id without making legacy Areas invalid', () => {
    assert.match(schema, /area_type_id: \{ anyOf: \[uuid, \{ type: 'null' \}\] \}/);
    assert.match(interfaces, /area_type_id\?: string \| null/);
    assert.match(service, /area_type_id: body\.area_type_id \?\? null/);
    assert.match(service, /body\.area_type_id !== undefined/);
  });

  it('validates a selected Area Type as active and not deleted', () => {
    assert.match(service, /assertActiveAreaType/);
    assert.match(service, /\.from\('area_types'\)[\s\S]*?\.eq\('is_active', true\)[\s\S]*?\.eq\('is_deleted', false\)/);
    assert.match(service, /area_type_id không tồn tại hoặc không active/);
  });

  it('allows either Role readers or Area readers to load the shared lookup', () => {
    assert.match(areaTypeRoute, /anyOf:/);
    assert.match(areaTypeRoute, /ADMIN_ROLE_READ/);
    assert.match(areaTypeRoute, /SUPPLY_AREA_READ/);
  });
});
