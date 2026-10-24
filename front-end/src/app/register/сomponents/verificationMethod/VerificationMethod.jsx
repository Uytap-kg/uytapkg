"use client";

import { Mail, MessageSquareText } from "lucide-react";
import styles from "./VerificationMethod.module.css";

export default function VerificationMethod({ value, onChange }) {
  return (
    <fieldset className={styles.wrapper}>
      <legend className={styles.title}>
        Куда отправить код подтверждения?
      </legend>

      <div className={styles.options}>
        <label
          className={`${styles.option} ${
            value === "email" ? styles.active : ""
          }`}
        >
          <input
            type="radio"
            name="verificationMethod"
            value="email"
            checked={value === "email"}
            onChange={() => onChange("email")}
          />

          <Mail size={20} />

          <span>
            <strong>На email</strong>
            <small>Получить код письмом</small>
          </span>
        </label>

        <label
          className={`${styles.option} ${
            value === "phone" ? styles.active : ""
          }`}
        >
          <input
            type="radio"
            name="verificationMethod"
            value="phone"
            checked={value === "phone"}
            onChange={() => onChange("phone")}
          />

          <MessageSquareText size={20} />

          <span>
            <strong>По SMS</strong>
            <small>Получить код на телефон</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
