"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  Smartphone,
  Check,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  Phone,
} from "lucide-react";
import Link from "next/link";
import {
  requestPasswordReset,
  verifyPasswordResetCode,
  completePasswordReset,
} from "@/utils/api";
import styles from "./Forgot.module.css";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

const getError = (error, fallback) => error?.message || fallback;

export default function Forgot() {
  const router = useRouter();

  const [method, setMethod] = useState("email");
  const [step, setStep] = useState(1);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phonePrefix, setPhonePrefix] = useState("+996");

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [resetToken, setResetToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [countdown, setCountdown] = useState(0);

  const normalizedEmail = email.trim().toLowerCase();

  const normalizedPhone = `${phonePrefix}${phone.replace(/\D/g, "")}`;

  const contact = method === "email" ? normalizedEmail : normalizedPhone;

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const clearMessages = () => {
    setErrorMessage("");
    setInfoMessage("");
  };

  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((previous) => (previous <= 1 ? 0 : previous - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (!successMessage) return;

    const timer = setTimeout(() => {
      router.push("/login");
    }, 1600);

    return () => clearTimeout(timer);
  }, [successMessage, router]);

  const changeMethod = (nextMethod) => {
    if (isLoading) return;

    setMethod(nextMethod);
    setStep(1);
    setCode("");
    setResetToken("");
    setPassword("");
    setConfirmPassword("");
    setSuccessMessage("");
    setCountdown(0);
    clearMessages();
  };

  // Шаг 1: отправка кода на email
  const handleSendEmail = async (event) => {
    event.preventDefault();
    clearMessages();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setErrorMessage("Введите корректный адрес электронной почты.");
      return;
    }

    setIsLoading(true);

    try {
      const data = await requestPasswordReset(normalizedEmail);

      setCountdown(60);
      setInfoMessage(
        data?.message || "Если аккаунт существует, код отправлен на почту.",
      );
      setStep(2);
    } catch (error) {
      const match = /(\d+)\s*секунд/i.exec(error?.message || "");

      if (match) {
        setCountdown(Number(match[1]));
      }

      setErrorMessage(
        getError(error, "Не удалось отправить код восстановления."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Телефон: интерфейс готов, отправка SMS требует backend API
  const handleSendPhone = async (event) => {
    event.preventDefault();
    clearMessages();

    if (!PHONE_REGEX.test(normalizedPhone)) {
      setErrorMessage("Введите корректный номер телефона с кодом страны.");
      return;
    }

    setErrorMessage(
      "Восстановление по SMS пока не подключено. Используйте электронную почту.",
    );
  };

  // Повторная отправка кода на email
  const handleResendCode = async () => {
    if (countdown > 0 || isLoading) return;

    clearMessages();
    setIsLoading(true);

    try {
      const data = await requestPasswordReset(normalizedEmail);

      setCountdown(60);
      setInfoMessage(
        data?.message ||
          "Если аккаунт существует, новый код отправлен на почту.",
      );
    } catch (error) {
      const match = /(\d+)\s*секунд/i.exec(error?.message || "");

      if (match) {
        setCountdown(Number(match[1]));
      }

      setErrorMessage(getError(error, "Не удалось повторно отправить код."));
    } finally {
      setIsLoading(false);
    }
  };

  // Шаг 2: проверка кода
  const handleVerifyCode = async (event) => {
    event.preventDefault();
    clearMessages();

    const cleanCode = code.replace(/\D/g, "");

    if (!/^\d{6}$/.test(cleanCode)) {
      setErrorMessage("Введите шестизначный код из письма.");
      return;
    }

    if (method !== "email") {
      setErrorMessage("Проверка SMS-кода пока не подключена к серверу.");
      return;
    }

    setIsLoading(true);

    try {
      const data = await verifyPasswordResetCode(normalizedEmail, cleanCode);

      if (!data?.resetToken) {
        setErrorMessage("Сервер не вернул токен для сброса пароля.");
        return;
      }

      setResetToken(data.resetToken);
      setInfoMessage("");
      setStep(3);
    } catch (error) {
      setErrorMessage(
        getError(error, "Неверный или истёкший код подтверждения."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Шаг 3: сохранение нового пароля
  const handleSavePassword = async (event) => {
    event.preventDefault();
    clearMessages();

    if (password.length < 6 || password.length > 72) {
      setErrorMessage("Пароль должен содержать от 6 до 72 символов.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Пароли не совпадают.");
      return;
    }

    if (!resetToken) {
      setErrorMessage("Сессия восстановления истекла. Запросите новый код.");
      setStep(1);
      setCode("");
      setResetToken("");
      return;
    }

    setIsLoading(true);

    try {
      await completePasswordReset(resetToken, password);

      setSuccessMessage("Пароль успешно изменён!");
    } catch (error) {
      setErrorMessage(getError(error, "Не удалось обновить пароль."));
    } finally {
      setIsLoading(false);
    }
  };

  const goBack = () => {
    if (isLoading) return;

    clearMessages();

    if (step === 3) {
      setStep(2);
      setPassword("");
      setConfirmPassword("");
    } else if (step === 2) {
      setStep(1);
      setCode("");
      setResetToken("");
    } else {
      router.push("/login");
    }
  };

  const steps = ["Контакт", "Подтверждение", "Новый пароль"];

  return (
    <main className={styles.page}>
      <motion.div
        className={styles.glowOne}
        animate={{
          x: [0, 35, 0],
          y: [0, 25, 0],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
        }}
      />

      <motion.div
        className={styles.glowTwo}
        animate={{
          x: [0, -35, 0],
          y: [0, -25, 0],
        }}
        transition={{
          duration: 9,
          repeat: Infinity,
        }}
      />

      <motion.section
        className={styles.card}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <button
          type="button"
          className={styles.back}
          onClick={goBack}
          disabled={isLoading}
        >
          <ArrowLeft size={18} />
          <span>{step === 1 ? "Назад ко входу" : "Назад"}</span>
        </button>

        <div className={styles.brand}>
          <span className={styles.brandMark}>U</span>
          <span>UYTAP</span>
        </div>

        <div className={styles.heading}>
          <h1 className={styles.title}>Восстановление пароля</h1>

          <p className={styles.subtitle}>
            {step === 1 && "Восстановите доступ к своему аккаунту."}

            {step === 2 &&
              "Введите код подтверждения, который мы отправили вам."}

            {step === 3 && "Придумайте новый пароль для своего аккаунта."}
          </p>
        </div>

        <div className={styles.progress}>
          {steps.map((label, index) => {
            const number = index + 1;
            const active = step === number;
            const completed = step > number;

            return (
              <div className={styles.progressStep} key={label}>
                <div className={styles.progressTop}>
                  <span
                    className={[
                      styles.progressNumber,
                      active ? styles.progressActive : "",
                      completed ? styles.progressCompleted : "",
                    ].join(" ")}
                  >
                    {completed ? <Check size={14} /> : number}
                  </span>

                  {index < steps.length - 1 && (
                    <span
                      className={[
                        styles.progressLine,
                        completed ? styles.progressLineActive : "",
                      ].join(" ")}
                    />
                  )}
                </div>

                <span
                  className={[
                    styles.progressLabel,
                    active ? styles.progressLabelActive : "",
                  ].join(" ")}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className={styles.methodSwitch}>
            <button
              type="button"
              className={[
                styles.methodButton,
                method === "email" ? styles.methodActive : "",
              ].join(" ")}
              onClick={() => changeMethod("email")}
              disabled={isLoading}
            >
              <Mail size={17} />
              Почта
            </button>

            <button
              type="button"
              className={[
                styles.methodButton,
                method === "phone" ? styles.methodActive : "",
              ].join(" ")}
              onClick={() => changeMethod("phone")}
              disabled={isLoading}
            >
              <Smartphone size={17} />
              Телефон
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.form
              key={`contact-${method}`}
              onSubmit={method === "email" ? handleSendEmail : handleSendPhone}
              className={styles.form}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              {method === "email" ? (
                <div className={styles.field}>
                  <label htmlFor="forgot-email">Адрес электронной почты</label>

                  <div className={styles.inputBox}>
                    <Mail />

                    <input
                      id="forgot-email"
                      type="email"
                      placeholder="example@gmail.com"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        clearMessages();
                      }}
                      autoComplete="email"
                      autoFocus
                      required
                    />
                  </div>

                  <p className={styles.hint}>
                    Мы отправим код для подтверждения вашей личности.
                  </p>
                </div>
              ) : (
                <div className={styles.field}>
                  <label htmlFor="forgot-phone">Номер телефона</label>

                  <div className={styles.phoneBox}>
                    <Phone />

                    <input
                      id="forgot-phone"
                      type="text"
                      inputMode="numeric"
                      placeholder="+996 555 123 456"
                      value={phone}
                      onChange={(event) => {
                        let digits = event.target.value.replace(/\D/g, "");

                        // Убираем код страны, если он уже введён
                        if (digits.startsWith("996")) {
                          digits = digits.slice(3);
                        }

                        digits = digits.slice(0, 9);

                        let formatted = "+996";

                        if (digits.length > 0) {
                          formatted += " " + digits.slice(0, 3);
                        }
                        if (digits.length > 3) {
                          formatted += " " + digits.slice(3, 6);
                        }
                        if (digits.length > 6) {
                          formatted += " " + digits.slice(6, 9);
                        }

                        setPhone(formatted);
                        clearMessages();
                      }}
                      autoComplete="tel"
                      autoFocus
                      required
                    />
                  </div>

                  <p className={styles.hint}>
                    Введите кыргызстанский номер телефона без кода страны.
                  </p>
                </div>
              )}

              {errorMessage && (
                <p className={styles.error} role="alert">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className={styles.submit}
                disabled={
                  isLoading ||
                  (method === "email" ? !email.trim() : !phone.trim())
                }
              >
                {isLoading ? (
                  <>
                    <span className={styles.spinner} />
                    Подождите...
                  </>
                ) : (
                  <>
                    Получить код
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </motion.form>
          )}

          {step === 2 && (
            <motion.form
              key="verify"
              onSubmit={handleVerifyCode}
              className={styles.form}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.contactSummary}>
                <span className={styles.contactIcon}>
                  {method === "email" ? <Mail /> : <Smartphone />}
                </span>

                <div className={styles.contactText}>
                  <span>Код отправлен на</span>
                  <strong>{contact}</strong>
                </div>

                <button
                  type="button"
                  className={styles.editContact}
                  onClick={() => {
                    setStep(1);
                    setCode("");
                    clearMessages();
                  }}
                >
                  Изменить
                </button>
              </div>

              {infoMessage && (
                <div className={styles.infoNotice} role="status">
                  {infoMessage}
                </div>
              )}

              <div className={styles.field}>
                <label htmlFor="forgot-code">Код подтверждения</label>

                <div className={`${styles.inputBox} ${styles.codeBox}`}>
                  <ShieldCheck />

                  <input
                    id="forgot-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(event) => {
                      setCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      );
                      clearMessages();
                    }}
                    autoFocus
                    required
                  />

                  <span className={styles.codeCount}>{code.length}/6</span>
                </div>
              </div>

              {errorMessage && (
                <p className={styles.error} role="alert">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className={styles.submit}
                disabled={isLoading || code.length !== 6}
              >
                {isLoading ? (
                  <>
                    <span className={styles.spinner} />
                    Проверяем...
                  </>
                ) : (
                  <>
                    Подтвердить код
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              {method === "email" && (
                <div className={styles.resendBox}>
                  {countdown > 0 ? (
                    <span className={styles.countdownText}>
                      Повторная отправка через <strong>{countdown} сек.</strong>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.resendBtn}
                      onClick={handleResendCode}
                      disabled={isLoading}
                    >
                      <RefreshCw size={14} />
                      Отправить код повторно
                    </button>
                  )}
                </div>
              )}
            </motion.form>
          )}

          {step === 3 && (
            <motion.form
              key="password"
              onSubmit={handleSavePassword}
              className={styles.form}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              {successMessage ? (
                <div className={styles.successNotice}>
                  <span className={styles.successIcon}>
                    <Check size={22} />
                  </span>

                  <strong>{successMessage}</strong>

                  <p>Перенаправляем на страницу входа...</p>
                </div>
              ) : (
                <>
                  <div className={styles.field}>
                    <label htmlFor="new-password">Новый пароль</label>

                    <div className={styles.inputBox}>
                      <Lock />

                      <input
                        id="new-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Минимум 6 символов"
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          setErrorMessage("");
                        }}
                        minLength={6}
                        maxLength={72}
                        autoComplete="new-password"
                        autoFocus
                        required
                      />

                      <button
                        type="button"
                        className={styles.eye}
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={
                          showPassword ? "Скрыть пароль" : "Показать пароль"
                        }
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="confirm-password">
                      Повторите новый пароль
                    </label>

                    <div
                      className={[
                        styles.inputBox,
                        mismatch ? styles.inputInvalid : "",
                      ].join(" ")}
                    >
                      <Lock />

                      <input
                        id="confirm-password"
                        type={showConfirm ? "text" : "password"}
                        placeholder="Введите пароль ещё раз"
                        value={confirmPassword}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value);
                          setErrorMessage("");
                        }}
                        minLength={6}
                        maxLength={72}
                        autoComplete="new-password"
                        required
                      />

                      <button
                        type="button"
                        className={styles.eye}
                        onClick={() => setShowConfirm((value) => !value)}
                        aria-label={
                          showConfirm ? "Скрыть пароль" : "Показать пароль"
                        }
                      >
                        {showConfirm ? <EyeOff /> : <Eye />}
                      </button>
                    </div>

                    {mismatch && (
                      <p className={styles.error}>Пароли не совпадают.</p>
                    )}
                  </div>

                  <div className={styles.passwordHint}>
                    <ShieldCheck size={17} />
                    Пароль должен содержать от 6 до 72 символов.
                  </div>

                  {errorMessage && (
                    <p className={styles.error} role="alert">
                      {errorMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    className={styles.submit}
                    disabled={
                      isLoading ||
                      mismatch ||
                      password.length < 6 ||
                      !confirmPassword
                    }
                  >
                    {isLoading ? (
                      <>
                        <span className={styles.spinner} />
                        Сохраняем...
                      </>
                    ) : (
                      <>
                        Сохранить пароль
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </>
              )}
            </motion.form>
          )}
        </AnimatePresence>

        <div className={styles.bottom}>
          <span>Вспомнили пароль?</span>
          <Link href="/login">Войти</Link>
        </div>
      </motion.section>

      <div className={styles.footer}>
        <ShieldCheck size={14} />
        <span>UyTap · Безопасный доступ к аккаунту</span>
      </div>
    </main>
  );
}
