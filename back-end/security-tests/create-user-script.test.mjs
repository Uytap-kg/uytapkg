import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseCliArgs,
  generateRandomPhone,
  createUser,
  VALID_ACCOUNT_TYPES,
  VALID_ROLES,
} from "../scripts/create_user.js";

describe("scripts/create_user.js - Безопасное создание пользователей", () => {
  test("parseCliArgs: корректно парсит флаги формата --key=value и --key value", () => {
    const raw = [
      "--type=developer",
      "--email=dev@test.kg",
      "--password=mySecretPass123",
      "--company=Elite House",
      "--admin",
      "--force",
    ];

    const parsed = parseCliArgs(raw);

    assert.equal(parsed.type, "developer");
    assert.equal(parsed.email, "dev@test.kg");
    assert.equal(parsed.password, "mySecretPass123");
    assert.equal(parsed.company, "Elite House");
    assert.equal(parsed.role, "admin");
    assert.equal(parsed.force, true);
  });

  test("parseCliArgs: корректно парсит короткие флаги -t, -e, -p, -r, -f", () => {
    const raw = ["-t", "realtor", "-e", "agent@test.kg", "-p", "pass123", "-r", "user", "-f"];
    const parsed = parseCliArgs(raw);

    assert.equal(parsed.type, "realtor");
    assert.equal(parsed.email, "agent@test.kg");
    assert.equal(parsed.password, "pass123");
    assert.equal(parsed.role, "user");
    assert.equal(parsed.force, true);
  });

  test("VALID_ACCOUNT_TYPES и VALID_ROLES соответствуют схеме базы данных", () => {
    assert.deepEqual(VALID_ACCOUNT_TYPES, ["personal", "realtor", "agency", "developer"]);
    assert.deepEqual(VALID_ROLES, ["user", "admin"]);
  });

  test("generateRandomPhone: генерирует валидный формат номера Кыргызстана (+996...)", () => {
    for (let i = 0; i < 10; i++) {
      const phone = generateRandomPhone();
      assert.match(phone, /^\+996\d{9}$/, `Номер ${phone} должен соответствовать формату +996XXXXXXXXX`);
    }
  });

  test("createUser: отклоняет недопустимый account_type с понятной ошибкой", async () => {
    await assert.rejects(
      async () => {
        await createUser({
          accountType: "superhero",
          role: "user",
          email: "super@test.kg",
          password: "password123",
        });
      },
      /Недопустимый account_type "superhero"/
    );
  });

  test("createUser: отклоняет недопустимую роль с понятной ошибкой", async () => {
    await assert.rejects(
      async () => {
        await createUser({
          accountType: "personal",
          role: "moderator_hacker",
          email: "mod@test.kg",
          password: "password123",
        });
      },
      /Недопустимая role "moderator_hacker"/
    );
  });
});
