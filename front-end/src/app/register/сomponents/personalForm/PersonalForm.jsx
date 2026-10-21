"use client";

import { useState } from "react";
import {
  User,
  Phone,
  Mail,
  Lock,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import styles from "./PersonalForm.module.css";
import InputField from "../inputField/InputField";
import { registerUser } from "@/utils/api";
import { saveAuth } from "@/utils/auth";

function formatPhone(value) {
  let digits = value.replace(/\D/g, "");

  if (digits.startsWith("996")) {
    digits = digits.slice(3);
  }

  digits = digits.slice(0, 9);

  let formatted = "+996";

  if (digits.length > 0) {
    formatted += ` ${digits.slice(0, 3)}`;
  }

  if (digits.length > 3) {
    formatted += ` ${digits.slice(3, 6)}`;
  }

  if (digits.length > 6) {
    formatted += ` ${digits.slice(6, 9)}`;
  }

  return formatted;
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return `+996${digits.slice(-9)}`;
}

export default function PersonalForm() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("+996 ");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Проверка обязательных полей
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError("Заполните все обязательные поля.");
      return;
    }

    // Проверка принятия документов
    if (!privacyAccepted || !termsAccepted) {
      setError(
        "Необходимо принять Политику конфиденциальности и Пользовательское соглашение.",
      );
      return;
    }

    // Проверка телефона
    const normalizedPhone = normalizePhone(phone);
    const phoneDigits = normalizedPhone.replace(/\D/g, "");

    if (phoneDigits.length !== 12) {
      setError("Введите полный номер телефона в формате +996 XXX XXX XXX.");
      return;
    }

    // Проверка пароля
    if (password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов.");
      return;
    }

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const res = await registerUser({
        accountType: "personal",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        password,
      });

      if (res?.token) {
        saveAuth({
          token: res.token,
          user: res.user,
        });
      }

      // Подтверждение email
      if (res?.needVerification) {
        localStorage.setItem("register_email", normalizedEmail);

        router.push(`/auth-code?email=${encodeURIComponent(normalizedEmail)}`);

        return;
      }

      setSuccess(true);

      setTimeout(() => {
        router.push("/profile");
      }, 1200);
    } catch (err) {
      setError(err.message || "Ошибка при регистрации.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {/* FIRST NAME */}

      <InputField
        icon={User}
        placeholder="Имя"
        value={firstName}
        setValue={setFirstName}
        required
      />

      {/* LAST NAME */}

      <InputField
        icon={User}
        placeholder="Фамилия"
        value={lastName}
        setValue={setLastName}
        required
      />

      {/* PHONE */}

      <InputField
        icon={Phone}
        placeholder="+996 000 000 000"
        value={phone}
        setValue={(value) => setPhone(formatPhone(value))}
        type="tel"
        required
      />

      {/* EMAIL */}

      <InputField
        icon={Mail}
        placeholder="Email"
        type="email"
        value={email}
        setValue={setEmail}
        required
      />

      {/* PASSWORD */}

      <InputField
        icon={Lock}
        placeholder="Пароль (минимум 8 символов)"
        password
        value={password}
        setValue={setPassword}
        required
      />

      {/* POLICIES */}

      <div className={styles.policyBlock}>
        <div className={styles.policyHeader}>
          <ShieldCheck />

          <span>
            Перед созданием аккаунта ознакомьтесь с условиями использования
            UyTap.
          </span>
        </div>

        {/* PRIVACY POLICY */}

        <div className={styles.checkboxRow}>
          <input
            id="personal-privacy"
            type="checkbox"
            checked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
            required
          />

          <label htmlFor="personal-privacy" className={styles.checkbox}>
            {privacyAccepted && <CheckCircle2 />}
          </label>

          <span className={styles.checkboxText}>
            Я принимаю{" "}
            <Link
              href="/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Политику конфиденциальности
            </Link>
          </span>
        </div>

        {/* TERMS */}

        <div className={styles.checkboxRow}>
          <input
            id="personal-terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            required
          />

          <label htmlFor="personal-terms" className={styles.checkbox}>
            {termsAccepted && <CheckCircle2 />}
          </label>

          <span className={styles.checkboxText}>
            Я принимаю{" "}
            <Link href="/terms" target="_blank" rel="noopener noreferrer">
              Пользовательское соглашение
            </Link>
          </span>
        </div>
      </div>

      {/* ERROR */}

      {error && (
        <div
          role="alert"
          style={{
            color: "#ef4444",
            fontSize: "14px",
            marginTop: "4px",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* SUCCESS */}

      {success && (
        <div
          role="status"
          style={{
            color: "#10b981",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <CheckCircle2 size={18} />
          Аккаунт успешно создан! Перенаправление...
        </div>
      )}

      {/* SUBMIT */}

      <button
        className={styles.submit}
        type="submit"
        disabled={loading || !privacyAccepted || !termsAccepted}
      >
        {loading ? "Создание аккаунта..." : "Создать аккаунт"}
      </button>
    </form>
  );
}
