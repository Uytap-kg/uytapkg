import test from "node:test";
import assert from "node:assert/strict";
import { canShowPublicPhone, getPublicPhone } from "../src/utils/publicContact.js";

// Мок query builder: записывает все вызовы фильтров, чтобы проверить, что
// контроллер фильтрует именно риэлторов-не-админов с подтверждённым контактом.
function makeChain(result, calls) {
  const chain = {};
  for (const method of ["select", "eq", "or", "order", "in"]) {
    chain[method] = (...args) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.range = async (...args) => {
    calls.push(["range", ...args]);
    return result;
  };
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("publicContact: бизнес-аккаунту телефон показывается, personal — только при show_phone === true", () => {
  for (const type of ["realtor", "agency", "developer"]) {
    assert.equal(canShowPublicPhone({ account_type: type, show_phone: false }), true, type);
  }
  assert.equal(getPublicPhone({ account_type: "personal", phone: "+996555000111", show_phone: false }), null);
  assert.equal(getPublicPhone({ account_type: "personal", phone: "+996555000111" }), null);
  assert.equal(
    getPublicPhone({ account_type: "personal", phone: "+996555000111", show_phone: true }),
    "+996555000111"
  );
  assert.equal(getPublicPhone(null), null);
});

test("GET /api/realtors: фильтрует риэлторов, отдаёт только витринные поля без PII", async () => {
  const { supabase } = await import("../src/config/db.js");
  const { getRealtors } = await import("../src/controllers/realtorsController.js");

  const origFrom = supabase.from;
  const userCalls = [];
  const profileCalls = [];
  try {
    supabase.from = (table) => {
      if (table === "users") {
        return makeChain(
          {
            data: [
              {
                id: "r-1",
                account_type: "realtor",
                phone: "+996700112233",
                show_phone: false,
                is_verified: true,
                created_at: "2026-01-01T00:00:00.000Z",
                // Поля, которые не должны утечь, даже если БД их вернёт
                email: "secret@mail.kg",
                password_hash: "hash",
                role: "user",
              },
              {
                id: "r-2",
                account_type: "realtor",
                phone: "+996700445566",
                is_verified: false,
                created_at: "2026-01-02T00:00:00.000Z",
              },
            ],
            error: null,
            count: 30,
          },
          userCalls
        );
      }
      if (table === "user_profiles") {
        return makeChain(
          {
            data: [
              {
                user_id: "r-1",
                first_name: "Азамат",
                last_name: "Касымов",
                company_name: "Azamat Realty",
                avatar_url: "https://cdn.example/a.png",
                inn: "999888777666",
              },
            ],
            error: null,
          },
          profileCalls
        );
      }
      throw new Error("Unexpected table: " + table);
    };

    const res = makeRes();
    await getRealtors({ query: { page: "2", limit: "10" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.pagination, { page: 2, limit: 10, total: 30, hasMore: true });

    // Фильтры запроса
    assert.ok(userCalls.some((c) => c[0] === "eq" && c[1] === "account_type" && c[2] === "realtor"));
    assert.ok(userCalls.some((c) => c[0] === "eq" && c[1] === "role" && c[2] === "user"), "Админы не должны попадать в каталог");
    assert.ok(
      userCalls.some((c) => c[0] === "or" && c[1] === "is_email_verified.eq.true,is_verified.eq.true"),
      "Неподтверждённые аккаунты не должны попадать в каталог"
    );
    assert.ok(userCalls.some((c) => c[0] === "range" && c[1] === 10 && c[2] === 19));
    const userSelect = userCalls.find((c) => c[0] === "select")[1];
    assert.ok(!/email|password|inn|role/.test(userSelect), "В select не должно быть приватных колонок");
    const profileSelect = profileCalls.find((c) => c[0] === "select")[1];
    assert.ok(!/inn|about/.test(profileSelect), "ИНН и about (с документами верификации) не запрашиваются");

    const [first, second] = res.body.data;
    assert.deepEqual(first, {
      id: "r-1",
      firstName: "Азамат",
      lastName: "Касымов",
      companyName: "Azamat Realty",
      avatarUrl: "https://cdn.example/a.png",
      phone: "+996700112233",
      isVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    // Риэлтор без профиля — пустые поля, без падения
    assert.equal(second.firstName, "");
    assert.equal(second.avatarUrl, null);
    assert.equal(second.isVerified, false);
  } finally {
    supabase.from = origFrom;
  }
});

test("GET /api/realtors: limit ограничен 50, мусорные параметры → значения по умолчанию", async () => {
  const { supabase } = await import("../src/config/db.js");
  const { getRealtors } = await import("../src/controllers/realtorsController.js");

  const origFrom = supabase.from;
  const calls = [];
  try {
    supabase.from = (table) => {
      if (table === "users") return makeChain({ data: [], error: null, count: 0 }, calls);
      throw new Error("Профили не должны запрашиваться для пустой страницы: " + table);
    };

    const res = makeRes();
    await getRealtors({ query: { page: "abc", limit: "100000" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);
    assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 0, hasMore: false });
    assert.ok(calls.some((c) => c[0] === "range" && c[1] === 0 && c[2] === 49));
  } finally {
    supabase.from = origFrom;
  }
});

test("GET /api/realtors: ошибка БД → 500 без деталей ошибки", async () => {
  const { supabase } = await import("../src/config/db.js");
  const { getRealtors } = await import("../src/controllers/realtorsController.js");

  const origFrom = supabase.from;
  try {
    supabase.from = () =>
      makeChain({ data: null, error: { message: "relation secret_table does not exist" }, count: null }, []);

    const res = makeRes();
    await getRealtors({ query: {}, id: "req-1" }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.ok(!JSON.stringify(res.body).includes("secret_table"));
  } finally {
    supabase.from = origFrom;
  }
});
