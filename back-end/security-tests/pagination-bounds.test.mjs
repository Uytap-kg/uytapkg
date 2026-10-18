import { test } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  isTestDbConfigured,
  SKIP_NO_TEST_DB_REASON,
  registerTestUser,
  deleteTestUser,
} from "./helpers.mjs";

test(
  "Pagination Bounds: Endpoints must cap client limit parameters to at most 100 to prevent DB dumping",
  { skip: !isTestDbConfigured ? SKIP_NO_TEST_DB_REASON : false },
  async () => {
    const { token, user } = await registerTestUser();

    try {
      // 1. GET /api/listings?limit=500000
      const publicListingsRes = await api("/api/listings?limit=500000");
      assert.equal(publicListingsRes.status, 200);
      assert.ok(
        publicListingsRes.body.pagination.limit <= 100,
        `Expected listings limit <= 100, got ${publicListingsRes.body.pagination.limit}`
      );

      // 2. GET /api/listings/my?limit=500000 (authenticated)
      const myListingsRes = await api("/api/listings/my?limit=500000", { token });
      assert.equal(myListingsRes.status, 200);
      assert.ok(
        myListingsRes.body.pagination.limit <= 100,
        `Expected /api/listings/my pagination.limit <= 100, got ${myListingsRes.body.pagination.limit}`
      );

      // 3. GET /api/developers?limit=500000
      const developersRes = await api("/api/developers?limit=500000");
      assert.equal(developersRes.status, 200);
      assert.ok(Array.isArray(developersRes.body.data));
      assert.equal(developersRes.body.pagination.limit, 100);
      assert.ok(
        developersRes.body.data.length <= 100,
        `Expected /api/developers items count <= 100, got ${developersRes.body.data.length}`
      );

      // 4. GET /api/complexes?limit=500000
      const complexesRes = await api("/api/complexes?limit=500000");
      assert.equal(complexesRes.status, 200);
      assert.ok(Array.isArray(complexesRes.body.data));
      assert.equal(complexesRes.body.pagination.limit, 100);
      assert.ok(
        complexesRes.body.data.length <= 100,
        `Expected /api/complexes items count <= 100, got ${complexesRes.body.data.length}`
      );

      // 5. GET /api/lawyers?limit=500000
      const lawyersRes = await api("/api/lawyers?limit=500000");
      assert.equal(lawyersRes.status, 200);
      assert.ok(Array.isArray(lawyersRes.body.data));
      assert.equal(lawyersRes.body.pagination.limit, 100);
      assert.ok(
        lawyersRes.body.data.length <= 100,
        `Expected /api/lawyers items count <= 100, got ${lawyersRes.body.data.length}`
      );
    } finally {
      await deleteTestUser(user.id);
    }
  }
);
