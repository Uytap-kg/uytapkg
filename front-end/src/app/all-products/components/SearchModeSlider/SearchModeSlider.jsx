"use client";

import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import styles from "./SearchModeSlider.module.css";

export default function SearchModeSlider({ value, onChange }) {
  const { t } = useLanguage();
  const isSmart = value === "smart";

  return (
    <div className={styles.wrapper}>
      <div className={styles.slider}>
        <div
          className={`${styles.thumb} ${isSmart ? styles.thumbSmart : ""}`}
        />

        <button
          type="button"
          className={`${styles.option} ${!isSmart ? styles.active : ""}`}
          onClick={() => onChange("filters")}
          aria-pressed={!isSmart}
        >
          <SlidersHorizontal size={15} />
          <span>{t("searchModeSlider.filters.title")}</span>
        </button>

        <button
          type="button"
          className={`${styles.option} ${isSmart ? styles.active : ""}`}
          onClick={() => onChange("smart")}
          aria-pressed={isSmart}
        >
          <Sparkles size={15} />
          <span>
            <strong>UyTap AI - Умный поиск</strong>
          </span>
        </button>
      </div>
    </div>
  );
}
