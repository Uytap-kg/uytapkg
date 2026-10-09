import test from "node:test";
import assert from "node:assert/strict";

import {
  createPromotionOrder,
  getPromotionOrderByOrderId,
  markPromotionOrderStatus,
  listPromotionOrders,
} from "../src/utils/promotionOrders.js";

import {
  recordUploadOwner,
  isUploadOwnedBy,
  verifyAllOwnedBy,
} from "../src/utils/uploadOwnership.js";

import { supabase } from "../src/config/db.js";

test("Item 6 - promotionOrders: функции экспортируются корректно", () => {
  assert.equal(typeof createPromotionOrder, "function");
  assert.equal(typeof getPromotionOrderByOrderId, "function");
  assert.equal(typeof markPromotionOrderStatus, "function");
  assert.equal(typeof listPromotionOrders, "function");
});

test("Item 6 - uploadOwnership: функции экспортируются корректно", () => {
  assert.equal(typeof recordUploadOwner, "function");
  assert.equal(typeof isUploadOwnedBy, "function");
  assert.equal(typeof verifyAllOwnedBy, "function");
});

test("Item 6 - promotionOrders: createPromotionOrder и getPromotionOrderByOrderId маппят поля и выбрасывают ошибку при сбое БД", async () => {
  const origFrom = supabase.from;

  try {
    let insertedRow = null;

    // Мокаем supabase.from("promotion_orders")
    supabase.from = (table) => {
      assert.equal(table, "promotion_orders");
      return {
        insert: (row) => {
          insertedRow = { ...row, created_at: new Date().toISOString(), applied_at: null };
          return {
            select: () => ({
              single: async () => ({ data: insertedRow, error: null }),
            }),
          };
        },
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "order_id");
            assert.equal(val, "UT-ORDER-101");
            return {
              maybeSingle: async () => ({ data: insertedRow, error: null }),
            };
          },
        }),
      };
    };

    const created = await createPromotionOrder({
      orderId: "UT-ORDER-101",
      userId: "11111111-1111-1111-1111-111111111111",
      listingId: "22222222-2222-2222-2222-222222222222",
      serviceType: "vip",
      days: 7,
    });

    assert.equal(created.orderId, "UT-ORDER-101");
    assert.equal(created.order_id, "UT-ORDER-101");
    assert.equal(created.listingId, "22222222-2222-2222-2222-222222222222");
    assert.equal(created.listing_id, "22222222-2222-2222-2222-222222222222");
    assert.equal(created.serviceType, "vip");
    assert.equal(created.status, "pending");

    const fetched = await getPromotionOrderByOrderId("UT-ORDER-101");
    assert.equal(fetched.orderId, "UT-ORDER-101");
    assert.equal(fetched.listingId, "22222222-2222-2222-2222-222222222222");
    assert.equal(fetched.serviceType, "vip");
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 6 - promotionOrders: при ошибке БД getPromotionOrderByOrderId выбрасывает ошибку (не пустой объект и не [])", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: new Error("PostgreSQL connection failure"),
          }),
        }),
      }),
    });

    await assert.rejects(
      async () => {
        await getPromotionOrderByOrderId("UT-FAIL-ORDER");
      },
      /PostgreSQL connection failure/
    );
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 6 - promotionOrders: markPromotionOrderStatus обновляет статус и applied_at", async () => {
  const origFrom = supabase.from;

  try {
    let updatedPayload = null;

    supabase.from = () => ({
      update: (updates) => {
        updatedPayload = updates;
        return {
          eq: (col, val) => {
            assert.equal(col, "order_id");
            assert.equal(val, "UT-ORDER-202");
            return {
              select: () => ({
                maybeSingle: async () => ({
                  data: {
                    order_id: "UT-ORDER-202",
                    user_id: "u-1",
                    listing_id: "l-1",
                    service_type: "top",
                    days: 3,
                    status: updates.status,
                    applied_at: updates.applied_at || null,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      },
    });

    const updated = await markPromotionOrderStatus("UT-ORDER-202", "applied");
    assert.equal(updated.status, "applied");
    assert.ok(updated.appliedAt, "appliedAt должен быть заполнен");
    assert.ok(updatedPayload.applied_at, "applied_at должен передаваться в update");
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 6 - promotionOrders: listPromotionOrders сортирует по убыванию created_at и бросает исключение при сбое БД", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = () => ({
      select: () => ({
        order: (col, opts) => {
          assert.equal(col, "created_at");
          assert.equal(opts.ascending, false);
          return Promise.resolve({
            data: [
              { order_id: "O-2", user_id: "u-1", listing_id: "l-1", service_type: "vip", days: 7, status: "pending", created_at: "2026-10-02" },
              { order_id: "O-1", user_id: "u-1", listing_id: "l-1", service_type: "top", days: 3, status: "applied", created_at: "2026-10-01" },
            ],
            error: null,
          });
        },
      }),
    });

    const list = await listPromotionOrders();
    assert.equal(list.length, 2);
    assert.equal(list[0].orderId, "O-2");
    assert.equal(list[1].orderId, "O-1");

    // Проверяем throw при сбое БД
    supabase.from = () => ({
      select: () => ({
        order: () => Promise.resolve({ data: null, error: new Error("DB Error") }),
      }),
    });

    await assert.rejects(
      async () => {
        await listPromotionOrders();
      },
      /DB Error/
    );
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 6 - uploadOwnership: recordUploadOwner делает upsert в upload_ownership", async () => {
  const origFrom = supabase.from;

  try {
    let upsertPayload = null;

    supabase.from = (table) => {
      assert.equal(table, "upload_ownership");
      return {
        upsert: async (payload) => {
          upsertPayload = payload;
          return { error: null };
        },
      };
    };

    await recordUploadOwner("avatars/user-1/photo.jpg", "user-uuid-1");
    assert.equal(upsertPayload.object_path, "avatars/user-1/photo.jpg");
    assert.equal(upsertPayload.user_id, "user-uuid-1");
    assert.ok(upsertPayload.uploaded_at);
  } finally {
    supabase.from = origFrom;
  }
});

test("Item 6 - uploadOwnership: isUploadOwnedBy проверяет совпадение user_id в upload_ownership", async () => {
  const origFrom = supabase.from;

  try {
    supabase.from = (table) => {
      assert.equal(table, "upload_ownership");
      return {
        select: (cols) => {
          assert.equal(cols, "user_id");
          return {
            eq: (col, val) => {
              assert.equal(col, "object_path");
              return {
                maybeSingle: async () => {
                  if (val === "uploads/my-photo.jpg") {
                    return { data: { user_id: "owner-user-id" }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    };

    const isOwner = await isUploadOwnedBy("uploads/my-photo.jpg", "owner-user-id");
    assert.equal(isOwner, true);

    const isStranger = await isUploadOwnedBy("uploads/my-photo.jpg", "other-user-id");
    assert.equal(isStranger, false);

    const isNonExistent = await isUploadOwnedBy("uploads/unknown.jpg", "owner-user-id");
    assert.equal(isNonExistent, false);
  } finally {
    supabase.from = origFrom;
  }
});
