"use client";

import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Upload,
  X,
  Star,
  GripVertical,
  ChevronRight,
  Images,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./StepImage.module.css";

const MAX_IMAGES = 20;

export default function StepImage({ form, updateForm, onNext }) {
  const { t } = useLanguage();

  const inputRef = useRef(null);

  const [images, setImages] = useState(form.images || []);
  const [isDragging, setIsDragging] = useState(false);

  /*
   * images:
   * [
   *   {
   *     id: "...",
   *     file: File,
   *     url: "blob:...",
   *   }
   * ]
   */

  useEffect(() => {
    updateForm({
      images,
    });
  }, [images]);

  function addImages(files) {
    const selectedFiles = Array.from(files);

    if (!selectedFiles.length) return;

    const available = MAX_IMAGES - images.length;

    if (available <= 0) return;

    const filesToAdd = selectedFiles
      .filter((file) => {
        if (file.type && file.type.toLowerCase().startsWith("image/")) return true;
        const ext = file.name?.split(".").pop()?.toLowerCase();
        return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
      })
      .slice(0, available);

    const newImages = filesToAdd.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      url: URL.createObjectURL(file),
    }));

    setImages((prev) => [...prev, ...newImages]);
  }

  function handleFileChange(event) {
    addImages(event.target.files);

    // Позволяет повторно выбрать тот же файл
    event.target.value = "";
  }

  function removeImage(id) {
    setImages((prev) => {
      const image = prev.find((item) => item.id === id);

      if (image) {
        URL.revokeObjectURL(image.url);
      }

      return prev.filter((item) => item.id !== id);
    });
  }

  function setMainImage(id) {
    setImages((prev) => {
      const index = prev.findIndex((item) => item.id === id);

      if (index === -1 || index === 0) return prev;

      const selected = prev[index];

      return [selected, ...prev.filter((item) => item.id !== id)];
    });
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);

    addImages(event.dataTransfer.files);
  }

  function handleNext() {
    if (!images.length) return;

    onNext();
  }

  const canContinue = images.length > 0;
  const remaining = MAX_IMAGES - images.length;

  return (
    <div className={styles.step}>
      {/* HEADER */}

      <div className={styles.header}>
        <div className={styles.stepBadge}>
          <span className={styles.stepDot} />
          {t("stepImage.step")}
        </div>

        <h1>{t("stepImage.title")}</h1>

        <p>{t("stepImage.description")}</p>
      </div>

      {/* UPLOAD SECTION */}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <div className={styles.sectionIcon}>
            <Images size={19} />
          </div>

          <div>
            <label>{t("stepImage.upload.title")}</label>

            <span>
              {t("stepImage.upload.limit")} {MAX_IMAGES}{" "}
              {t("stepImage.upload.images")}
            </span>
          </div>
        </div>

        <div
          className={`${styles.uploadZone} ${
            isDragging ? styles.dragging : ""
          } ${images.length >= MAX_IMAGES ? styles.disabled : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => {
            if (images.length < MAX_IMAGES) {
              inputRef.current?.click();
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            multiple
            onChange={handleFileChange}
            hidden
          />

          <div className={styles.uploadIcon}>
            <ImagePlus size={28} />
          </div>

          <div className={styles.uploadContent}>
            <strong>
              {images.length >= MAX_IMAGES
                ? t("stepImage.upload.limitReached")
                : t("stepImage.upload.addPhotos")}
            </strong>

            <span>
              {t("stepImage.upload.dragText")}{" "}
              <b>{t("stepImage.upload.chooseOnDevice")}</b>
            </span>

            <small>
              JPG, PNG или WebP · {t("stepImage.upload.upTo")} {MAX_IMAGES}{" "}
              {t("stepImage.upload.photos")}
            </small>
          </div>

          {images.length < MAX_IMAGES && (
            <button
              type="button"
              className={styles.uploadButton}
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              <Upload size={17} />
              {t("stepImage.upload.chooseFiles")}
            </button>
          )}
        </div>
      </div>

      {/* COUNTER */}

      <div className={styles.counter}>
        <div className={styles.counterLeft}>
          <div className={styles.counterIcon}>
            <Images size={17} />
          </div>

          <div>
            <strong>
              {images.length} {t("stepImage.counter.of")} {MAX_IMAGES}
            </strong>

            <span>
              {images.length === 0
                ? t("stepImage.counter.empty")
                : remaining === 0
                  ? t("stepImage.counter.maximum")
                  : `${t("stepImage.counter.canAdd")} ${remaining}`}
            </span>
          </div>
        </div>

        <div className={styles.progress}>
          <div
            className={styles.progressValue}
            style={{
              width: `${(images.length / MAX_IMAGES) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* IMAGES */}

      {images.length > 0 && (
        <div className={styles.gallerySection}>
          <div className={styles.galleryHeader}>
            <div>
              <h2>{t("stepImage.gallery.title")}</h2>

              <p>{t("stepImage.gallery.description")}</p>
            </div>

            <span className={styles.photoCount}>
              {images.length} {t("stepImage.gallery.photos")}
            </span>
          </div>

          <div className={styles.gallery}>
            {images.map((image, index) => (
              <div
                key={image.id}
                className={`${styles.photoCard} ${
                  index === 0 ? styles.mainPhoto : ""
                }`}
              >
                <div className={styles.photo}>
                  <img
                    src={image.url}
                    alt={`${t("stepImage.photoAlt")} ${index + 1}`}
                  />

                  <div className={styles.photoOverlay}>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => removeImage(image.id)}
                      aria-label={t("stepImage.remove")}
                    >
                      <X size={17} />
                    </button>
                  </div>

                  {index === 0 && (
                    <div className={styles.mainBadge}>
                      <Star size={13} fill="currentColor" />
                      {t("stepImage.mainPhoto")}
                    </div>
                  )}

                  {index !== 0 && (
                    <button
                      type="button"
                      className={styles.makeMain}
                      onClick={() => setMainImage(image.id)}
                    >
                      <Star size={14} />
                      {t("stepImage.makeMain")}
                    </button>
                  )}

                  <div className={styles.dragHandle}>
                    <GripVertical size={16} />
                  </div>
                </div>

                <div className={styles.photoInfo}>
                  <span>
                    {t("stepImage.photo")} {index + 1}
                  </span>

                  {index === 0 && (
                    <span className={styles.mainText}>
                      {t("stepImage.main")}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* ADD MORE */}

            {images.length < MAX_IMAGES && (
              <button
                type="button"
                className={styles.addMore}
                onClick={() => inputRef.current?.click()}
              >
                <div className={styles.addMoreIcon}>
                  <ImagePlus size={24} />
                </div>

                <strong>{t("stepImage.addMore")}</strong>

                <span>
                  {t("stepImage.remaining")} {remaining}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* EMPTY STATE */}

      {images.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <ImagePlus size={22} />
          </div>

          <div>
            <strong>{t("stepImage.empty.title")}</strong>

            <span>{t("stepImage.empty.description")}</span>
          </div>
        </div>
      )}

      {/* ACTIONS */}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!canContinue}
          onClick={handleNext}
        >
          {t("stepImage.continue")}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
