import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deriveGraphFromRaw } from "../../src/domain/derive";
import type { RawExportV1 } from "../../src/domain/types";

vi.mock("../../src/features/graph/ServerGraphView", () => ({
  ServerGraphView: () => <section className="panel">Server Graph</section>
}));

import App from "../../src/App";

const samplePayload: RawExportV1 = {
  exported_at: "2026-03-07T00:00:00.000Z",
  source: "integration-test",
  servers: [
    {
      server_id: "A",
      server_name: "Alpha",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u2", username: "u2" },
        { user_id: "u3", username: "u3" }
      ]
    },
    {
      server_id: "B",
      server_name: "Beta",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u2", username: "u2" },
        { user_id: "u4", username: "u4" }
      ]
    },
    {
      server_id: "C",
      server_name: "Gamma",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u5", username: "u5" }
      ]
    }
  ]
};

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: { type: string; payload: RawExportV1 | string }) {
    setTimeout(() => {
      if (!this.onmessage) return;
      if (message.type === "DERIVE_GRAPH_FROM_JSON_TEXT") {
        const parsed = JSON.parse(String(message.payload)) as RawExportV1;
        const result = deriveGraphFromRaw(parsed);
        this.onmessage({ data: { type: "DERIVE_GRAPH_SUCCESS", payload: result } } as MessageEvent);
        return;
      }
      if (message.type === "DERIVE_GRAPH_FROM_RAW") {
        const result = deriveGraphFromRaw(message.payload as RawExportV1);
        this.onmessage({ data: { type: "DERIVE_GRAPH_SUCCESS", payload: result } } as MessageEvent);
      }
    }, 0);
  }

  terminate() {}
}

describe("App integration", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("handles import flow, filtering, search, and selection-driven inspector updates", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("Start by importing JSON")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Paste JSON"), {
      target: { value: JSON.stringify(samplePayload) }
    });
    await user.click(screen.getAllByRole("button", { name: "Import Pasted JSON" })[0]);

    await screen.findByText("Server Graph");
    expect(screen.getByText("Server Insights")).toBeInTheDocument();
    expect(screen.getByTestId("visible-edge-count")).toHaveTextContent("1");

    await user.clear(screen.getByLabelText("Search server by name or ID"));
    await user.type(screen.getByLabelText("Search server by name or ID"), "Beta");

    await waitFor(() => {
      expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText("Exact minimum"), { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByTestId("visible-edge-count")).toHaveTextContent("3");
    });
  });
});
