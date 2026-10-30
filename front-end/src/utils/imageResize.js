/**
 * Сжимает изображение в браузере (до maxDimension и качества quality).
 * Если размер уже мал (< 250 КБ) или браузер/среда не поддерживает Canvas,
 * возвращает исходный файл без изменений.
 *
 * @param {File|Blob} file Исходный файл изображения
 * @param {number} [maxDimension=1024] Максимальная ширина или высота (px)
 * @param {number} [quality=0.85] Качество сжатия JPEG (0..1)
 * @returns {Promise<File|Blob>} Сжатый File/Blob или оригинал
 */
export async function compressImageFile(file, maxDimension = 1024, quality = 0.85) {
  if (typeof window === "undefined" || !file || !(file instanceof Blob)) {
    return file;
  }

  // Не пережимаем GIF (чтобы не потерять анимацию) и SVG
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }

  // Если файл уже меньше 250 КБ, пересжимать не нужно
  if (file.size <= 250 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          let { width, height } = img;
          if (!width || !height) {
            return resolve(file);
          }

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            return resolve(file);
          }

          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob || blob.size >= file.size) {
                return resolve(file);
              }
              const originalName = file.name || "avatar.jpg";
              const safeName = originalName.replace(/\.[^.]+$/, "") + ".jpg";
              const compressedFile = new File([blob], safeName, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            },
            "image/jpeg",
            quality
          );
        } catch {
          resolve(file);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };

      img.src = url;
    } catch {
      resolve(file);
    }
  });
}
