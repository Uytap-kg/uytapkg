import test from "node:test";
import assert from "node:assert/strict";
import { createListingSchema, updateListingSchema } from "../src/utils/validation.js";
import { UI_TO_DB_PROPERTY_TYPE, COTTAGE_HOUSE_TYPE } from "../src/constants/propertyTypes.js";

test("Validation: createListingSchema accepts cottage and parking", () => {
  const baseListing = {
    title: "Красивый коттедж на берегу Иссык-Куля",
    price: 150000,
    currency: "USD",
    region: "ISSYK_KUL",
  };

  const cottageResult = createListingSchema.safeParse({
    ...baseListing,
    propertyType: "cottage",
    dealType: "sale",
  });
  assert.equal(cottageResult.success, true, "cottage must be valid in createListingSchema");

  const parkingResult = createListingSchema.safeParse({
    ...baseListing,
    propertyType: "parking",
    dealType: "sale",
  });
  assert.equal(parkingResult.success, true, "parking must be valid in createListingSchema");
});

test("Validation: updateListingSchema accepts cottage and parking", () => {
  const cottageUpdate = updateListingSchema.safeParse({
    propertyType: "cottage",
  });
  assert.equal(cottageUpdate.success, true, "cottage must be valid in updateListingSchema");

  const parkingUpdate = updateListingSchema.safeParse({
    propertyType: "parking",
  });
  assert.equal(parkingUpdate.success, true, "parking must be valid in updateListingSchema");
});

test("Mapping: UI_TO_DB_PROPERTY_TYPE maps cottage to house and parking to garage", () => {
  assert.equal(UI_TO_DB_PROPERTY_TYPE["cottage"], "house");
  assert.equal(UI_TO_DB_PROPERTY_TYPE["parking"], "garage");
  assert.equal(COTTAGE_HOUSE_TYPE, "Коттедж");
});
