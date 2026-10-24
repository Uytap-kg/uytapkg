"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Mail,
  Phone,
  Lock,
  Check,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

import styles from "./Login.module.css";
import { loginUser } from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

export default function Login() {
  const router = useRouter();
  const { t } = useLanguage();

  const [method, setMethod] = useState("phone");
  const [phone, setPhone] = useState("+996");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const formatPhone = (value) => {
    let numbers = value.replace(/\D/g, "");

    if (numbers.startsWith("996")) {
      numbers = numbers.slice(3);
    }

    numbers = numbers.slice(0, 9);

    let result = "+996";

    if (numbers.length > 0) result += " " + numbers.slice(0, 3);
    if (numbers.length > 3) result += " " + numbers.slice(3, 6);
    if (numbers.length > 6) result += " " + numbers.slice(6, 9);

    return result;
  };

  const handlePhone = (e) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess(false);

    let identifier;

    if (method === "phone") {
      const cleanPhone = phone.replace(/\D/g, "");

      if (cleanPhone.length !== 12) {
        setError(t("login.invalidPhone"));
        return;
      }

      identifier = cleanPhone;
    } else {
      identifier = email.trim().toLowerCase();
    }

    setLoading(true);

    try {
      const data = await loginUser({
        identifier,
        password,
      });

      if (data.token) {
        document.cookie = `uytap_token=${data.token}; path=/; max-age=${
          60 * 60 * 24 * 30
        }; SameSite=Lax`;

        localStorage.setItem("uytap_token", data.token);

        if (data.user) {
          localStorage.setItem("uytap_user", JSON.stringify(data.user));
        }
      }

      setSuccess(true);

      setTimeout(() => {
        router.push("/profile");
      }, 1000);
    } catch (err) {
      if (err?.needVerification && err?.email) {
        const verifyEmail = String(err.email).trim().toLowerCase();

        localStorage.setItem("register_email", verifyEmail);

        router.push(
          `/auth-code?email=${encodeURIComponent(verifyEmail)}&reason=login`,
        );

        return;
      }

      setError(err?.message || t("login.loginError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <motion.section
        className={styles.card}
        layout
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className={styles.brand}>UyTap</div>

        <h1 className={styles.title}>{t("login.title")}</h1>

        <p className={styles.subtitle}>{t("login.subtitle")}</p>

        {/* Один слайдер: телефон или почта */}
        <div className={styles.methods} role="group" aria-label="Способ входа">
          <button
            type="button"
            className={method === "phone" ? styles.activeMethod : styles.method}
            onClick={() => {
              setMethod("phone");
              setError("");
              setSuccess(false);
            }}
            aria-pressed={method === "phone"}
          >
            <Phone />
            <span>{t("login.phone")}</span>
          </button>

          <button
            type="button"
            className={method === "email" ? styles.activeMethod : styles.method}
            onClick={() => {
              setMethod("email");
              setError("");
              setSuccess(false);
            }}
            aria-pressed={method === "email"}
          >
            <Mail />
            <span>Email</span>
          </button>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            ⚠️ {error}
          </div>
        )}

        {success && (
          <div className={styles.success} role="status">
            <CheckCircle2 size={18} />
            {t("login.success")} {t("login.redirecting")}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={method}
            initial={{ opacity: 0, x: method === "phone" ? -15 : 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: method === "phone" ? 15 : -15 }}
            transition={{ duration: 0.2 }}
          >
            <form className={styles.form} onSubmit={handleLogin}>
              {method === "phone" ? (
                <>
                  <div className={styles.inputBox}>
                    <Phone />

                    <input
                      type="tel"
                      value={phone}
                      onChange={handlePhone}
                      placeholder="+996 555 555 555"
                      autoComplete="tel"
                      required
                    />
                  </div>

                  <p className={styles.phoneHint}>
                    <span>⚠</span>
                    Временно доступны только операторы Beeline и MEGA.
                  </p>
                </>
              ) : (
                <div className={styles.inputBox}>
                  <Mail />

                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    autoComplete="email"
                    required
                  />
                </div>
              )}

              <div className={styles.inputBox}>
                <Lock />

                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("login.password")}
                  autoComplete="current-password"
                  required
                />

                <button
                  type="button"
                  className={styles.eye}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>

              <div className={styles.options}>
                <label className={styles.remember}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />

                  <span className={styles.check}>{remember && <Check />}</span>

                  {t("login.remember")}
                </label>

                <Link href="/forgot">{t("login.forgotPassword")}</Link>
              </div>

              <button
                className={styles.submit}
                type="submit"
                disabled={loading}
              >
                {loading ? t("login.loggingIn") : t("login.login")}
              </button>
            </form>
          </motion.div>
        </AnimatePresence>

        <div className={styles.bottom}>
          {t("login.noAccount")}{" "}
          <Link href="/register">{t("login.register")}</Link>
        </div>
      </motion.section>
    </main>
  );
}
