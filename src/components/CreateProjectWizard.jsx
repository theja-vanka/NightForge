import { CsvColumnFields } from "./CsvColumnFields.jsx";
import { invoke } from "@tauri-apps/api/core";
import { useState, useRef, useEffect } from "preact/hooks";
import { platform } from "../state/dashboard.js";
import {
  wizardOpen,
  wizardStep,
  wizardData,
  wizardCanProceed,
  closeWizard,
  wizardNext,
  wizardBack,
  wizardSetField,
  wizardCreate,
  STEP_COUNT,
  STEP_LABELS,
  TASK_TYPES,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
  DETECTION_ARCHS,
  SEG_HEAD_TYPES,
  DATASET_FORMATS,
  trainPathError,
  valPathError,
  testPathError,
} from "../state/projects.js";
import {
  wizardTutorialDismissed,
  wizardStepTips,
  maybeStartWizardTutorial,
  dismissWizardTutorial,
} from "../state/tutorial.js";

// ── Wizard Tutorial Tip ──

function WizardTip({ stepIndex }) {
  if (wizardTutorialDismissed.value) return null;
  const tip = wizardStepTips[stepIndex];
  if (!tip) return null;

  return (
    <div class="wizard-tip">
      <div class="wizard-tip-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
      <div class="wizard-tip-content">
        <strong class="wizard-tip-title">{tip.title}</strong>
        <p class="wizard-tip-body">{tip.body}</p>
      </div>
      <button class="wizard-tip-dismiss" onClick={dismissWizardTutorial} title="Dismiss tips">
        &times;
      </button>
    </div>
  );
}

// ── Step 0: SSH ──

function StepSSH() {
  const d = wizardData.value;
  const isRemote = d.connectionType === "remote";
  const [testStatus, setTestStatus] = useState("idle"); // "idle" | "testing" | "success" | "error"
  const [testMessage, setTestMessage] = useState("");

  const connectionTypes = [
    { id: "localhost", label: "Localhost", desc: "Run on this machine" },
    { id: "remote", label: "Remote Instance", desc: "Connect via SSH" },
  ];

  const isValidSshCommand = (cmd) => {
    const parts = cmd.trim().split(/\s+/);
    return parts.length >= 2 && parts[0] === "ssh";
  };

  const handleTestSSH = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const msg = await invoke("test_ssh", { sshCommand: d.sshCommand });
      setTestStatus("success");
      setTestMessage(msg);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(typeof err === "string" ? err : "Connection failed");
    }
  };

  return (
    <div>
      <p class="wizard-step-title">Connect to Instance</p>
      <p class="wizard-step-desc">Choose where to run your training.</p>

      <div class="wizard-category-list">
        {connectionTypes.map((type) => (
          <button
            key={type.id}
            class={`wizard-category${d.connectionType === type.id ? " selected" : ""}`}
            onClick={() => {
              wizardSetField("connectionType", type.id);
              setTestStatus("idle");
              setTestMessage("");
              if (type.id === "localhost") {
                wizardSetField("sshCommand", "localhost");
              } else {
                wizardSetField("sshCommand", "");
              }
            }}
          >
            <span class="wizard-category-name">{type.label}</span>
            <span class="wizard-category-desc">{type.desc}</span>
          </button>
        ))}
      </div>

      {isRemote && (
        <div class="wizard-ssh-input-section">
          <p class="wizard-sub-label">
            SSH Command <span class="wizard-required-indicator">*</span>
          </p>
          <input
            class="wizard-input wizard-input-mono"
            type="text"
            placeholder="ssh user@gpu-server.example.com"
            value={d.sshCommand}
            onInput={(e) => {
              wizardSetField("sshCommand", e.target.value);
              setTestStatus("idle");
              setTestMessage("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
            }}
            autoComplete="off"
            autoFocus
          />
          <div class="wizard-ssh-test-row">
            <button
              class="wizard-btn wizard-btn-secondary wizard-ssh-test-btn"
              onClick={handleTestSSH}
              disabled={
                !isValidSshCommand(d.sshCommand) || testStatus === "testing"
              }
            >
              {testStatus === "testing" && <span class="wizard-ssh-spinner" />}
              {testStatus === "testing" ? "Testing…" : "Test SSH"}
            </button>
            {testMessage && (
              <div class={`wizard-ssh-test-result ${testStatus}`}>
                <span class="wizard-ssh-test-icon">
                  {testStatus === "success" ? "✓" : "✗"}
                </span>
                <span class="wizard-ssh-test-message">{testMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 1: Name ──

function StepName() {
  const d = wizardData.value;

  const sanitizeName = (name) => {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const DEFAULT_BASE = platform.value === "windows" ? "~\\nightflow\\projects\\" : "~/nightflow/projects/";

  const derivedPath = d.name
    ? `${DEFAULT_BASE}${sanitizeName(d.name)}`
    : DEFAULT_BASE;

  // Auto if path is empty, equals base, or equals the current derived path
  const pathIsAuto = useRef(
    !d.projectPath ||
      d.projectPath === DEFAULT_BASE ||
      d.projectPath === derivedPath,
  );

  const handleNameInput = (e) => {
    const name = e.target.value;
    wizardSetField("name", name);
    if (pathIsAuto.current) {
      const sanitized = sanitizeName(name);
      wizardSetField(
        "projectPath",
        sanitized ? `${DEFAULT_BASE}${sanitized}` : DEFAULT_BASE,
      );
    }
  };

  const handlePathInput = (e) => {
    const val = e.target.value;
    if (val) {
      wizardSetField("projectPath", val);
      pathIsAuto.current = false;
    } else {
      wizardSetField("projectPath", derivedPath);
      pathIsAuto.current = true;
    }
  };

  return (
    <div>
      <p class="wizard-step-title">Project Name</p>
      <p class="wizard-step-desc">Give your project a descriptive name.</p>
      <input
        class="wizard-input"
        type="text"
        placeholder="e.g. ImageNet Classifier"
        value={d.name}
        onInput={handleNameInput}
        onKeyDown={(e) => {
          if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
        }}
        autoComplete="off"
        autoFocus
      />

      <div class="wizard-project-path-section">
        <p class="wizard-sub-label">
          Project Path <span class="wizard-optional-indicator">(optional)</span>
        </p>
        <input
          class="wizard-input wizard-input-mono"
          type="text"
          value={pathIsAuto.current ? "" : d.projectPath}
          placeholder={derivedPath}
          onInput={handlePathInput}
          onKeyDown={(e) => {
            if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
          }}
        />
      </div>
    </div>
  );
}

// ── Step 2: Task Type ──

const TASK_EXAMPLES = {
  Classification: (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      <defs>
        <linearGradient id="cls-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4a90d9" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#67b26f" stop-opacity="0.15" />
        </linearGradient>
      </defs>
      {/* Photo card */}
      <rect
        x="20"
        y="16"
        width="84"
        height="84"
        rx="10"
        fill="url(#cls-photo)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="28"
        y="24"
        width="68"
        height="50"
        rx="6"
        fill="var(--accent)"
        opacity="0.06"
      />
      {/* Stylized photo icon */}
      <circle cx="48" cy="42" r="6" fill="var(--accent)" opacity="0.18" />
      <polygon
        points="32,68 52,46 72,58 88,48 88,68"
        fill="var(--accent)"
        opacity="0.12"
      />
      <text
        x="62"
        y="88"
        text-anchor="middle"
        font-size="8"
        font-weight="500"
        fill="var(--text-muted)"
      >
        image.jpg
      </text>
      {/* Arrow */}
      <path
        d="M112,58 L134,58"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
        marker-end="url(#cls-arrow)"
      />
      <polygon
        id="cls-arr"
        points="134,55 140,58 134,61"
        fill="var(--text-muted)"
      />
      {/* Output label card */}
      <rect
        x="148"
        y="34"
        width="56"
        height="48"
        rx="8"
        fill="var(--accent)"
        opacity="0.08"
        stroke="var(--accent)"
        stroke-width="1.2"
      />
      <text
        x="176"
        y="54"
        text-anchor="middle"
        font-size="10"
        font-weight="600"
        fill="var(--accent)"
      >
        Cat
      </text>
      <text
        x="176"
        y="68"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        97.3%
      </text>
      {/* Bottom bar chart */}
      <text x="30" y="122" font-size="7" fill="var(--text-muted)">
        cat
      </text>
      <rect
        x="50"
        y="115"
        width="130"
        height="10"
        rx="3"
        fill="var(--accent)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="115"
        width="124"
        height="10"
        rx="3"
        fill="var(--accent)"
        opacity="0.5"
      />
      <text x="30" y="138" font-size="7" fill="var(--text-muted)">
        dog
      </text>
      <rect
        x="50"
        y="131"
        width="130"
        height="10"
        rx="3"
        fill="var(--accent)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="131"
        width="18"
        height="10"
        rx="3"
        fill="var(--text-muted)"
        opacity="0.25"
      />
      <text x="30" y="154" font-size="7" fill="var(--text-muted)">
        bird
      </text>
      <rect
        x="50"
        y="147"
        width="130"
        height="10"
        rx="3"
        fill="var(--accent)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="147"
        width="6"
        height="10"
        rx="3"
        fill="var(--text-muted)"
        opacity="0.15"
      />
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        One label per image
      </text>
    </svg>
  ),
  "Multi-Label Classification": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      <defs>
        <linearGradient id="ml-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e8a035" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#5b9bd5" stop-opacity="0.15" />
        </linearGradient>
      </defs>
      {/* Photo card */}
      <rect
        x="20"
        y="24"
        width="84"
        height="84"
        rx="10"
        fill="url(#ml-photo)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="28"
        y="32"
        width="68"
        height="50"
        rx="6"
        fill="var(--accent)"
        opacity="0.06"
      />
      <circle cx="48" cy="48" r="6" fill="#e8a035" opacity="0.2" />
      <polygon
        points="32,76 52,54 72,66 88,56 88,76"
        fill="#5b9bd5"
        opacity="0.12"
      />
      <text
        x="62"
        y="98"
        text-anchor="middle"
        font-size="8"
        font-weight="500"
        fill="var(--text-muted)"
      >
        scene.jpg
      </text>
      {/* Arrow */}
      <path
        d="M112,66 L134,66"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <polygon points="134,63 140,66 134,69" fill="var(--text-muted)" />
      {/* Tag list */}
      <rect
        x="148"
        y="28"
        width="56"
        height="22"
        rx="11"
        fill="var(--accent)"
        opacity="0.12"
        stroke="var(--accent)"
        stroke-width="1"
      />
      <text
        x="176"
        y="43"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="var(--accent)"
      >
        beach
      </text>
      <rect
        x="148"
        y="56"
        width="56"
        height="22"
        rx="11"
        fill="#e8a035"
        opacity="0.12"
        stroke="#e8a035"
        stroke-width="1"
      />
      <text
        x="176"
        y="71"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="#e8a035"
      >
        sunset
      </text>
      <rect
        x="148"
        y="84"
        width="56"
        height="22"
        rx="11"
        fill="#5b9bd5"
        opacity="0.12"
        stroke="#5b9bd5"
        stroke-width="1"
      />
      <text
        x="176"
        y="99"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="#5b9bd5"
      >
        ocean
      </text>
      {/* Checkmarks */}
      <path
        d="M152,39 l3,3 l6,-6"
        fill="none"
        stroke="var(--accent)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M152,67 l3,3 l6,-6"
        fill="none"
        stroke="#e8a035"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M152,95 l3,3 l6,-6"
        fill="none"
        stroke="#5b9bd5"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      {/* Confidence bars */}
      <text x="24" y="130" font-size="7" fill="var(--text-muted)">
        beach
      </text>
      <rect
        x="56"
        y="123"
        width="50"
        height="8"
        rx="2.5"
        fill="var(--accent)"
        opacity="0.4"
      />
      <text x="110" y="130" font-size="7" fill="var(--text-muted)">
        91%
      </text>
      <text x="24" y="144" font-size="7" fill="var(--text-muted)">
        sunset
      </text>
      <rect
        x="56"
        y="137"
        width="44"
        height="8"
        rx="2.5"
        fill="#e8a035"
        opacity="0.4"
      />
      <text x="104" y="144" font-size="7" fill="var(--text-muted)">
        87%
      </text>
      <text x="24" y="158" font-size="7" fill="var(--text-muted)">
        ocean
      </text>
      <rect
        x="56"
        y="151"
        width="38"
        height="8"
        rx="2.5"
        fill="#5b9bd5"
        opacity="0.4"
      />
      <text x="98" y="158" font-size="7" fill="var(--text-muted)">
        78%
      </text>
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Multiple labels per image
      </text>
    </svg>
  ),
  "Object Detection": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Image background */}
      <rect
        x="14"
        y="10"
        width="192"
        height="130"
        rx="10"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Ground */}
      <rect
        x="14"
        y="110"
        width="192"
        height="30"
        rx="0"
        fill="var(--text-muted)"
        opacity="0.04"
      />
      {/* Box A — tall rectangle */}
      <rect
        x="28"
        y="26"
        width="48"
        height="80"
        rx="3"
        fill="var(--accent)"
        opacity="0.07"
        stroke="var(--accent)"
        stroke-width="2"
      />
      <rect x="28" y="20" width="48" height="14" rx="4" fill="var(--accent)" />
      <text
        x="52"
        y="30"
        text-anchor="middle"
        font-size="8"
        font-weight="600"
        fill="white"
      >
        person 92%
      </text>
      {/* Small corner marks */}
      <line
        x1="28"
        y1="26"
        x2="36"
        y2="26"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="26"
        x2="28"
        y2="34"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="26"
        x2="68"
        y2="26"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="26"
        x2="76"
        y2="34"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="106"
        x2="36"
        y2="106"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="106"
        x2="28"
        y2="98"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="106"
        x2="68"
        y2="106"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="106"
        x2="76"
        y2="98"
        stroke="var(--accent)"
        stroke-width="2.5"
      />
      {/* Box B — wide rectangle */}
      <rect
        x="94"
        y="54"
        width="80"
        height="52"
        rx="3"
        fill="#e8a035"
        opacity="0.07"
        stroke="#e8a035"
        stroke-width="2"
      />
      <rect x="94" y="48" width="38" height="14" rx="4" fill="#e8a035" />
      <text
        x="113"
        y="58"
        text-anchor="middle"
        font-size="8"
        font-weight="600"
        fill="white"
      >
        car 88%
      </text>
      <line
        x1="94"
        y1="54"
        x2="102"
        y2="54"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="54"
        x2="94"
        y2="62"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="54"
        x2="166"
        y2="54"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="54"
        x2="174"
        y2="62"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="106"
        x2="102"
        y2="106"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="106"
        x2="94"
        y2="98"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="106"
        x2="166"
        y2="106"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="106"
        x2="174"
        y2="98"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      {/* Legend */}
      <rect
        x="30"
        y="150"
        width="10"
        height="10"
        rx="2"
        fill="var(--accent)"
        opacity="0.5"
      />
      <text x="44" y="159" font-size="8" fill="var(--text-muted)">
        person
      </text>
      <rect
        x="90"
        y="150"
        width="10"
        height="10"
        rx="2"
        fill="#e8a035"
        opacity="0.5"
      />
      <text x="104" y="159" font-size="8" fill="var(--text-muted)">
        car
      </text>
      <text
        x="110"
        y="176"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Bounding boxes with class + confidence
      </text>
    </svg>
  ),
  "Semantic Segmentation": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Left image — grayscale placeholder */}
      <rect
        x="8"
        y="16"
        width="88"
        height="88"
        rx="8"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="8"
        y="16"
        width="88"
        height="35"
        rx="8"
        fill="var(--text-muted)"
        opacity="0.06"
      />
      <rect
        x="8"
        y="68"
        width="88"
        height="36"
        fill="var(--text-muted)"
        opacity="0.04"
      />
      <rect
        x="36"
        y="36"
        width="32"
        height="42"
        fill="var(--text-muted)"
        opacity="0.08"
      />
      <text
        x="52"
        y="114"
        text-anchor="middle"
        font-size="7.5"
        font-weight="500"
        fill="var(--text-muted)"
      >
        Input
      </text>
      {/* Arrow */}
      <path
        d="M102,60 L116,60"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <polygon points="116,57 122,60 116,63" fill="var(--text-muted)" />
      {/* Right image — colored mask */}
      <rect
        x="128"
        y="16"
        width="88"
        height="88"
        rx="8"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Sky region */}
      <rect
        x="128"
        y="16"
        width="88"
        height="35"
        rx="8"
        fill="#5b9bd5"
        opacity="0.35"
      />
      {/* Building region */}
      <rect
        x="156"
        y="36"
        width="32"
        height="42"
        fill="#e8a035"
        opacity="0.35"
      />
      {/* Ground region */}
      <rect
        x="128"
        y="68"
        width="88"
        height="36"
        fill="#70ad47"
        opacity="0.35"
      />
      <text
        x="172"
        y="114"
        text-anchor="middle"
        font-size="7.5"
        font-weight="500"
        fill="var(--text-muted)"
      >
        Mask
      </text>
      {/* Color legend */}
      <rect
        x="24"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#5b9bd5"
        opacity="0.5"
      />
      <text
        x="40"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Sky
      </text>
      <rect
        x="74"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#e8a035"
        opacity="0.5"
      />
      <text
        x="90"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Building
      </text>
      <rect
        x="140"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#70ad47"
        opacity="0.5"
      />
      <text
        x="156"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Ground
      </text>
      {/* Pixel grid hint */}
      <line
        x1="128"
        y1="51"
        x2="216"
        y2="51"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="128"
        y1="68"
        x2="216"
        y2="68"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="156"
        y1="16"
        x2="156"
        y2="104"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="188"
        y1="16"
        x2="188"
        y2="104"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <text
        x="110"
        y="162"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Every pixel gets a class color
      </text>
    </svg>
  ),
  "Instance Segmentation": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Image background */}
      <rect
        x="14"
        y="10"
        width="192"
        height="120"
        rx="10"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Instance A — filled blob with border */}
      <rect
        x="24"
        y="28"
        width="52"
        height="78"
        rx="20"
        fill="var(--accent)"
        opacity="0.15"
        stroke="var(--accent)"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="24" y="18" width="52" height="16" rx="5" fill="var(--accent)" />
      <text
        x="50"
        y="29"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        person #1
      </text>
      {/* Instance B — filled blob with border */}
      <rect
        x="86"
        y="36"
        width="46"
        height="70"
        rx="18"
        fill="#c960cf"
        opacity="0.15"
        stroke="#c960cf"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="86" y="26" width="46" height="16" rx="5" fill="#c960cf" />
      <text
        x="109"
        y="37"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        person #2
      </text>
      {/* Instance C — wider blob */}
      <ellipse
        cx="170"
        cy="82"
        rx="30"
        ry="22"
        fill="#e8a035"
        opacity="0.15"
        stroke="#e8a035"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="148" y="52" width="44" height="16" rx="5" fill="#e8a035" />
      <text
        x="170"
        y="63"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        dog #1
      </text>
      {/* Legend */}
      <rect
        x="16"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="var(--accent)"
        opacity="0.4"
        stroke="var(--accent)"
        stroke-width="1"
      />
      <text
        x="32"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 1
      </text>
      <rect
        x="88"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="#c960cf"
        opacity="0.4"
        stroke="#c960cf"
        stroke-width="1"
      />
      <text
        x="104"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 2
      </text>
      <rect
        x="160"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="#e8a035"
        opacity="0.4"
        stroke="#e8a035"
        stroke-width="1"
      />
      <text
        x="176"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 3
      </text>
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Unique mask + ID per object instance
      </text>
    </svg>
  ),
};

function StepTaskType() {
  const d = wizardData.value;
  const isDetection = d.taskType === "Object Detection";
  const isSeg = d.taskType === "Semantic Segmentation";
  const selectedTask = TASK_TYPES.find((t) => t.id === d.taskType);

  return (
    <div>
      <p class="wizard-step-title">Task Type</p>
      <p class="wizard-step-desc">
        What kind of vision task will this project handle?
      </p>
      <div class="wizard-task-layout">
        <div class="wizard-category-list">
          {TASK_TYPES.map((t) => {
            const isDisabled =
              t.id === "Multi-Label Classification" ||
              t.id === "Semantic Segmentation" ||
              t.id === "Instance Segmentation";
            return (
              <button
                key={t.id}
                class={`wizard-category${d.taskType === t.id ? " selected" : ""}${isDisabled ? " disabled" : ""}`}
                onClick={
                  isDisabled
                    ? undefined
                    : () => {
                        wizardSetField("taskType", t.id);
                        wizardSetField("datasetFormat", "");
                        wizardSetField("lossFn", "");
                      }
                }
                disabled={isDisabled}
                style={isDisabled ? { opacity: 0.5, cursor: "not-allowed" } : {}}
              >
                <span class="wizard-category-name">{t.label}</span>
                <span class="wizard-category-desc">{t.desc}</span>
                {isDisabled && (
                  <span class="wizard-coming-soon-badge">Coming soon</span>
                )}
              </button>
            );
          })}
        </div>
        {selectedTask && (
          <div class="wizard-task-preview">
            {TASK_EXAMPLES[selectedTask.id]}
          </div>
        )}
      </div>
      {isDetection && (
        <div class="wizard-sub-section">
          <p class="wizard-sub-label">Detection Architecture</p>
          <div class="wizard-options-row">
            {DETECTION_ARCHS.map((a) => (
              <button
                key={a}
                class={`wizard-option wizard-option-sm${d.detectionArch === a ? " selected" : ""}`}
                onClick={() => wizardSetField("detectionArch", a)}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      {isSeg && (
        <div class="wizard-sub-section">
          <p class="wizard-sub-label">Segmentation Head</p>
          <div class="wizard-options-row">
            {SEG_HEAD_TYPES.map((h) => (
              <button
                key={h}
                class={`wizard-option wizard-option-sm${d.segHeadType === h ? " selected" : ""}`}
                onClick={() => wizardSetField("segHeadType", h)}
              >
                {h === "deeplabv3plus" ? "DeepLabV3+" : "FCN"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Model category preview data ──

// Benchmarks: timm v0.9, ImageNet-1K, 224×224, V100 batch=1
const MODEL_PREVIEWS = {
  Edge: {
    speed: 95,
    accuracy: 55,
    params: "1.97–6.11M",
    latency: "1.0–3.0 ms",
    gflops: "0.10–0.60 GMACs",
    target: "Mobile, IoT, Edge TPU",
    topAcc: "65.4–78.5%",
  },
  Balanced: {
    speed: 62,
    accuracy: 75,
    params: "5.3–12.2M",
    latency: "3.0–6.0 ms",
    gflops: "0.60–1.80 GMACs",
    target: "API servers, desktop apps",
    topAcc: "77.7–81.6%",
  },
  Cloud: {
    speed: 35,
    accuracy: 88,
    params: "86.7–196.5M",
    latency: "6.0–14.0 ms",
    gflops: "15.4–61.6 GMACs",
    target: "GPU servers, batch inference",
    topAcc: "83.7–86.3%",
  },
  Research: {
    speed: 15,
    accuracy: 96,
    params: "304.1–660.3M",
    latency: "12.0–35.0 ms",
    gflops: "61.6–525.0 GMACs",
    target: "A100 / H100 GPUs",
    topAcc: "88.6–90.0%",
  },
};

function getModelSource(d) {
  if (d.taskType === "Object Detection" && d.detectionArch === "yolox")
    return YOLOX_MODEL_CATEGORIES;
  if (d.taskType === "Object Detection") return DETECTION_MODEL_CATEGORIES;
  if (
    d.taskType === "Semantic Segmentation" ||
    d.taskType === "Instance Segmentation"
  )
    return SEGMENTATION_MODEL_CATEGORIES;
  return MODEL_CATEGORIES;
}

function ModelPreview({ category, modelSource }) {
  const info = (modelSource || MODEL_CATEGORIES)[category];
  const preview = MODEL_PREVIEWS[category];
  if (!info || !preview) return null;

  return (
    <div class="wizard-model-preview">
      <div class="wizard-structure-header">{category} Tier</div>
      {/* Speed vs Accuracy bars */}
      <div class="wizard-model-bars">
        <div class="wizard-model-bar-row">
          <span class="wizard-model-bar-label">Speed</span>
          <div class="wizard-model-bar-track">
            <div
              class="wizard-model-bar-fill wizard-model-bar-speed"
              style={{ width: `${preview.speed}%` }}
            />
          </div>
        </div>
        <div class="wizard-model-bar-row">
          <span class="wizard-model-bar-label">Accuracy</span>
          <div class="wizard-model-bar-track">
            <div
              class="wizard-model-bar-fill wizard-model-bar-acc"
              style={{ width: `${preview.accuracy}%` }}
            />
          </div>
        </div>
      </div>
      {/* Stats grid */}
      <div class="wizard-model-stats">
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.params}</span>
          <span class="wizard-model-stat-label">Parameters</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.latency}</span>
          <span class="wizard-model-stat-label">Latency</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.gflops}</span>
          <span class="wizard-model-stat-label">GMACs</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.topAcc}</span>
          <span class="wizard-model-stat-label">Top-1 ImageNet</span>
        </div>
        <div class="wizard-model-stat" style={{ gridColumn: "1 / -1" }}>
          <span class="wizard-model-stat-value">{preview.target}</span>
          <span class="wizard-model-stat-label">Deploy Target</span>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Model Category ──

function StepModelCategory() {
  const d = wizardData.value;
  const source = getModelSource(d);
  const categories = Object.keys(source);

  return (
    <div>
      <p class="wizard-step-title">Model Category</p>
      <p class="wizard-step-desc">
        Choose a model tier based on your deployment target.
      </p>
      <div class="wizard-model-layout">
        <div class="wizard-category-list">
          {categories.map((cat) => {
            const info = source[cat];
            return (
              <button
                key={cat}
                class={`wizard-category${d.modelCategory === cat ? " selected" : ""}`}
                onClick={() => wizardSetField("modelCategory", cat)}
              >
                <span class="wizard-category-name">{cat}</span>
                <span class="wizard-category-desc">{info.desc}</span>
              </button>
            );
          })}
        </div>
        {d.modelCategory && (
          <ModelPreview category={d.modelCategory} modelSource={source} />
        )}
      </div>
    </div>
  );
}

// ── Dataset structure previews (AutoTimm conventions) ──

const STRUCTURE_PREVIEWS = {
  // ── Classification ──
  "Classification::Folder": {
    label: "ImageFolder",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train/", indent: 1 },
      { name: "cat/", indent: 2 },
      { name: "img_001.jpg", indent: 3, file: true },
      { name: "img_002.jpg", indent: 3, file: true },
      { name: "dog/", indent: 2 },
      { name: "img_003.jpg", indent: 3, file: true },
      { name: "val/", indent: 1 },
      { name: "cat/", indent: 2 },
      { name: "dog/", indent: 2 },
    ],
    note: "Subdirectory names are used as class labels.",
  },
  "Classification::CSV": {
    label: "CSV",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, label",
    sample: "images/img_001.jpg,cat\nimages/img_002.jpg,dog",
  },
  "Classification::JSONL": {
    label: "JSONL",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "One JSON object per line.",
    sample:
      '{"image": "images/img_001.jpg", "label": "cat"}\n{"image": "images/img_002.jpg", "label": "dog"}',
  },
  // ── Multi-Label Classification ──
  "Multi-Label Classification::CSV": {
    label: "CSV (Multi-Label)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, cat, dog (one 0/1 column per label)",
    sample:
      "image_path,cat,dog\nimages/img_001.jpg,1,0\nimages/img_002.jpg,0,1",
  },
  "Multi-Label Classification::JSONL": {
    label: "JSONL (Multi-Label)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "Labels as a JSON array.",
    sample:
      '{"image": "images/img_001.jpg", "labels": ["beach", "sunset"]}\n{"image": "images/img_002.jpg", "labels": ["mountain"]}',
  },
  // ── Object Detection ──
  "Object Detection::COCO JSON": {
    label: "COCO JSON",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "instances_train.json", indent: 2, file: true },
      { name: "instances_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "Standard COCO format with images, annotations, and categories.",
  },
  "Object Detection::CSV": {
    label: "CSV (Detection)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, x_min, y_min, x_max, y_max, label",
    sample:
      "images/img_001.jpg,10,20,150,200,cat\nimages/img_001.jpg,180,30,300,180,dog",
  },
  "Object Detection::JSONL": {
    label: "JSONL (Detection)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "Each line: image + list of bounding boxes.",
    sample:
      '{"image": "images/img_001.jpg", "boxes": [\n  {"bbox": [10,20,150,200], "label": "cat"}\n]}',
  },
  // ── Semantic Segmentation ──
  "Semantic Segmentation::PNG Masks": {
    label: "PNG Masks",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "images/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "img_001.jpg", indent: 3, file: true },
      { name: "val/", indent: 2 },
      { name: "img_002.jpg", indent: 3, file: true },
      { name: "masks/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "img_001.png", indent: 3, file: true },
      { name: "val/", indent: 2 },
      { name: "img_002.png", indent: 3, file: true },
    ],
    note: "Mask pixel values correspond to class indices (0, 1, 2, …).",
  },
  "Semantic Segmentation::COCO": {
    label: "COCO Segmentation",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "panoptic_train.json", indent: 2, file: true },
      { name: "panoptic_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "COCO panoptic format with segmentation polygons.",
  },
  "Semantic Segmentation::Cityscapes": {
    label: "Cityscapes",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "leftImg8bit/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "aachen/", indent: 3 },
      { name: "aachen_000000_leftImg8bit.png", indent: 4, file: true },
      { name: "gtFine/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "aachen/", indent: 3 },
      { name: "aachen_000000_gtFine_labelIds.png", indent: 4, file: true },
    ],
    note: "Standard Cityscapes directory layout with city subfolders.",
  },
  "Semantic Segmentation::VOC": {
    label: "Pascal VOC",
    tree: [
      { name: "VOCdevkit/", indent: 0 },
      { name: "VOC2012/", indent: 1 },
      { name: "JPEGImages/", indent: 2 },
      { name: "2007_000001.jpg", indent: 3, file: true },
      { name: "SegmentationClass/", indent: 2 },
      { name: "2007_000001.png", indent: 3, file: true },
      { name: "ImageSets/", indent: 2 },
      { name: "Segmentation/", indent: 3 },
      { name: "train.txt", indent: 4, file: true },
      { name: "val.txt", indent: 4, file: true },
    ],
    note: "VOC segmentation masks with ImageSets split files.",
  },
  "Semantic Segmentation::CSV": {
    label: "CSV (Segmentation)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
      { name: "masks/", indent: 1 },
      { name: "img_001.png", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, mask_path",
    sample:
      "images/img_001.jpg,masks/img_001.png\nimages/img_002.jpg,masks/img_002.png",
  },
  "Semantic Segmentation::JSONL": {
    label: "JSONL (Segmentation)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "Each line maps image to mask path.",
    sample: '{"image": "images/img_001.jpg", "mask": "masks/img_001.png"}',
  },
  // ── Instance Segmentation ──
  "Instance Segmentation::COCO JSON": {
    label: "COCO Instance",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "instances_train.json", indent: 2, file: true },
      { name: "instances_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "COCO format with per-instance segmentation polygons and bboxes.",
  },
  "Instance Segmentation::CSV": {
    label: "CSV (Instance)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "CSV columns: image_path, mask_path, label, instance_id",
    sample:
      "images/img_001.jpg,masks/img_001_0.png,person,0\nimages/img_001.jpg,masks/img_001_1.png,car,1",
  },
  "Instance Segmentation::JSONL": {
    label: "JSONL (Instance)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "Each line: image + list of instance annotations.",
    sample:
      '{"image": "images/img_001.jpg", "instances": [\n  {"mask": "masks/001_0.png", "label": "person"}\n]}',
  },
};

const TreeIconFolder = () => (
  <svg
    class="wizard-tree-icon wizard-tree-icon-dir"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const TreeIconFile = () => (
  <svg
    class="wizard-tree-icon wizard-tree-icon-file"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function StructurePreview({ taskType, format }) {
  const key = `${taskType}::${format}`;
  const info = STRUCTURE_PREVIEWS[key];
  if (!info) return null;

  return (
    <div class="wizard-structure-preview">
      <div class="wizard-structure-header">Directory Structure</div>
      <div class="wizard-structure-tree">
        {info.tree.map((item, i) => (
          <div
            key={i}
            class="wizard-tree-line"
            style={{ paddingLeft: `${item.indent * 16}px` }}
          >
            <span class={item.file ? "wizard-tree-file" : "wizard-tree-dir"}>
              {item.file ? <TreeIconFile /> : <TreeIconFolder />}
              {item.name}
            </span>
          </div>
        ))}
      </div>
      {info.sample && (
        <div class="wizard-structure-sample">
          <div class="wizard-structure-sample-label">Example</div>
          <pre class="wizard-structure-code">{info.sample}</pre>
        </div>
      )}
      <div class="wizard-structure-note">{info.note}</div>
    </div>
  );
}

// ── Step 4: Dataset Format ──

function StepDataset() {
  const d = wizardData.value;
  const formats = DATASET_FORMATS[d.taskType] || [];
  const isCsvOrJsonl = d.datasetFormat === "CSV" || d.datasetFormat === "JSONL";
  const needsFolderPath = d.datasetFormat && !isCsvOrJsonl; // All formats except CSV/JSONL need folder path
  const fileExtension =
    d.datasetFormat === "CSV"
      ? "csv"
      : d.datasetFormat === "JSONL"
        ? "jsonl"
        : null;

  const handleFolderPathInput = (e) => {
    const value = e.target.value;
    wizardSetField("folderPath", value);
  };

  // Auto-detect class names when folder path or train path changes
  useEffect(() => {
    const path = d.datasetFormat === "Folder" ? d.folderPath : d.trainPath;
    if (!path || !path.trim()) {
      wizardSetField("classNames", []);
      return;
    }
    const format = d.datasetFormat || "Folder";
    const sshCmd = d.connectionType === "remote" ? d.sshCommand : null;
    let cancelled = false;
    invoke("browse_dataset", {
      path: path.trim(),
      format,
      sshCommand: sshCmd,
      offset: 0,
      limit: 0,
      classFilter: null,
      imageFolder: d.imageFolderPath || null,
      imageColumn: d.imageColumn?.trim() || null,
      labelColumn: d.labelColumn?.trim() || null,
      labelColumns: d.taskType === "Multi-Label Classification" ? (d.labelColumns || "").split(",").map((v) => v.trim()).filter(Boolean) : null,
      search: null,
      split: null,
    }).then((result) => {
      if (!cancelled && result?.class_counts) {
        const names = Object.keys(result.class_counts).sort();
        wizardSetField("classNames", names);
        if (names.length >= 2 && !d.numClasses) {
          wizardSetField("numClasses", names.length);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [d.folderPath, d.trainPath, d.datasetFormat, d.imageFolderPath, d.imageColumn, d.labelColumn, d.labelColumns]);

  const handleTrainPathInput = (e) => {
    wizardSetField("trainPath", e.target.value);
  };

  const handleValPathInput = (e) => {
    wizardSetField("valPath", e.target.value);
  };

  const handleTestPathInput = (e) => {
    wizardSetField("testPath", e.target.value);
  };

  return (
    <div>
      <p class="wizard-step-title">Dataset Format</p>
      <p class="wizard-step-desc">How is your training data organized?</p>
      <div class="wizard-dataset-layout">
        <div class="wizard-category-list">
          {formats.map((f) => (
            <button
              key={f.id}
              class={`wizard-category${d.datasetFormat === f.id ? " selected" : ""}`}
              onClick={() => {
                wizardSetField("datasetFormat", f.id);
                // Clear validation errors when changing format
                trainPathError.value = "";
                valPathError.value = "";
                testPathError.value = "";
              }}
            >
              <span class="wizard-category-name">{f.label}</span>
              <span class="wizard-category-desc">{f.desc}</span>
            </button>
          ))}
        </div>
        {d.datasetFormat && (
          <StructurePreview taskType={d.taskType} format={d.datasetFormat} />
        )}
      </div>
      {needsFolderPath && (
        <div class="wizard-folder-path-section">
          <p class="wizard-sub-label">
            Dataset Folder Path <span class="wizard-required-indicator">*</span>
          </p>
          <input
            class="wizard-input wizard-input-mono"
            type="text"
            placeholder={platform.value === "windows" ? "C:\\path\\to\\dataset" : "/path/to/dataset"}
            value={d.folderPath}
            onInput={handleFolderPathInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
            }}
          />
        </div>
      )}
      <div class="wizard-folder-path-section">
        <p class="wizard-sub-label">
          Number of Classes <span class="wizard-required-indicator">*</span>
        </p>
        <input
          class="wizard-input"
          type="number"
          min="2"
          placeholder="e.g. 10"
          value={d.numClasses}
          onInput={(e) =>
            wizardSetField(
              "numClasses",
              e.target.value === "" ? "" : Number(e.target.value),
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
          }}
        />
      </div>
      {isCsvOrJsonl && (
        <div class="wizard-folder-path-section">
          <p class="wizard-sub-label">
            Image Folder <span class="wizard-optional-indicator">(optional)</span>
          </p>
          <input
            class="wizard-input wizard-input-mono"
            type="text"
            placeholder={platform.value === "windows" ? "C:\\path\\to\\images" : "/path/to/images"}
            value={d.imageFolderPath}
            onInput={(e) => wizardSetField("imageFolderPath", e.target.value)}
          />
        </div>
      )}
      <CsvColumnFields value={d} onChange={wizardSetField} />
      {isCsvOrJsonl && (
        <div class="wizard-file-paths-section">
          <p class="wizard-sub-label">Dataset File Paths</p>
          <div class="wizard-file-path-group">
            <label class="wizard-file-path-label">
              Train <span class="wizard-required-indicator">*</span>
            </label>
            <input
              class="wizard-input wizard-input-mono"
              type="text"
              placeholder={platform.value === "windows" ? `C:\\path\\to\\train.${fileExtension}` : `/path/to/train.${fileExtension}`}
              value={d.trainPath}
              onInput={handleTrainPathInput}
            />
          </div>
          <div class="wizard-file-path-group">
            <label class="wizard-file-path-label">
              Val <span class="wizard-optional-indicator">(optional)</span>
            </label>
            <input
              class="wizard-input wizard-input-mono"
              type="text"
              placeholder={platform.value === "windows" ? `C:\\path\\to\\val.${fileExtension}` : `/path/to/val.${fileExtension}`}
              value={d.valPath}
              onInput={handleValPathInput}
            />
          </div>
          <div class="wizard-file-path-group">
            <label class="wizard-file-path-label">
              Test <span class="wizard-required-indicator">*</span>
            </label>
            <input
              class="wizard-input wizard-input-mono"
              type="text"
              placeholder={platform.value === "windows" ? `C:\\path\\to\\test.${fileExtension}` : `/path/to/test.${fileExtension}`}
              value={d.testPath}
              onInput={handleTestPathInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 5: Confirm ──

function StepConfirm() {
  const d = wizardData.value;
  const isCsvOrJsonl = d.datasetFormat === "CSV" || d.datasetFormat === "JSONL";

  const rows = [
    ["SSH Command", d.sshCommand],
    ["Project Name", d.name],
    d.projectPath ? ["Project Path", d.projectPath] : null,
    ["Task Type", d.taskType],
    d.taskType === "Object Detection"
      ? ["Detection Arch", d.detectionArch.toUpperCase()]
      : null,
    d.taskType === "Semantic Segmentation"
      ? ["Seg Head", d.segHeadType === "deeplabv3plus" ? "DeepLabV3+" : "FCN"]
      : null,
    ["Model Category", d.modelCategory],
    ["Dataset Format", d.datasetFormat],
    d.numClasses ? ["Number of Classes", d.numClasses] : null,
    d.datasetFormat === "Folder" && d.folderPath
      ? ["Folder Path", d.folderPath]
      : null,
    isCsvOrJsonl && d.imageFolderPath ? ["Image Folder", d.imageFolderPath] : null,
    d.datasetFormat === "CSV" && d.imageColumn ? ["Image path column", d.imageColumn] : null,
    d.datasetFormat === "CSV" && (d.labelColumns || d.labelColumn) ? ["Label column(s)", d.taskType === "Multi-Label Classification" ? d.labelColumns : d.labelColumn] : null,
    isCsvOrJsonl && d.trainPath ? ["Train Path", d.trainPath] : null,
    isCsvOrJsonl && d.valPath ? ["Val Path", d.valPath] : null,
    isCsvOrJsonl && d.testPath ? ["Test Path", d.testPath] : null,
  ].filter(Boolean);

  return (
    <div>
      <p class="wizard-step-title">Confirm Project</p>
      <p class="wizard-step-desc">
        Review your settings before creating the project.
      </p>
      <div class="wizard-confirm-table">
        {rows.map(([label, value]) => (
          <div key={label} class="wizard-confirm-row">
            <span class="wizard-confirm-label">{label}</span>
            <span class="wizard-confirm-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Steps array ──

const steps = [
  StepSSH,
  StepName,
  StepTaskType,
  StepModelCategory,
  StepDataset,
  StepConfirm,
];

// ── Wizard Shell ──

export function CreateProjectWizard() {
  if (!wizardOpen.value) return null;

  const step = wizardStep.value;
  const isLast = step === STEP_COUNT - 1;
  const StepComponent = steps[step];

  useEffect(() => {
    maybeStartWizardTutorial();
  }, []);

  return (
    <div class="wizard-overlay">
      <div class="wizard-card wizard-card-wide">
        <div class="wizard-header">
          <h2>New Project</h2>
          <span class="wizard-step-counter">
            {step + 1} / {STEP_COUNT}
          </span>
          <button class="wizard-close-btn" onClick={closeWizard}>
            &times;
          </button>
        </div>
        <div class="wizard-dots">
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <div
              key={i}
              class={`wizard-dot${i <= step ? " active" : ""}`}
              title={STEP_LABELS[i]}
            />
          ))}
        </div>
        <WizardTip stepIndex={step} />
        <div class="wizard-body">
          <StepComponent />
        </div>
        <div class="wizard-footer">
          <button
            class="wizard-btn wizard-btn-secondary"
            onClick={step === 0 ? closeWizard : wizardBack}
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <button
            class="wizard-btn wizard-btn-primary"
            disabled={!wizardCanProceed.value}
            onClick={isLast ? wizardCreate : wizardNext}
          >
            {isLast ? "Create" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
