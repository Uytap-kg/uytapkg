import JSZip from "jszip";

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Не удалось конвертировать фотографию в JPG"));
      },
      "image/jpeg",
      0.95,
    );
  });
}

async function convertToJpg(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить фотографию: ${url}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Не удалось создать Canvas");
    }

    // Белый фон для корректной конвертации PNG с прозрачностью
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(bitmap, 0, 0);

    return await canvasToJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

export async function downloadInstagramImages(images, title = "uytap-listing") {
  if (!images?.length) {
    throw new Error("У объявления нет фотографий");
  }

  const zip = new JSZip();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];

    const url =
      typeof image === "string"
        ? image
        : image?.url || image?.publicUrl || image?.imageUrl;

    if (!url) continue;

    const jpgBlob = await convertToJpg(url);

    zip.file(`photo-${String(i + 1).padStart(2, "0")}.jpg`, jpgBlob);
  }

  const archive = await zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });

  const objectUrl = URL.createObjectURL(archive);
  const link = document.createElement("a");

  const safeTitle = title
    .replace(/[<>:"/\\|?*]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);

  link.href = objectUrl;
  link.download = `${safeTitle || "uytap-listing"}-photos.zip`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
