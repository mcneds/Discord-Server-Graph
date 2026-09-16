import { useCallback, useEffect, useRef } from "react";
import { useGraphStore } from "../../state/useGraphStore";
import type { RawExportV1, WorkerResponseMessage } from "../../domain/types";

const WORKER_PATH = new URL("../../worker/graphWorker.ts", import.meta.url);

export const useImportWorker = () => {
  const workerRef = useRef<Worker | null>(null);
  const beginDerive = useGraphStore((state) => state.beginDerive);
  const setDeriveSuccess = useGraphStore((state) => state.setDeriveSuccess);
  const setDeriveError = useGraphStore((state) => state.setDeriveError);

  useEffect(() => {
    const worker = new Worker(WORKER_PATH, { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.type === "DERIVE_GRAPH_SUCCESS") {
        setDeriveSuccess(message.payload);
        return;
      }
      if (message.type === "DERIVE_GRAPH_ERROR") {
        setDeriveError(message.error.message);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [setDeriveError, setDeriveSuccess]);

  const importFromRaw = useCallback(
    (payload: RawExportV1) => {
      if (!workerRef.current) return;
      beginDerive();
      workerRef.current.postMessage({
        type: "DERIVE_GRAPH_FROM_RAW",
        payload
      });
    },
    [beginDerive]
  );

  const importFromJsonText = useCallback(
    (payload: string) => {
      if (!workerRef.current) return;
      beginDerive();
      workerRef.current.postMessage({
        type: "DERIVE_GRAPH_FROM_JSON_TEXT",
        payload
      });
    },
    [beginDerive]
  );

  const importFromFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      importFromJsonText(content);
    },
    [importFromJsonText]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type !== "mutual-graph:import-v1") return;
      if (!message.payload || typeof message.payload !== "object") return;
      importFromRaw(message.payload as RawExportV1);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [importFromRaw]);

  return {
    importFromRaw,
    importFromJsonText,
    importFromFile
  };
};
