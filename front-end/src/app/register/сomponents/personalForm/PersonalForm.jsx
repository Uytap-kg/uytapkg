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
import VerificationMethod from "../verificationMethod/VerificationMethod";
import { registerUser } from "@/utils/api";
import { saveAuth } from "@/utils/auth";

function formatPhone(value) {
  let digits = value.replace(/\D/g, "");

  if (digits.startsWith("996")) {
    digits = digits.slice(3);
  }

  digits = digits.slice(0, 9);

  let formatted = "+996";

  if (digits.length > 0) formatted += ` ${digits.slice(0, 3)}`;
  if (digits.length > 3) formatted += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) formatted += ` ${digits.slice(6, 9)}`;

  return formatted;
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return `+996${digits.startsWith("996") ? digits.slice(3) : digits}`.slice(
    0,
    13,
  );
}

export default function PersonalForm() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("+996 ");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationMethod, setVerificationMethod] = useState("email");

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);
    const phoneDigits = normalizedPhone.replace(/\D/g, "");

    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !password ||
      (verificationMethod === "email" && !normalizedEmail)
    ) {
      setError("Заполните все обязательные поля.");
      return;
    }

    if (phoneDigits.length !== 12) {
      setError("Введите полный номер телефона в формате +996 XXX XXX XXX.");
      return;
    }

    if (!privacyAccepted || !termsAccepted) {
      setError(
        "Необходимо принять Политику конфиденциальности и Пользовательское соглашение.",
      );
      return;
    }

    if (password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов.");
      return;
    }

    setLoading(true);

    try {
      const res = await registerUser({
        accountType: "personal",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail || undefined,
        password,
        verificationMethod,
      });

      if (res?.needVerification) {
        if (verificationMethod === "email") {
          localStorage.setItem("register_email", normalizedEmail);
          router.push(
            `/auth-code?method=email&email=${encodeURIComponent(normalizedEmail)}`,
          );
        } else {
          localStorage.setItem("register_phone", normalizedPhone);
          router.push(
            `/auth-code?method=phone&phone=${encodeURIComponent(normalizedPhone)}`,
          );
        }

        return;
      }

      if (res?.token) {
        saveAuth({ token: res.token, user: res.user });
      }

      setSuccess(true);
      setTimeout(() => router.push("/profile"), 1200);
    } catch (err) {
      setError(err.message || "Ошибка при регистрации.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <InputField
        icon={User}
        placeholder="Имя"
        value={firstName}
        setValue={setFirstName}
        required
      />

      <InputField
        icon={User}
        placeholder="Фамилия"
        value={lastName}
        setValue={setLastName}
        required
      />

      <InputField
        icon={Phone}
        placeholder="+996 000 000 000"
        value={phone}
        setValue={(value) => setPhone(formatPhone(value))}
        type="tel"
        required
      />

      <InputField
        icon={Mail}
        placeholder={
          verificationMethod === "email" ? "Email" : "Email (необязательно)"
        }
        type="email"
        value={email}
        setValue={setEmail}
        required={verificationMethod === "email"}
      />

      <InputField
        icon={Lock}
        placeholder="Пароль (минимум 8 символов)"
        password
        value={password}
        setValue={setPassword}
        required
      />

      <VerificationMethod
        value={verificationMethod}
        onChange={setVerificationMethod}
      />

      <div className={styles.policyBlock}>
        <div className={styles.policyHeader}>
          <ShieldCheck />
          <span>
            Перед созданием аккаунта ознакомьтесь с условиями использования
            UyTap.
          </span>
        </div>

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

      {error && (
        <div role="alert" className={styles.error}>
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div role="status" className={styles.success}>
          <CheckCircle2 size={18} />
          Аккаунт успешно создан! Перенаправление...
        </div>
      )}

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
