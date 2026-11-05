// Список пользователей в админ-панели (GET /api/admin/users).
// Проверяем: доступ только для админа, белый список полей (без password_hash),
// безопасный разбор поисковой строки (нельзя внедрить фильтр PostgREST),
// корректное применение фильтров и пагинации.
import test from "node:test";
import assert from "node:assert/strict";

import {
  listUsersAdmin,
  parseAdminUserSearch,
  buildAdminUserNameFilter,
} from "../src/controllers/adminController.js";
import adminRouter from "../src/routes/adminRoutes.js";
import { requireAdmin, authenticateToken } from "../src/middleware/auth.js";
import { supabase } from "../src/config/db.js";

function createRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
}

// Мок цепочки query builder supabase-js: записывает все вызовы.
function mockUsersTable(result) {
  const calls = [];
  const builder = {};
  for (const method of ["select", "eq", "gte", "ilike", "or", "order", "range"]) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);

  const origFrom = supabase.from;
  supabase.from = (table) => {
    if (table === "users") return builder;
    return origFrom.call(supabase, table);
  };
  return { calls, restore: () => (supabase.from = origFrom) };
}

test("GET /api/admin/users защищён authenticateToken + requireAdmin", () => {
  const layer = adminRouter.stack.find(
    (l) => l.route?.path === "/users" && l.route.methods.get
  );
  assert.ok(layer, "роут GET /users должен быть зарегистрирован");
  const handlers = layer.route.stack.map((s) => s.handle);
  assert.equal(handlers[0], authenticateToken);
  assert.equal(handlers[1], requireAdmin);
});

test("requireAdmin не пускает обычного пользователя", () => {
  const res = createRes();
  let nextCalled = false;
  requireAdmin({ user: { id: "u1", role: "user" } }, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("parseAdminUserSearch: телефон, email, имя и пустой ввод", () => {
  assert.deepEqual(parseAdminUserSearch(""), { type: "none" });
  assert.deepEqual(parseAdminUserSearch("+996 (555) 12-34"), { type: "phone", value: "9965551234" });
  assert.deepEqual(parseAdminUserSearch("55"), { type: "none" });
  assert.deepEqual(parseAdminUserSearch("Test_User@Mail.kg"), {
    type: "email",
    value: "test\\_user@mail.kg",
  });
  assert.deepEqual(parseAdminUserSearch("Иван  Петров"), { type: "name", words: ["Иван", "Петров"] });
});

test("parseAdminUserSearch: спецсимволы PostgREST вырезаются из поиска по имени", () => {
  const parsed = parseAdminUserSearch("a),role.eq.admin,(b*");
  assert.equal(parsed.type, "name");
  for (const word of parsed.words) {
    assert.match(word, /^[\p{L}\p{N}-]+$/u, `слово "${word}" содержит опасные символы`);
  }
  const filter = buildAdminUserNameFilter(parsed.words);
  assert.equal(filter.includes("role.eq"), false);
  assert.equal(parsed.words.length <= 3, true);
});

test("buildAdminUserNameFilter: одно слово — плоский or, несколько — and(or(...))", () => {
  assert.equal(
    buildAdminUserNameFilter(["Иван"]),
    "first_name.ilike.*Иван*,last_name.ilike.*Иван*,company_name.ilike.*Иван*"
  );
  assert.equal(
    buildAdminUserNameFilter(["a", "b"]),
    "and(or(first_name.ilike.*a*,last_name.ilike.*a*,company_name.ilike.*a*),or(first_name.ilike.*b*,last_name.ilike.*b*,company_name.ilike.*b*))"
  );
});

test("listUsersAdmin: отдаёт только белый список полей и пагинацию", async () => {
  const { calls, restore } = mockUsersTable({
    data: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "a@a.kg",
        phone: "996555000111",
        account_type: "personal",
        role: "user",
        is_verified: true,
        is_email_verified: false,
        created_at: "2026-11-01T10:00:00.000Z",
        password_hash: "$2b$10$secret",
        token_version: 3,
        user_profiles: { first_name: "Иван", last_name: "Петров", company_name: null },
      },
    ],
    error: null,
    count: 45,
  });

  try {
    const res = createRes();
    await listUsersAdmin({ query: { page: "2", limit: "20" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.pagination, { page: 2, limit: 20, total: 45, totalPages: 3 });

    const user = res.body.data[0];
    assert.equal(user.name, "Иван Петров");
    assert.equal(user.phone, "996555000111");
    assert.equal(user.accountType, "personal");
    assert.equal(user.createdAt, "2026-11-01T10:00:00.000Z");
    assert.equal("password_hash" in user, false);
    assert.equal("passwordHash" in user, false);
    assert.equal("token_version" in user, false);
    assert.equal(JSON.stringify(res.body).includes("secret"), false);

    const selectCall = calls.find((c) => c[0] === "select");
    assert.equal(selectCall[1].includes("password_hash"), false);
    assert.deepEqual(calls.find((c) => c[0] === "range"), ["range", 20, 39]);
    assert.deepEqual(calls.find((c) => c[0] === "order"), ["order", "created_at", { ascending: false }]);
  } finally {
    restore();
  }
});

test("listUsersAdmin: применяет фильтры типа аккаунта, периода и поиска", async () => {
  const { calls, restore } = mockUsersTable({ data: [], error: null, count: 0 });
  try {
    const res = createRes();
    const before = Date.now();
    await listUsersAdmin(
      { query: { accountType: "realtor", period: "30", search: "Иван" } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.find((c) => c[0] === "eq"), ["eq", "account_type", "realtor"]);

    const gte = calls.find((c) => c[0] === "gte");
    assert.equal(gte[1], "created_at");
    const diffDays = (before - new Date(gte[2]).getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diffDays - 30) < 0.01);

    const orCall = calls.find((c) => c[0] === "or");
    assert.deepEqual(orCall[2], { referencedTable: "user_profiles" });
    assert.ok(calls.find((c) => c[0] === "select")[1].includes("user_profiles!inner"));
  } finally {
    restore();
  }
});

test("listUsersAdmin: поиск по телефону идёт через ilike без .or()", async () => {
  const { calls, restore } = mockUsersTable({ data: [], error: null, count: 0 });
  try {
    await listUsersAdmin({ query: { search: "0555 123" } }, createRes());
    assert.deepEqual(calls.find((c) => c[0] === "ilike"), ["ilike", "phone", "%0555123%"]);
    assert.equal(calls.some((c) => c[0] === "or"), false);
  } finally {
    restore();
  }
});

test("listUsersAdmin: некорректные параметры → 400", async () => {
  for (const query of [{ limit: "1000" }, { page: "0" }, { period: "365" }, { accountType: "admin" }]) {
    const res = createRes();
    await listUsersAdmin({ query }, res);
    assert.equal(res.statusCode, 400, `ожидался 400 для ${JSON.stringify(query)}`);
    assert.equal(res.body.success, false);
  }
});

test("listUsersAdmin: ошибка БД → 500 без деталей ошибки", async () => {
  const { restore } = mockUsersTable({ data: null, error: { message: "db down: secret" }, count: null });
  try {
    const res = createRes();
    await listUsersAdmin({ query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.stringify(res.body).includes("secret"), false);
  } finally {
    restore();
  }
});
