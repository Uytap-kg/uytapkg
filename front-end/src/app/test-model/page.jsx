"use client";

import { useEffect, useState } from "react";

export default function TestModelPage() {
  const [status, setStatus] = useState("Загрузка модели...");
  const [details, setDetails] = useState(null);

  useEffect(() => {
    async function testModel() {
      try {
        const ort = await import("onnxruntime-web");

        ort.env.wasm.numThreads = 1;

        const session = await ort.InferenceSession.create(
          "/models/realesrgan-x4.onnx",
          {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          },
        );

        setDetails({
          inputs: session.inputNames,
          outputs: session.outputNames,
          inputMetadata: session.inputMetadata,
          outputMetadata: session.outputMetadata,
        });

        setStatus("Модель успешно загружена!");
      } catch (error) {
        console.error(error);
        setStatus(`Ошибка: ${error.message}`);
      }
    }

    testModel();
  }, []);

  return (
    <main style={{ padding: 30 }}>
      <h1>Real-ESRGAN Model Test</h1>
      <h2>{status}</h2>

      {details && (
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </main>
  );
}
