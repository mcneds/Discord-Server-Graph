import { useRef, useState } from "react";
import { useGraphStore } from "../../state/useGraphStore";

type ImportControlsProps = {
  onImportFile: (file: File) => Promise<void>;
  onImportJsonText: (json: string) => void;
};

export const ImportControls = ({ onImportFile, onImportJsonText }: ImportControlsProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const status = useGraphStore((state) => state.status);
  const error = useGraphStore((state) => state.errorMessage);
  const reset = useGraphStore((state) => state.reset);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await onImportFile(file);
      setLocalMessage(`Imported ${file.name}`);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "Failed to import file.";
      setLocalMessage(message);
    } finally {
      event.currentTarget.value = "";
    }
  };

  const handleImportText = () => {
    if (!pasteText.trim()) {
      setLocalMessage("Paste JSON before importing.");
      return;
    }
    onImportJsonText(pasteText);
    setLocalMessage("Submitted JSON payload to worker.");
  };

  return (
    <section className="panel">
      <h2>Import</h2>
      <p className="muted">Load `mutual-server-members.json` or paste raw JSON.</p>
      <div className="row gap-sm wrap">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Choose JSON File
        </button>
        <button type="button" className="ghost" onClick={reset}>
          Reset
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      <label htmlFor="paste-json" className="field-label">
        Paste JSON
      </label>
      <textarea
        id="paste-json"
        value={pasteText}
        onChange={(event) => setPasteText(event.target.value)}
        placeholder='{"servers":[...]}'
        rows={6}
      />
      <button type="button" onClick={handleImportText} disabled={status === "deriving"}>
        Import Pasted JSON
      </button>

      <div className="status-block">
        <div>
          <span className="muted">Status:</span> <strong>{status}</strong>
        </div>
        {error ? <div className="error">{error}</div> : null}
        {localMessage ? <div className="muted">{localMessage}</div> : null}
      </div>
    </section>
  );
};
