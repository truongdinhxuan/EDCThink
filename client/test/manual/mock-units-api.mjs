import { createServer } from 'node:http';

const now = '2026-09-02T00:00:00.000Z';
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
let units = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SET',
    symbol: 'SET',
    name: 'Bộ',
    description: 'Đơn vị kiểm thử',
    is_active: true,
    is_deleted: false,
    created_at: now,
    updated_at: now,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'EA',
    symbol: 'EA',
    name: 'Cái',
    description: null,
    is_active: true,
    is_deleted: false,
    created_at: now,
    updated_at: now,
  },
  ...Array.from({ length: 23 }, (_, index) => ({
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    code: `U${String(index + 1).padStart(3, '0')}`,
    symbol: `U${index + 1}`,
    name: `Đơn vị ${index + 1}`,
    description: null,
    is_active: true,
    is_deleted: false,
    created_at: now,
    updated_at: now,
  })),
];

const user = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'units@example.test',
  publicData: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    vinfast_id: '900001',
    email: 'units@example.test',
    phone_number: null,
    avatar_url: null,
    role_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    area_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    managed_by_user_id: null,
    is_active: true,
    is_verified: true,
    is_deleted: false,
    created_at: now,
    updated_at: now,
    first_name: 'Units',
    last_name: 'Tester',
    role: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      code: 'ADMIN',
      name: 'Administrator',
      is_active: true,
      is_deleted: false,
    },
    roles: [],
    area: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      code: 'TEST',
      name: 'Test Area',
    },
  },
  permissions: [
    'supply.catalog.read',
    'supply.catalog.create',
    'supply.catalog.update',
    'supply.catalog.delete',
  ],
  isSystemAdmin: false,
};

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Origin': response.req.headers.origin ?? '*',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:3000');
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
    });
    response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/auth/login') {
    sendJson(response, 200, { ...user, token: 'units-test-token' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/auth/me') {
    sendJson(response, 200, user);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/notifications') {
    sendJson(response, 200, {
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/notifications/stream') {
    response.writeHead(200, {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    response.write(': connected\n\n');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/units') {
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const isActive = url.searchParams.get('isActive');
    const filtered = units.filter((unit) => (
      (!search || `${unit.code} ${unit.symbol} ${unit.name}`.toLowerCase().includes(search))
      && (isActive === null || String(unit.is_active) === isActive)
    ));
    const from = (page - 1) * pageSize;
    const data = filtered.slice(from, from + pageSize);
    const totalPages = Math.ceil(filtered.length / pageSize);
    sendJson(response, 200, {
      data,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/units') {
    const input = await readJson(request);
    if (units.some((unit) => unit.code === input.code)) {
      sendJson(response, 409, { error: 'Mã đơn vị đã tồn tại.' });
      return;
    }
    const created = {
      ...input,
      id: crypto.randomUUID(),
      description: input.description ?? null,
      is_active: input.is_active ?? true,
      is_deleted: false,
      created_at: now,
      updated_at: now,
    };
    units = [...units, created];
    sendJson(response, 201, { message: 'Created', data: created });
    return;
  }

  const unitMatch = url.pathname.match(/^\/units\/([^/]+)$/);
  if (unitMatch && request.method === 'PATCH') {
    const input = await readJson(request);
    const current = units.find((unit) => unit.id === unitMatch[1]);
    if (!current) {
      sendJson(response, 404, { error: 'Không tìm thấy đơn vị.' });
      return;
    }
    const updated = { ...current, ...input, updated_at: now };
    units = units.map((unit) => unit.id === updated.id ? updated : unit);
    sendJson(response, 200, { message: 'Updated', data: updated });
    return;
  }
  if (unitMatch && request.method === 'DELETE') {
    const current = units.find((unit) => unit.id === unitMatch[1]);
    if (!current) {
      sendJson(response, 404, { error: 'Không tìm thấy đơn vị.' });
      return;
    }
    if (current.code === 'SET') {
      sendJson(response, 409, { error: 'Đơn vị đang được sử dụng.' });
      return;
    }
    const updated = { ...current, is_active: false, updated_at: now };
    units = units.map((unit) => unit.id === updated.id ? updated : unit);
    sendJson(response, 200, { message: 'Deactivated', data: updated });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(`Units mock API listening at http://127.0.0.1:${port}`);
});
