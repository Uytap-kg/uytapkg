"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import styles from "./MultiSelect.module.css";

export default function MultiSelect({
  icon: Icon,
  title,
  options = [],
  value = [],
  setValue,
}) {
  const { t } = useLanguage();

  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  const wrapperRef = useRef(null);

  // Получение значения опции
  function getOptionValue(option) {
    return option && typeof option === "object" ? option.value : option;
  }

  // Получение названия опции
  function getOptionLabel(option) {
    return option && typeof option === "object" ? option.label : option;
  }

  function getSelectedOption(valueItem) {
    return options.find((option) => getOptionValue(option) === valueItem);
  }

  // ==========================================
  // POSITIONING
  // ==========================================

  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const gap = 8;
    const edge = 10;
    const maxDropdownHeight = 300;

    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - edge);

    const spaceAbove = Math.max(0, rect.top - gap - edge);

    // Примерная необходимая высота списка
    const desiredHeight = Math.min(
      maxDropdownHeight,
      Math.max(80, options.length * 40 + 12),
    );

    // Если снизу мало места, а сверху больше — открываем вверх
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;

    const availableSpace = openUp ? spaceAbove : spaceBelow;

    const maxHeight = Math.max(80, Math.min(maxDropdownHeight, availableSpace));

    // Не позволяем списку выходить за края экрана
    const width = Math.min(rect.width, viewportWidth - edge * 2);

    const left = Math.max(
      edge,
      Math.min(rect.left, viewportWidth - width - edge),
    );

    setDropdownStyle({
      position: "fixed",
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      top: openUp ? "auto" : `${rect.bottom + gap}px`,
      bottom: openUp ? `${viewportHeight - rect.top + gap}px` : "auto",
    });
  }, [options.length]);

  // ==========================================
  // OPEN / CLOSE
  // ==========================================

  useEffect(() => {
    if (!open) {
      setDropdownStyle(null);
      return;
    }

    updatePosition();

    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePosition]);

  // Закрытие при клике вне списка
  useEffect(() => {
    if (!open) return;

    function handleOutside(event) {
      const target = event.target;

      if (wrapperRef.current?.contains(target)) {
        return;
      }

      if (
        target instanceof Element &&
        target.closest("[data-multi-select-dropdown]")
      ) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // ==========================================
  // VALUE
  // ==========================================

  function toggleValue(optionValue) {
    setValue(
      value.includes(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
  }

  // ==========================================
  // SELECTED LABEL
  // ==========================================

  let label;

  if (value.length === 0) {
    label = t("common.any");
  } else if (value.length === 1) {
    const selectedOption = getSelectedOption(value[0]);

    label = selectedOption ? getOptionLabel(selectedOption) : value[0];
  } else {
    label = `Выбрано: ${value.length}`;
  }

  // ==========================================
  // DROPDOWN
  // ==========================================

  const dropdown =
    open && dropdownStyle
      ? createPortal(
          <div
            data-multi-select-dropdown
            className={styles.dropdown}
            style={dropdownStyle}
            role="listbox"
            aria-multiselectable="true"
          >
            {options.map((option) => {
              const optionValue = getOptionValue(option);
              const optionLabel = getOptionLabel(option);

              const selected = value.includes(optionValue);

              return (
                <button
                  key={optionValue}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${styles.option} ${
                    selected ? styles.selected : ""
                  }`}
                  onClick={() => toggleValue(optionValue)}
                >
                  <span>{optionLabel}</span>

                  {selected && <Check size={16} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <>
      <div ref={wrapperRef} className={styles.wrapper}>
        <button
          type="button"
          className={`${styles.select} ${open ? styles.selectOpen : ""}`}
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <div className={styles.left}>
            {Icon && <Icon className={styles.icon} />}

            <div className={styles.content}>
              <span>{title}</span>
              <strong>{label}</strong>
            </div>
          </div>

          <ChevronDown
            className={`${styles.arrow} ${open ? styles.rotate : ""}`}
          />
        </button>
      </div>

      {dropdown}
    </>
  );
}
