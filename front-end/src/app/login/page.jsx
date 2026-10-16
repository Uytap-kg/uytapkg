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
  ArrowRight,
  Eye,
  EyeOff,
  User,
  Building2,
  CheckCircle2,
} from "lucide-react";

import styles from "./Login.module.css";
import { loginUser } from "@/utils/api";
import { useLanguage } from "@/context/LanguageContext";

export default function Login() {
  const router = useRouter();
  const { t } = useLanguage();

  const [accountType, setAccountType] = useState("personal");
  const [method, setMethod] = useState("email");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // формат номера Кыргызстана
  const formatPhone = (value) => {
    let numbers = value.replace(/\D/g, "");

    if (numbers.startsWith("996")) {
      numbers = numbers.slice(3);
    }

    numbers = numbers.slice(0, 9);
    let result = "+996";

    if (numbers.length) result += " " + numbers.slice(0, 3);
    if (numbers.length >= 4) result += " " + numbers.slice(3, 6);
    if (numbers.length >= 7) result += " " + numbers.slice(6, 9);

    return result;
  };

  const handlePhone = (e) => {
    setPhone(formatPhone(e.target.value));
  };

  const handlePhoneLogin = async (e) => {
    e.preventDefault();

    setError("");
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 9) {
      setError(t("login.invalidPhone"));
      return;
    }

    setLoading(true);

    try {
      const data = await loginUser({
        identifier: cleanPhone,
        password,
      });

      if (data.token) {
        document.cookie = `uytap_token=${data.token}; path=/; max-age=${
          60 * 60 * 24 * 30
        }`;

        localStorage.setItem("uytap_token", data.token);
        localStorage.setItem("uytap_user", JSON.stringify(data.user));
      }

      setSuccess(true);

      setTimeout(() => {
        router.push("/profile");
      }, 1000);
    } catch (err) {
      if (err?.needVerification && err?.email) {
        const verifyEmail = String(err.email).trim().toLowerCase();
        localStorage.setItem("register_email", verifyEmail);
        router.push(`/auth-code?email=${encodeURIComponent(verifyEmail)}&reason=login`);
        return;
      }
      setError(err.message || t("login.loginError"));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      const data = await loginUser({
        identifier: email,
        password,
      });

      if (data.token) {
        document.cookie = `uytap_token=${data.token}; path=/; max-age=${
          60 * 60 * 24 * 30
        }`;

        localStorage.setItem("uytap_token", data.token);
        localStorage.setItem("uytap_user", JSON.stringify(data.user));
      }

      setSuccess(true);

      setTimeout(() => {
        router.push("/profile");
      }, 1000);
    } catch (err) {
      if (err?.needVerification && err?.email) {
        const verifyEmail = String(err.email).trim().toLowerCase();
        localStorage.setItem("register_email", verifyEmail);
        router.push(`/auth-code?email=${encodeURIComponent(verifyEmail)}&reason=login`);
        return;
      }
      setError(err.message || t("login.loginError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <motion.section
        className={styles.card}
        layout
        initial={{
          opacity: 0,
          y: 40,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 0.45,
        }}
      >
        <div className={styles.brand}>UyTap</div>

        <h1 className={styles.title}>{t("login.title")}</h1>

        <p className={styles.subtitle}>{t("login.subtitle")}</p>

        {/* Тип аккаунта */}
        <div className={styles.accountTabs}>
          <button
            className={accountType === "personal" ? styles.activeTab : ""}
            onClick={() => {
              setAccountType("personal");
              setMethod("email");
              setError("");
            }}
          >
            <User />
            {t("login.personal")}
          </button>

          <button
            className={accountType === "business" ? styles.activeTab : ""}
            onClick={() => {
              setAccountType("business");
              setMethod("email");
              setError("");
            }}
          >
            <Building2 />
            {t("login.business")}
          </button>
        </div>

        <AnimatePresence mode="wait">
          {accountType === "personal" && (
            <motion.div
              key="personal"
              initial={{
                opacity: 0,
                x: -30,
              }}
              animate={{
                opacity: 1,
                x: 0,
              }}
              exit={{
                opacity: 0,
                x: -30,
              }}
              transition={{
                duration: 0.3,
              }}
            >
              <div className={styles.methods}>
                <button
                  className={
                    method === "phone" ? styles.activeMethod : styles.method
                  }
                  onClick={() => {
                    setMethod("phone");
                    setError("");
                  }}
                >
                  <Phone />
                  {t("login.phone")}
                </button>

                <button
                  className={
                    method === "email" ? styles.activeMethod : styles.method
                  }
                  onClick={() => {
                    setMethod("email");
                    setError("");
                  }}
                >
                  <Mail />
                  Email
                </button>
              </div>

              {error && (
                <div
                  style={{
                    color: "#ef4444",
                    fontSize: "14px",
                    margin: "10px 0",
                  }}
                >
                  ⚠️ {error}
                </div>
              )}

              {success && (
                <div
                  style={{
                    color: "#10b981",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    margin: "10px 0",
                  }}
                >
                  <CheckCircle2 size={18} />
                  {t("login.success")} {t("login.redirecting")}
                </div>
              )}

              <AnimatePresence mode="wait">
                {method === "phone" && (
                  <motion.div
                    key="phone"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                  >
                    <PhoneForm
                      phone={phone}
                      handlePhone={handlePhone}
                      password={password}
                      setPassword={setPassword}
                      showPassword={showPassword}
                      setShowPassword={setShowPassword}
                      remember={remember}
                      setRemember={setRemember}
                      handlePhoneLogin={handlePhoneLogin}
                      loading={loading}
                      t={t}
                    />
                  </motion.div>
                )}

                {method === "email" && (
                  <motion.div
                    key="email"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.25 }}
                  >
                    <EmailForm
                      email={email}
                      setEmail={setEmail}
                      password={password}
                      setPassword={setPassword}
                      showPassword={showPassword}
                      setShowPassword={setShowPassword}
                      remember={remember}
                      setRemember={setRemember}
                      handleEmailLogin={handleEmailLogin}
                      loading={loading}
                      t={t}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {accountType === "business" && (
            <motion.div
              key="business"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.3 }}
            >
              {error && (
                <div
                  style={{
                    color: "#ef4444",
                    fontSize: "14px",
                    margin: "10px 0",
                  }}
                >
                  ⚠️ {error}
                </div>
              )}

              {success && (
                <div
                  style={{
                    color: "#10b981",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    margin: "10px 0",
                  }}
                >
                  <CheckCircle2 size={18} />
                  {t("login.success")} {t("login.redirecting")}
                </div>
              )}

              <EmailForm
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                remember={remember}
                setRemember={setRemember}
                handleEmailLogin={handleEmailLogin}
                loading={loading}
                business
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.bottom}>
          {t("login.noAccount")}{" "}
          <Link href="/register">{t("login.register")}</Link>
        </div>
      </motion.section>
    </main>
  );
}

function EmailForm({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  remember,
  setRemember,
  handleEmailLogin,
  loading,
  business,
  t,
}) {
  return (
    <form className={styles.form} onSubmit={handleEmailLogin}>
      <div className={styles.inputBox}>
        <Mail />

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@gmail.com"
          required
        />
      </div>

      <div className={styles.inputBox}>
        <Lock />

        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("login.password")}
          required
        />

        <button
          type="button"
          className={styles.eye}
          onClick={() => setShowPassword(!showPassword)}
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

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? t("login.loggingIn") : t("login.login")}
      </button>
    </form>
  );
}

function PhoneForm({
  phone,
  handlePhone,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  remember,
  setRemember,
  handlePhoneLogin,
  loading,
  t,
}) {
  return (
    <form className={styles.form} onSubmit={handlePhoneLogin}>
      <div className={styles.inputBox}>
        <Phone />

        <input
          type="tel"
          value={phone}
          onChange={handlePhone}
          placeholder="+996 555 555 555"
          required
        />
      </div>

      <div className={styles.inputBox}>
        <Lock />

        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("login.password")}
          required
        />

        <button
          type="button"
          className={styles.eye}
          onClick={() => setShowPassword(!showPassword)}
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

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? t("login.loggingIn") : t("login.login")}
      </button>
    </form>
  );
}
