let sessionPromise = null;

const MODEL_URL = "/models/realesr-general-x4v3.onnx";
const SCALE = 4;
const MAX_INPUT_SIDE = 450;

// --------------------------------------------------
// SESSION
// --------------------------------------------------

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const sessionStart = performance.now();

      const ort = await import("onnxruntime-web");

      const isIsolated = globalThis.crossOriginIsolated === true;

      ort.env.wasm.numThreads = isIsolated
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

          console.log(
            `[Real-ESRGAN] Session initialization: ${(
              (performance.now() - sessionStart) /
              1000
            ).toFixed(2)} sec`,
          );

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

      // WASM fallback
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });

      console.log("[Real-ESRGAN] WASM enabled");

      console.log(
        `[Real-ESRGAN] Session initialization: ${(
          (performance.now() - sessionStart) /
          1000
        ).toFixed(2)} sec`,
      );

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

// --------------------------------------------------
// IMAGE TO TENSOR
// --------------------------------------------------

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

// --------------------------------------------------
// TENSOR TO CANVAS
// --------------------------------------------------

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

// --------------------------------------------------
// CANVAS TO WEBP
// --------------------------------------------------

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

// --------------------------------------------------
// AI UPSCALING
// --------------------------------------------------

export async function upscaleSmallImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Передан некорректный файл изображения");
  }

  // GIF не обрабатываем
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

  const totalStart = performance.now();

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  try {
    const { width, height } = bitmap;

    console.log(`[AI] Original image: ${width}x${height}`);

    // Большие изображения оставляем оригинальными
    if (Math.max(width, height) > MAX_INPUT_SIDE) {
      console.log("[AI] Skipped: image is larger than 450px");

      return {
        file,
        upscaled: false,
        width,
        height,
        reason: "image-too-large",
      };
    }

    // 1. Получение модели
    console.time("[AI] Model session");

    const { ort, session, provider } = await getSession();

    console.timeEnd("[AI] Model session");

    // 2. Подготовка Tensor
    console.time("[AI] Tensor preparation");

    const input = imageToTensor(bitmap, ort);

    console.timeEnd("[AI] Tensor preparation");

    let result;

    // 3. Инференс нейросети
    console.time("[AI] Neural network inference");

    try {
      result = await session.run({
        [session.inputNames[0]]: input,
      });
    } finally {
      input.dispose?.();
    }

    console.timeEnd("[AI] Neural network inference");

    const output = result[session.outputNames[0]];

    if (!output) {
      throw new Error("Модель не вернула результат");
    }

    let canvas;

    try {
      // 4. Преобразование результата
      console.time("[AI] Output conversion");

      canvas = tensorToCanvas(output);

      console.timeEnd("[AI] Output conversion");
    } finally {
      output.dispose?.();
    }

    if (canvas.width !== width * SCALE || canvas.height !== height * SCALE) {
      throw new Error(
        `Неверный размер результата: ${canvas.width}x${canvas.height}`,
      );
    }

    let blob;

    try {
      // 5. Экспорт WebP
      console.time("[AI] WebP export");

      blob = await canvasToBlob(canvas);

      console.timeEnd("[AI] WebP export");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "");

    const enhancedFile = new File([blob], `${baseName}-enhanced.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });

    const totalTime = ((performance.now() - totalStart) / 1000).toFixed(2);

    console.log("----------------------------------");
    console.log("[Real-ESRGAN] Processing completed");
    console.log(`Provider: ${provider}`);
    console.log(`Original: ${width}x${height}`);
    console.log(`Enhanced: ${width * SCALE}x${height * SCALE}`);
    console.log(`Output size: ${(blob.size / 1024).toFixed(2)} KB`);
    console.log(`Total processing: ${totalTime} sec`);
    console.log("----------------------------------");

    return {
      file: enhancedFile,
      upscaled: true,
      provider,
      width: canvas?.width || width * SCALE,
      height: height * SCALE,
      originalWidth: width,
      originalHeight: height,
      processingTime: Number(totalTime),
    };
  } catch (error) {
    console.error("[Real-ESRGAN] Processing failed:", error);
    throw error;
  } finally {
    bitmap.close();
  }
}
