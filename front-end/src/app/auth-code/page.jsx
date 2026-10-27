"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Mail, Phone, RefreshCw } from "lucide-react";

import styles from "./AuthCode.module.css";
import { verifyEmailOtp, resendEmailOtp, verifyPhoneOtp, resendPhoneOtp } from "@/utils/api";

function AuthCodeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [timer, setTimer] = useState(60);
  const [isResending, setIsResending] = useState(false);

  const inputRef = useRef(null);

  const method = searchParams.get("method");
  const queryPhone = searchParams.get("phone");
  const queryEmail = searchParams.get("email");
  const reason = searchParams.get("reason");

  const [phone, setPhone] = useState(null);
  const [email, setEmail] = useState(null);
  const initRef = useRef(false);

  useEffect(() => {
    let rawPhone = (queryPhone || localStorage.getItem("register_phone") || "").trim();
    // "+" в query-строке декодируется как пробел: " 996..." -> "+996..."
    if (/^\s*996\d{9}$/.test(queryPhone || "")) rawPhone = `+${rawPhone}`;
    setPhone(rawPhone || null);
    const rawEmail = (queryEmail || localStorage.getItem("register_email") || "").trim().toLowerCase();
    setEmail(rawEmail || null);
  }, [queryPhone, queryEmail]);

  const isPhone = method === "phone" || (!email && Boolean(phone));

  // Вход с неподтверждёнными данными: код при логине не отправляется,
  // поэтому запрашиваем его здесь (сервер сам применяет кулдаун/лимиты).
  useEffect(() => {
    if (isPhone) {
      if (!phone || reason !== "login" || initRef.current) return;
      initRef.current = true;
      // Токен прошлой сессии не должен попасть в новую проверку
      localStorage.removeItem("register_otp_token");
      resendPhoneOtp(phone).catch((err) => {
        const match = /(\d+)\s*секунд/.exec(err?.message || "");
        if (match) setTimer(Number(match[1]));
        else if (err?.status === 429) setError(err.message);
      });
    } else {
      if (!email || reason !== "login" || initRef.current) return;
      initRef.current = true;
      resendEmailOtp(email).catch((err) => {
        const match = /(\d+)\s*секунд/.exec(err?.message || "");
        if (match) setTimer(Number(match[1]));
        else if (err?.status === 429) setError(err.message);
      });
    }
  }, [email, phone, reason, isPhone]);

  /* =========================================================
     TIMER
  ========================================================= */

  useEffect(() => {
    if (timer <= 0) {
      return;
    }

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  /* =========================================================
     INPUT
  ========================================================= */

  const handleCodeChange = (event) => {
    const value = event.target.value.replace(/\D/g, "").slice(0, 6);

    setCode(value);

    if (error) {
      setError("");
    }
  };

  /* =========================================================
     VERIFY CODE
  ========================================================= */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (code.length !== 6) {
      setError("Введите 6-значный код");
      return;
    }

    setIsChecking(true);
    setError("");

    try {
      if (isPhone) {
        await verifyPhoneOtp(phone, code, localStorage.getItem("register_otp_token") || undefined);
        localStorage.removeItem("register_phone");
        localStorage.removeItem("register_otp_token");
      } else {
        await verifyEmailOtp(email, code);
        localStorage.removeItem("register_email");
      }
      router.push("/success-register");
      return;
    } catch (error) {
      setError(error?.message || "Неверный код");
      if (/Превышено|не найден/.test(error?.message || "")) setCode("");
    } finally {
      setIsChecking(false);
    }
  };

  /* =========================================================
     RESEND CODE
  ========================================================= */

  const handleResend = async () => {
    if (timer > 0 || isResending) {
      return;
    }

    if (isPhone && !phone) {
      setError("Не удалось определить номер телефона");
      return;
    }

    if (!isPhone && !email) {
      setError("Не удалось определить email");
      return;
    }

    setIsResending(true);
    setError("");

    try {
      if (isPhone) {
        await resendPhoneOtp(phone);
      } else {
        await resendEmailOtp(email);
      }
      setTimer(60);
      setCode("");

      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } catch (error) {
      const match = /(\d+)\s*секунд/.exec(error?.message || "");
      if (match) setTimer(Number(match[1]));
      setError(error?.message || "Не удалось отправить код");
    } finally {
      setIsResending(false);
    }
  };

  /* =========================================================
     FORMAT TIMER
  ========================================================= */

  const minutes = String(Math.floor(timer / 60)).padStart(2, "0");

  const seconds = String(timer % 60).padStart(2, "0");

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <main className={styles.page}>
      <div className={styles.noise} />

      <div className={styles.glowOne} />

      <div className={styles.glowTwo} />

      <div className={styles.container}>
        {/* ICON */}

        <div className={styles.iconWrapper}>
          <div className={styles.icon}>
            {isPhone ? <Phone size={27} /> : <Mail size={27} />}
          </div>
        </div>

        {/* HEADER */}

        <div className={styles.header}>
          <span className={styles.eyebrow}>
            {isPhone ? "SMS VERIFICATION" : "EMAIL VERIFICATION"}
          </span>

          <h1>
            Проверьте
            <span> {isPhone ? "телефон" : "почту"}</span>
          </h1>

          <p>
            {reason === "login"
              ? isPhone
                ? "Подтвердите номер телефона, чтобы войти в аккаунт. Мы отправили вам SMS с кодом."
                : "Подтвердите email, чтобы войти в аккаунт. Мы отправили вам код."
              : isPhone
              ? "Мы отправили SMS с кодом подтверждения на ваш номер телефона."
              : "Мы отправили код подтверждения на вашу электронную почту."}
          </p>

          {isPhone ? (
            phone && (
              <div className={styles.email}>
                {phone.startsWith("+") ? phone : `+${phone}`}
              </div>
            )
          ) : (
            email && <div className={styles.email}>{email}</div>
          )}
        </div>

        {/* FORM */}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="auth-code" className={styles.label}>
            Введите код
          </label>

          <input
            ref={inputRef}
            id="auth-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={handleCodeChange}
            placeholder="000000"
            className={`${styles.input} ${error ? styles.inputError : ""}`}
            autoFocus
          />

          {error && <div className={styles.error}>{error}</div>}

          <button
            type="submit"
            className={styles.submit}
            disabled={isChecking || code.length !== 6}
          >
            {isChecking ? (
              <>
                Проверяем...
                <RefreshCw size={17} className={styles.spinning} />
              </>
            ) : (
              <>
                Подтвердить
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>

        {/* RESEND */}

        <div className={styles.resend}>
          {timer > 0 ? (
            <>
              <span>Не получили код?</span>

              <span className={styles.timer}>
                Повторная отправка через{" "}
                <strong>
                  {minutes}:{seconds}
                </strong>
              </span>
            </>
          ) : (
            <>
              <span>Не получили код?</span>

              <button
                type="button"
                onClick={handleResend}
                disabled={isResending}
                className={styles.resendButton}
              >
                {isResending ? (
                  <>
                    Отправляем...
                    <RefreshCw size={14} className={styles.spinning} />
                  </>
                ) : (
                  <>
                    Отправить код ещё раз
                    <RefreshCw size={14} />
                  </>
                )}
              </button>
            </>
          )}
        </div>

        {/* SECURITY */}

        <div className={styles.security}>
          <CheckCircle2 size={15} />

          <span>Код действителен в течение ограниченного времени</span>
        </div>
      </div>
    </main>
  );
}

export default function AuthCode() {
  return (
    <Suspense fallback={<main className={styles.page} />}>
      <AuthCodeContent />
    </Suspense>
  );
}
