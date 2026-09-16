/// <reference lib="webworker" />

import { deriveGraphFromRaw } from "../domain/derive";
import type { RawExportV1, WorkerRequestMessage, WorkerResponseMessage } from "../domain/types";

const post = (message: WorkerResponseMessage): void => {
  self.postMessage(message);
};

const handleDerive = (raw: RawExportV1): void => {
  try {
    const payload = deriveGraphFromRaw(raw);
    post({
      type: "DERIVE_GRAPH_SUCCESS",
      payload
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown derivation error.";
    post({
      type: "DERIVE_GRAPH_ERROR",
      error: {
        code: "DERIVE_FAILED",
        message
      }
    });
  }
};

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    post({
      type: "DERIVE_GRAPH_ERROR",
      error: {
        code: "INVALID_INPUT",
        message: "Worker received an invalid request object."
      }
    });
    return;
  }

  if (message.type === "DERIVE_GRAPH_FROM_RAW") {
    handleDerive(message.payload);
    return;
  }

  if (message.type === "DERIVE_GRAPH_FROM_JSON_TEXT") {
    try {
      const parsed = JSON.parse(message.payload) as RawExportV1;
      handleDerive(parsed);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not parse JSON payload.";
      post({
        type: "DERIVE_GRAPH_ERROR",
        error: {
          code: "INVALID_INPUT",
          message: messageText
        }
      });
    }
    return;
  }

  post({
    type: "DERIVE_GRAPH_ERROR",
    error: {
      code: "INVALID_INPUT",
      message: "Unsupported worker message type."
    }
  });
};
