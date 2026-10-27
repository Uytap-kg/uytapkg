"use client";

import { useState } from "react";
import {
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import styles from "./Agency.module.css";
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

export default function Agency() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [phone, setPhone] = useState("+996 ");
  const [email, setEmail] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [inn, setInn] = useState("");
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

    if (
      !companyName.trim() ||
      !directorName.trim() ||
      !normalizedEmail ||
      !officeAddress.trim() ||
      !inn.trim() ||
      !password
    ) {
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
        accountType: "agency",
        companyName: companyName.trim(),
        directorName: directorName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        officeAddress: officeAddress.trim(),
        inn: inn.trim(),
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
      setError(err.message || "Ошибка при регистрации агентства.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <Building2 />
        </div>
        <div>
          <h2>Агентство недвижимости</h2>
          <p>Создайте профиль компании</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.inputBox}>
          <Building2 />
          <input
            type="text"
            name="companyName"
            placeholder="Название агентства"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            autoComplete="organization"
            required
          />
        </div>

        <div className={styles.inputBox}>
          <User />
          <input
            type="text"
            name="directorName"
            placeholder="Имя руководителя"
            value={directorName}
            onChange={(e) => setDirectorName(e.target.value)}
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

        <div className={styles.inputBox}>
          <FileText />
          <input
            type="text"
            name="inn"
            placeholder="ИНН агентства"
            value={inn}
            onChange={(e) => setInn(e.target.value)}
            required
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

        <textarea
          className={styles.textarea}
          name="about"
          placeholder="Расскажите об агентстве: опыт работы, направления, районы и преимущества"
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
              Перед созданием профиля ознакомьтесь с условиями использования
              UyTap.
            </span>
          </div>

          <div className={styles.checkboxRow}>
            <input
              id="agency-privacy"
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              required
            />
            <label htmlFor="agency-privacy" className={styles.checkbox}>
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
              id="agency-terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
            />
            <label htmlFor="agency-terms" className={styles.checkbox}>
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
          <div role="alert" style={{ color: "#ef4444", fontSize: "14px" }}>
            ⚠️ {error}
          </div>
        )}

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
            Профиль агентства создан! Перенаправление...
          </div>
        )}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading || !privacyAccepted || !termsAccepted}
        >
          {loading ? "Создание профиля..." : "Создать профиль"}
        </button>
      </form>
    </div>
  );
}
