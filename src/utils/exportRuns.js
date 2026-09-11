/**
 * Export run data as CSV or JSON and trigger browser download.
 */

export function exportRunsAsCSV(runs) {
  if (!runs.length) return "";

  // Collect all unique keys across runs
  const keys = new Set();
  for (const run of runs) {
    for (const key of Object.keys(run)) {
      // Skip large nested objects
      if (key === "scalars" || key === "lossCurve" || key === "accCurve") continue;
      keys.add(key);
    }
  }

  const columns = [...keys].sort();
  const header = columns.map(escapeCSV).join(",");
  const rows = runs.map((run) =>
    columns
      .map((col) => {
        const val = run[col];
        if (val == null) return "";
        if (typeof val === "object") return escapeCSV(JSON.stringify(val));
        return escapeCSV(String(val));
      })
      .join(","),
  );

  return [header, ...rows].join("\n");
}

function escapeCSV(str) {
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportRunsAsJSON(runs) {
  // Strip large nested data for cleaner export
  const cleaned = runs.map((run) => {
    const out = {};
    for (const [key, val] of Object.entries(run)) {
      if (key === "scalars" || key === "lossCurve" || key === "accCurve") continue;
      out[key] = val;
    }
    return out;
  });
  return JSON.stringify(cleaned, null, 2);
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
