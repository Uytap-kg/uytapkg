let sessionPromise = null;

const MODEL_URL = "/models/realesrgan-x4.onnx";
const SCALE = 4;
const MAX_INPUT_SIDE = 450;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-web");

      // WASM fallback
      ort.env.wasm.numThreads = crossOriginIsolated
        ? Math.min(navigator.hardwareConcurrency || 2, 4)
        : 1;

      // Сначала пробуем WebGPU
      if (navigator.gpu) {
        try {
          const session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ["webgpu"],
            graphOptimizationLevel: "all",
          });

          console.log("[Real-ESRGAN] WebGPU enabled");

          return {
            ort,
            session,
            provider: "webgpu",
          };
        } catch (error) {
          console.warn(
            "[Real-ESRGAN] WebGPU unavailable. Switching to WASM:",
            error,
          );
        }
      }

      // Если WebGPU недоступен — используем WASM
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });

      console.log("[Real-ESRGAN] WASM enabled");

      return {
        ort,
        session,
        provider: "wasm",
      };
    })();
  }

  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

// Преобразование изображения в RGB Tensor
function imageToTensor(bitmap, ort) {
  const { width, height } = bitmap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!ctx) {
    throw new Error("Не удалось создать Canvas context");
  }

  ctx.drawImage(bitmap, 0, 0);

  const pixels = ctx.getImageData(0, 0, width, height).data;

  const size = width * height;
  const data = new Float32Array(size * 3);

  for (let i = 0; i < size; i++) {
    data[i] = pixels[i * 4] / 255;
    data[size + i] = pixels[i * 4 + 1] / 255;
    data[size * 2 + i] = pixels[i * 4 + 2] / 255;
  }

  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

// Преобразование результата нейросети в Canvas
function tensorToCanvas(output) {
  const [batch, channels, height, width] = output.dims;

  if (batch !== 1 || channels !== 3) {
    throw new Error("Неподдерживаемый формат результата модели");
  }

  const data = output.data;
  const size = width * height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Не удалось создать Canvas context");
  }

  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < size; i++) {
    imageData.data[i * 4] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);

    imageData.data[i * 4 + 1] = Math.round(
      Math.min(1, Math.max(0, data[size + i])) * 255,
    );

    imageData.data[i * 4 + 2] = Math.round(
      Math.min(1, Math.max(0, data[size * 2 + i])) * 255,
    );

    imageData.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

// Экспорт Canvas в WebP
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Не удалось сохранить обработанное изображение"));
        }
      },
      "image/webp",
      0.92,
    );
  });
}

// Основная функция AI Upscaling
export async function upscaleSmallImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Передан некорректный файл изображения");
  }

  // GIF не обрабатываем, чтобы не терять анимацию
  if (
    file.type.toLowerCase() === "image/gif" ||
    file.name.toLowerCase().endsWith(".gif")
  ) {
    return {
      file,
      upscaled: false,
      reason: "gif",
    };
  }

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  try {
    const { width, height } = bitmap;

    // Большие изображения оставляем оригинальными
    if (Math.max(width, height) > MAX_INPUT_SIDE) {
      return {
        file,
        upscaled: false,
        width,
        height,
        reason: "image-too-large",
      };
    }

    // Получаем уже загруженную модель или загружаем её один раз
    const { ort, session, provider } = await getSession();

    // Подготавливаем входной Tensor
    const input = imageToTensor(bitmap, ort);

    // Запускаем нейросеть
    const result = await session.run({
      [session.inputNames[0]]: input,
    });

    const output = result[session.outputNames[0]];

    if (!output) {
      throw new Error("Модель не вернула результат");
    }

    // Проверяем размер результата
    const canvas = tensorToCanvas(output);

    if (canvas.width !== width * SCALE || canvas.height !== height * SCALE) {
      throw new Error("Неожиданный размер результата модели");
    }

    // Сохраняем улучшенную фотографию
    const blob = await canvasToBlob(canvas);

    const baseName = file.name.replace(/\.[^.]+$/, "");

    const enhancedFile = new File([blob], `${baseName}-enhanced.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });

    return {
      file: enhancedFile,
      upscaled: true,
      provider,
      width: canvas.width,
      height: canvas.height,
      originalWidth: width,
      originalHeight: height,
    };
  } finally {
    bitmap.close();
  }
}
