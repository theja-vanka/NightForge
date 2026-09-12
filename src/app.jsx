import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { currentPage, navigate } from "./state/router.js";
import { isPageAvailable } from "./state/dashboard.js";
import { projectList, loadProjects } from "./state/projects.js";
import { loadRuns } from "./state/experiments.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { Header } from "./components/Header.jsx";
import { DashboardView } from "./views/DashboardView.jsx";
import { ExperimentsView } from "./views/ExperimentsView.jsx";
import { SettingsView } from "./views/SettingsView.jsx";
import { NetronView } from "./views/NetronView.jsx";
import { InterpretationView } from "./views/InterpretationView.jsx";
import { TerminalView } from "./views/TerminalView.jsx";
import { RunDetailView } from "./views/RunDetailView.jsx";
import { CompareRunsView } from "./views/CompareRunsView.jsx";
import { DatasetBrowserView } from "./views/DatasetBrowserView.jsx";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal.jsx";
import { AboutModal } from "./components/AboutModal.jsx";

// Ensure state modules initialize
import "./state/theme.js";
import "./state/projects.js";
import {
  initTrainingListeners,
  cleanupTrainingListeners,
} from "./state/training.js";
import { startUpdateChecker, stopUpdateChecker } from "./state/update.js";
import { CreateProjectWizard } from "./components/CreateProjectWizard.jsx";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog.jsx";
import { EmptyProjectsScreen } from "./components/EmptyProjectsScreen.jsx";
import { TutorialOverlay } from "./components/TutorialOverlay.jsx";
import { maybeStartTutorial } from "./state/tutorial.js";

const shortcutsOpen = signal(false);
export const aboutOpen = signal(false);

function CurrentView() {
  switch (currentPage.value) {
    case "dashboard":
      return <DashboardView />;
    case "experiments":
      return <ExperimentsView />;
    case "interpretation":
      return <InterpretationView />;
    case "netron":
      return <NetronView />;
    case "terminal":
      return <TerminalView />;
    case "settings":
      return <SettingsView />;
    case "run-detail":
      return <RunDetailView />;
    case "compare-runs":
      return <CompareRunsView />;
    case "dataset-browser":
      return <DatasetBrowserView />;
    default:
      return <DashboardView />;
  }
}

export function App() {
  useEffect(() => {
    // Load data from database
    loadProjects().then(() => loadRuns());

    // Start listening for training events
    initTrainingListeners();

    // Check for updates
    startUpdateChecker();

    // Start tutorial for first-time users
    maybeStartTutorial();

    // Close splash screen after delay
    const timer = setTimeout(() => {
      invoke("close_splash");
    }, 2000);

    // Keyboard shortcuts
    const NAV_MAP = {
      "1": "dashboard",
      "2": "experiments",
      "3": "dataset-browser",
      "4": "interpretation",
      "5": "netron",
      "6": "terminal",
      "7": "settings",
    };

    function handleKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const tag = e.target.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "k" || e.key === "K") {
        // Ctrl+K is readline's kill-line, and the terminal keeps a hidden
        // textarea focused — leave that binding to the shell. Cmd+K is free.
        if (editable && !e.metaKey) return;
        e.preventDefault();
        shortcutsOpen.value = !shortcutsOpen.value;
        return;
      }

      if (NAV_MAP[e.key]) {
        // Deliberately not gated on `editable`: a modifier plus a digit never
        // types anything, and the terminal's hidden textarea would otherwise
        // swallow these and trap the user in the terminal view.
        // Respect the same availability rule the sidebar uses, so a shortcut
        // can't land on a view that isn't reachable yet.
        if (!isPageAvailable(NAV_MAP[e.key])) return;
        e.preventDefault();
        navigate(NAV_MAP[e.key]);
        return;
      }
    }

    // Capture phase: xterm.js consumes some of these (Ctrl+7 is the control
    // character 0x1F) and calls stopPropagation on its hidden textarea, which
    // would otherwise stop a bubbling listener from ever seeing them.
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      cleanupTrainingListeners();
      stopUpdateChecker();
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  const hasProjects = projectList.value.length > 0;

  return (
    <>
      {!hasProjects ? (
        <EmptyProjectsScreen />
      ) : (
        <div class="app-shell">
          <Sidebar />
          <div class="app-main">
            <Header />
            <div class="app-content">
              <CurrentView />
            </div>
          </div>
        </div>
      )}
      <CreateProjectWizard />
      <DeleteProjectDialog />
      <TutorialOverlay />
      <KeyboardShortcutsModal
        open={shortcutsOpen.value}
        onClose={() => (shortcutsOpen.value = false)}
      />
      <AboutModal
        open={aboutOpen.value}
        onClose={() => (aboutOpen.value = false)}
      />
    </>
  );
}
