"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

import styles from "./CustomSelectSmall.module.css";

export default function CustomSelectSmall({
  icon: Icon,
  title,
  options = [],
  value,
  setValue,
  placeholder,
  disabled = false,
}) {
  const { t } = useLanguage();

  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);

  const wrapperRef = useRef(null);

  const GAP = 6;
  const MAX_HEIGHT = 260;
  const MIN_HEIGHT = 100;

  const getOptionValue = (option) =>
    typeof option === "object" ? option.value : option;

  const getOptionLabel = (option) =>
    typeof option === "object" ? option.label : option;

  const selectedOption = options.find(
    (option) => getOptionValue(option) === value,
  );

  const selectedLabel = selectedOption
    ? getOptionLabel(selectedOption)
    : value || placeholder || t("common.any");

  const updateDropdownPosition = useCallback(() => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();

    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;

    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;

    const availableSpace = openUp ? spaceAbove : spaceBelow;

    const availableHeight = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, availableSpace),
    );

    setDropdownStyle({
      position: "fixed",
      top: openUp ? `${rect.top - GAP}px` : `${rect.bottom + GAP}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${availableHeight}px`,
      transform: openUp ? "translateY(-100%)" : "none",
    });
  }, []);

  function toggleDropdown() {
    if (disabled) return;

    if (!open) {
      updateDropdownPosition();
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  // Обновляем позицию при прокрутке и изменении размера окна.
  useEffect(() => {
    if (!open) return;

    updateDropdownPosition();

    const handleResize = () => updateDropdownPosition();
    const handleScroll = () => updateDropdownPosition();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updateDropdownPosition]);

  // Закрытие при клике вне компонента.
  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event) {
      const target = event.target;

      const insideSelect = wrapperRef.current?.contains(target);

      const insideDropdown = target.closest(
        "[data-custom-select-small-dropdown]",
      );

      if (!insideSelect && !insideDropdown) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  // Закрытие по Escape.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Пересчитываем позицию, если размеры поля изменились.
  useEffect(() => {
    if (!open || !wrapperRef.current) return;

    const observer = new ResizeObserver(() => {
      updateDropdownPosition();
    });

    observer.observe(wrapperRef.current);

    return () => observer.disconnect();
  }, [open, updateDropdownPosition]);

  const dropdown =
    open && dropdownStyle
      ? createPortal(
          <div
            data-custom-select-small-dropdown
            className={styles.dropdown}
            style={dropdownStyle}
            role="listbox"
          >
            {options.length > 0 ? (
              options.map((option, index) => {
                const optionValue = getOptionValue(option);
                const optionLabel = getOptionLabel(option);
                const isSelected = value === optionValue;

                return (
                  <button
                    type="button"
                    key={`${optionValue}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.option} ${
                      isSelected ? styles.optionSelected : ""
                    }`}
                    onClick={() => {
                      setValue(optionValue);
                      setOpen(false);
                    }}
                  >
                    <span>{optionLabel}</span>
                  </button>
                );
              })
            ) : (
              <div className={styles.empty}>{t("common.noOptions")}</div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={wrapperRef} className={styles.wrapper}>
        <button
          type="button"
          className={`${styles.select} ${
            open ? styles.selectOpen : ""
          } ${disabled ? styles.disabled : ""}`}
          onClick={toggleDropdown}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
        >
          <div className={styles.left}>
            {Icon && <Icon className={styles.icon} />}

            <div className={styles.text}>
              {title && <span className={styles.title}>{title}</span>}

              <span className={styles.value} title={String(selectedLabel)}>
                {selectedLabel}
              </span>
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
