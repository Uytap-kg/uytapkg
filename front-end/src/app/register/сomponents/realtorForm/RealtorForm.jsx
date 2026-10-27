"use client";

import { useState } from "react";
import {
  Building2,
  Phone,
  Mail,
  FileText,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import styles from "./RealtorForm.module.css";
import { registerUser } from "@/utils/api";
import { saveAuth } from "@/utils/auth";
import VerificationMethod from "../verificationMethod/VerificationMethod";

function formatPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("996")) digits = digits.slice(3);
  digits = digits.slice(0, 9);

  let formatted = "+996";
  if (digits.length > 0) formatted += ` ${digits.slice(0, 3)}`;
  if (digits.length > 3) formatted += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) formatted += ` ${digits.slice(6, 9)}`;

  return formatted;
}

function normalizePhone(phone) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("996")) digits = digits.slice(3);
  return `+996${digits.slice(-9)}`;
}

export default function RealtorForm() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+996 ");
  const [email, setEmail] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [about, setAbout] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

    if (!fullName.trim() || !normalizedEmail || !password) {
      setError("Заполните все обязательные поля.");
      return;
    }

    if (normalizedPhone.replace(/\D/g, "").length !== 12) {
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
        accountType: "realtor",
        fullName: fullName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        agencyName: agencyName.trim(),
        about: about.trim(),
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
          if (res.token) localStorage.setItem("register_otp_token", res.token);
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
      // Код уже отправлен (кулдаун) — аккаунт создан, переходим к вводу кода
      if (
        verificationMethod === "phone" &&
        err?.status === 429 &&
        err?.retryAfter
      ) {
        localStorage.setItem("register_phone", normalizedPhone);
        router.push(
          `/auth-code?method=phone&phone=${encodeURIComponent(normalizedPhone)}`,
        );
        return;
      }
      setError(err.message || "Ошибка при регистрации профиля риэлтора.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <Building2 />
        <div>
          <h2>Профиль риэлтора</h2>
          <p>Расскажите о вашей деятельности</p>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.inputBox}>
          <FileText />
          <input
            type="text"
            name="fullName"
            placeholder="ФИО"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>

        <div className={styles.inputBox}>
          <Phone />
          <input
            type="tel"
            name="phone"
            placeholder="+996 000 000 000"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            required
          />
        </div>

        <div className={styles.inputBox}>
          <Mail />
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className={styles.inputBox}>
          <Building2 />
          <input
            type="text"
            name="agencyName"
            placeholder="Название агентства"
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
          />
        </div>

        <div className={styles.inputBox}>
          <Lock />
          <input
            type={showPassword ? "text" : "password"}
            name="password"
            placeholder="Пароль (минимум 8 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button
            type="button"
            className={styles.eye}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </button>
        </div>
      </div>

      <textarea
        className={styles.textarea}
        name="about"
        placeholder="О себе / опыт работы (необязательно)"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
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
            id="realtor-privacy"
            type="checkbox"
            checked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
            required
          />
          <label htmlFor="realtor-privacy" className={styles.checkbox}>
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
            id="realtor-terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            required
          />
          <label htmlFor="realtor-terms" className={styles.checkbox}>
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
          Профиль риэлтора создан! Перенаправление...
        </div>
      )}

      <button
        className={styles.submit}
        type="submit"
        disabled={loading || !privacyAccepted || !termsAccepted}
      >
        {loading ? "Создание профиля..." : "Создать профиль риэлтора"}
      </button>
    </form>
  );
}
