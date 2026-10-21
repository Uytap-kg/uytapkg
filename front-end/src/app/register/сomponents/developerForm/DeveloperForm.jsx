"use client";

import { useState } from "react";
import {
  Building,
  Phone,
  Mail,
  FileCheck,
  MapPin,
  Lock,
  EyeOff,
  Eye,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import styles from "./DeveloperForm.module.css";
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

export default function DeveloperForm() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [inn, setInn] = useState("");
  const [phone, setPhone] = useState("+996 ");
  const [email, setEmail] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [about, setAbout] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Проверка обязательных полей
    if (
      !companyName.trim() ||
      !inn.trim() ||
      !email.trim() ||
      !officeAddress.trim() ||
      !password
    ) {
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
        accountType: "developer",
        companyName: companyName.trim(),
        inn: inn.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        officeAddress: officeAddress.trim(),
        about: about.trim(),
        password,
      });

      if (res?.token) {
        saveAuth({ token: res.token, user: res.user });
      }

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
      setError(err.message || "Ошибка при регистрации застройщика.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit}>
      {/* HEADER */}

      <div className={styles.header}>
        <Building />

        <div>
          <h2>Профиль застройщика</h2>
          <p>Создайте страницу вашей компании</p>
        </div>
      </div>

      {/* FIELDS */}

      <div className={styles.grid}>
        {/* COMPANY */}

        <div className={styles.inputBox}>
          <Building />

          <input
            type="text"
            name="companyName"
            placeholder="Название компании"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            autoComplete="organization"
            required
          />
        </div>

        {/* INN */}

        <div className={styles.inputBox}>
          <FileCheck />

          <input
            type="text"
            name="inn"
            placeholder="ИНН компании"
            value={inn}
            onChange={(e) => setInn(e.target.value)}
            required
          />
        </div>

        {/* PHONE */}

        <div className={styles.inputBox}>
          <Phone />

          <input
            type="tel"
            name="phone"
            placeholder="+996 000 000 000"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            inputMode="numeric"
            autoComplete="tel"
            required
          />
        </div>

        {/* EMAIL */}

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

        {/* ADDRESS */}

        <div className={styles.inputBox}>
          <MapPin />

          <input
            type="text"
            name="officeAddress"
            placeholder="Адрес офиса"
            value={officeAddress}
            onChange={(e) => setOfficeAddress(e.target.value)}
            autoComplete="street-address"
            required
          />
        </div>

        {/* PASSWORD */}

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

      {/* ABOUT — OPTIONAL */}

      <textarea
        className={styles.textarea}
        name="about"
        placeholder="Описание компании (необязательно)"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
      />

      {/* POLICIES */}

      <div className={styles.policyBlock}>
        <div className={styles.policyHeader}>
          <ShieldCheck />

          <span>
            Перед созданием профиля ознакомьтесь с условиями использования
            UyTap.
          </span>
        </div>

        {/* PRIVACY */}

        <div className={styles.checkboxRow}>
          <input
            id="developer-privacy"
            type="checkbox"
            checked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
            required
          />

          <label htmlFor="developer-privacy" className={styles.checkbox}>
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
            id="developer-terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            required
          />

          <label htmlFor="developer-terms" className={styles.checkbox}>
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
          Профиль застройщика создан! Перенаправление...
        </div>
      )}

      {/* SUBMIT */}

      <button
        className={styles.submit}
        type="submit"
        disabled={loading || !privacyAccepted || !termsAccepted}
      >
        {loading ? "Создание профиля..." : "Создать профиль"}
      </button>
    </form>
  );
}
