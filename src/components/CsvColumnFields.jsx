/** CSV header names are case-sensitive and must match across dataset splits. */
export function CsvColumnFields({ value, onChange, disabled = false }) {
  if (value.datasetFormat !== "CSV") return null;
  const multiLabel = value.taskType === "Multi-Label Classification";
  if (value.taskType === "Semantic Segmentation") {
    return <div class="wizard-file-paths-section">
      <p class="wizard-sub-label">CSV columns</p>
      <span class="settings-hint">Use image_path and mask_path headers. This loader uses those names, or the first two columns, and reads labels from the mask pixels.</span>
    </div>;
  }
  return (
    <div class="wizard-file-paths-section">
      <p class="wizard-sub-label">CSV columns</p>
      <span class="settings-hint">Enter the exact column headers from your CSV. Use the same headers in train, validation and test files.</span>
      <div class="wizard-file-path-group">
        <label class="wizard-file-path-label">Image path column</label>
        <input class="wizard-input" type="text" value={value.imageColumn || ""}
          placeholder="e.g. image_path" disabled={disabled}
          onInput={(e) => onChange("imageColumn", e.target.value)} />
        <span class="settings-hint">The column containing each image’s filename or path. Leave blank to use the loader default.</span>
      </div>
      <div class="wizard-file-path-group">
        <label class="wizard-file-path-label">{multiLabel ? "Label columns" : "Label column"}</label>
        <input class="wizard-input" type="text" value={(multiLabel ? value.labelColumns : value.labelColumn) || ""}
          placeholder={multiLabel ? "e.g. cat, dog, bird" : "e.g. label"} disabled={disabled}
          onInput={(e) => onChange(multiLabel ? "labelColumns" : "labelColumn", e.target.value)} />
        <span class="settings-hint">{multiLabel
          ? "Comma-separated column names, each containing 0 or 1. Leave blank to use all columns except the image column."
          : "The column containing the class label. Leave blank to use the loader default."}</span>
      </div>
    </div>
  );
}
