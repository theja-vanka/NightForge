import { useState, useCallback } from "preact/hooks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { currentPage, navigate } from "../state/router.js";
import {
  projectList,
  currentProjectId,
  selectProject,
  openWizard,
  openDeleteDialog,
} from "../state/projects.js";
import { isPageAvailable } from "../state/dashboard.js";
import { aboutOpen } from "../app.jsx";

const navItems = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  },
  {
    id: "experiments",
    label: "Experiments",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>`,
  },
  {
    id: "dataset-browser",
    label: "Dataset",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  },
  {
    id: "interpretation",
    label: "Interpretation",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  },
  {
    id: "netron",
    label: "Model Viewer",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>`,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  },
  {
    id: "settings",
    label: "Settings",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  },
];

const chevronIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

export function Sidebar() {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [tooltip, setTooltip] = useState(null);

  const showTooltip = useCallback((e, name) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ name, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  // Only show nav items that are unlocked. The same predicate gates the global
  // keyboard shortcuts, so a shortcut can never reach a hidden view.
  const visibleNavItems = navItems.filter((item) => isPageAvailable(item.id));

  return (
    <nav class="sidebar">
      <button
        class="sidebar-logo"
        onClick={() => (aboutOpen.value = true)}
        title="About NightFlow"
      >
        <img src="/assets/image.png" alt="NightFlow" width="28" height="28" />
      </button>
      <div class="sidebar-nav">
        {visibleNavItems.map((item) => (
          <button
            key={item.id}
            class={`sidebar-btn${
              currentPage.value === item.id ||
              (item.id === "experiments" && currentPage.value === "run-detail")
                ? " active"
                : ""
            }`}
            onClick={() => navigate(item.id)}
            title={item.label}
          >
            <span dangerouslySetInnerHTML={{ __html: item.icon }} />
          </button>
        ))}
      </div>
      <div class="sidebar-projects">
        <button
          class="sidebar-projects-toggle"
          onClick={() => setProjectsOpen(!projectsOpen)}
          title={projectsOpen ? "Collapse projects" : "Expand projects"}
        >
          <span class="sidebar-projects-label">Projects</span>
          <span
            class={`sidebar-projects-chevron${projectsOpen ? "" : " collapsed"}`}
            dangerouslySetInnerHTML={{ __html: chevronIcon }}
          />
        </button>
        <div
          class={`sidebar-projects-collapsible${projectsOpen ? " open" : ""}`}
        >
          <div class="sidebar-projects-list">
            {projectList.value.map((p) => (
              <div key={p.id} class="sidebar-project-wrap">
                <button
                  class={`sidebar-project-btn${currentProjectId.value === p.id ? " active" : ""}`}
                  onClick={() => selectProject(p.id)}
                  onMouseEnter={(e) => showTooltip(e, p.name)}
                  onMouseLeave={hideTooltip}
                >
                  {p.name[0].toUpperCase()}
                </button>
                <button
                  class="sidebar-project-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDeleteDialog(p.id);
                  }}
                  title="Delete project"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          class="sidebar-add-btn"
          onClick={openWizard}
          title="New Project"
        >
          +
        </button>
      </div>
      <button
        class="sidebar-bmc"
        onClick={() => openUrl("https://www.buymeacoffee.com/theja.vanka")}
        title="Buy Me a Coffee"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
          <line x1="6" y1="2" x2="6" y2="4" />
          <line x1="10" y1="2" x2="10" y2="4" />
          <line x1="14" y1="2" x2="14" y2="4" />
        </svg>
      </button>
      {tooltip && (
        <div
          class="sidebar-project-tooltip"
          style={{ top: `${tooltip.top}px`, left: `${tooltip.left}px` }}
        >
          {tooltip.name}
        </div>
      )}
    </nav>
  );
}
