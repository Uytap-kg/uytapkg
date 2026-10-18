import test from "node:test";
import assert from "node:assert/strict";
import { register } from "../src/controllers/authController.js";
import { supabase } from "../src/config/db.js";

/**
 * Вспомогательный хелпер для создания мока Express req и res
 */
function createMockReqRes(body = {}) {
  const req = {
    body,
    headers: {},
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return { req, res };
}

test("Register A-2: Занятый подтверждённый email возвращает 409 Conflict и не вызывает RPC", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  let rpcCalled = false;
  supabase.rpc = async () => {
    rpcCalled = true;
    return { data: null, error: null };
  };

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "user-1", is_email_verified: true, created_at: new Date().toISOString() },
              error: null,
            }),
          }),
        }),
      };
    }
    return origFrom.call(supabase, table);
  };

  try {
    const { req, res } = createMockReqRes({
      accountType: "personal",
      email: "verified-user@uytap.kg",
      phone: "+996555123456",
      password: "StrongPassword123!",
      firstName: "Test",
      lastName: "User",
    });

    await register(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Пользователь с таким Email уже зарегистрирован");
    assert.equal(rpcCalled, false, "RPC не должен вызываться при конфликте");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Register A-2: Сбой в RPC register_user возвращает 500 и не завершает регистрацию", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }
    return origFrom.call(supabase, table);
  };

  let rpcParams = null;
  supabase.rpc = async (fnName, params) => {
    if (fnName === "register_user") {
      rpcParams = params;
      return { data: null, error: { message: "DB transaction rollback: profiles foreign key violation" } };
    }
    return { data: null, error: null };
  };

  try {
    const { req, res } = createMockReqRes({
      accountType: "personal",
      email: "new-user-fail@uytap.kg",
      phone: "+996555778899",
      password: "StrongPassword123!",
      firstName: "Failed",
      lastName: "Registration",
    });

    await register(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.ok(rpcParams, "RPC register_user должен был быть вызван");
    assert.equal(rpcParams.p_email, "new-user-fail@uytap.kg");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Register A-2: Успешная регистрация вызывает RPC register_user и возвращает 201 с needVerification: true", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }
    if (table === "email_verifications") {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }),
        insert: async () => ({ error: null }),
        select: () => {
          const createQuery = () => {
            const p = Promise.resolve({ data: [], count: 0, error: null });
            p.eq = () => createQuery();
            p.gte = () => createQuery();
            p.order = () => createQuery();
            return p;
          };
          return createQuery();
        },
      };
    }
    return origFrom.call(supabase, table);
  };

  let rpcCalledWith = null;
  supabase.rpc = async (fnName, params) => {
    if (fnName === "register_user") {
      rpcCalledWith = params;
      return { data: "new-uuid-12345", error: null };
    }
    return { data: null, error: null };
  };

  try {
    const { req, res } = createMockReqRes({
      accountType: "developer",
      email: "developer-brand@uytap.kg",
      phone: "+996777123456",
      password: "StrongPassword123!",
      companyName: "Elite House",
      inn: "01234567890123",
      officeAddress: "ул. Киевская 1",
    });

    await register(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.needVerification, true);
    assert.equal(res.body.email, "developer-brand@uytap.kg");

    assert.ok(rpcCalledWith, "RPC register_user должен быть вызван");
    assert.equal(rpcCalledWith.p_account_type, "developer");
    assert.equal(rpcCalledWith.p_email, "developer-brand@uytap.kg");
    assert.equal(rpcCalledWith.p_phone, "+996777123456");
    assert.equal(rpcCalledWith.p_profile_data.company_name, "Elite House");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});

test("Register A-2: Перерегистрация unverified email вызывает reclaim_unverified_user и возвращает 200", async () => {
  const origFrom = supabase.from;
  const origRpc = supabase.rpc;

  supabase.from = (table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "existing-unverified-uuid", is_email_verified: false },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "email_verifications") {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }),
        insert: async () => ({ error: null }),
        select: () => {
          const createQuery = () => {
            const p = Promise.resolve({ data: [], count: 0, error: null });
            p.eq = () => createQuery();
            p.gte = () => createQuery();
            p.order = () => createQuery();
            return p;
          };
          return createQuery();
        },
      };
    }
    return origFrom.call(supabase, table);
  };

  let reclaimCalledWith = null;
  supabase.rpc = async (fnName, params) => {
    if (fnName === "reclaim_unverified_user") {
      reclaimCalledWith = params;
      return { data: "existing-unverified-uuid", error: null };
    }
    return { data: null, error: null };
  };

  try {
    const { req, res } = createMockReqRes({
      accountType: "realtor",
      email: "unverified-agent@uytap.kg",
      phone: "+996500998877",
      password: "NewPassword123!",
      fullName: "Азамат Азаматов",
      agencyName: "Top Agency",
    });

    await register(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.needVerification, true);
    assert.equal(res.body.email, "unverified-agent@uytap.kg");

    assert.ok(reclaimCalledWith, "RPC reclaim_unverified_user должен быть вызван");
    assert.equal(reclaimCalledWith.p_user_id, "existing-unverified-uuid");
    assert.equal(reclaimCalledWith.p_account_type, "realtor");
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
  }
});
