import { signal } from "@preact/signals";
import { sshConnected, dashboardSynced } from "./dashboard.js";
import { navigate } from "./router.js";

const STORAGE_KEY = "nightflow-tutorial-done";
const WIZARD_TUTORIAL_KEY = "nightflow-wizard-tutorial-done";

export const tutorialActive = signal(false);
export const tutorialStep = signal(0);

export const tutorialSteps = [
  {
    target: ".sidebar-logo",
    title: "Welcome to NightFlow",
    body: "Your desktop hub for managing and analyzing deep learning experiments. Let's take a quick tour of the interface.",
    position: "right",
    view: "dashboard",
  },
  {
    target: ".sidebar-nav",
    title: "Navigation",
    body: "Use these icons to switch between views — Dashboard, Experiments, Dataset Browser, Interpretation, Model Viewer, Terminal, and Settings. Use Ctrl+1–7 to jump between them, or Ctrl+K to see all shortcuts.",
    position: "right",
    view: "dashboard",
  },
  {
    target: ".sidebar-projects",
    title: "Projects",
    body: "All your projects live here. Click a project to switch to it, or use the \"+\" button to create a new one. You can export and import project configs from Settings.",
    position: "right",
    view: "dashboard",
  },
  {
    target: ".header",
    title: "Header & Theme",
    body: "Shows the current page title and project name. Use the theme toggle to switch between dark and light mode — charts automatically adapt their color palette.",
    position: "bottom",
    view: "dashboard",
  },
  {
    target: ".app-content",
    title: "Main Content",
    body: "This is the main content area where each view renders. Let's connect to your machine next!",
    position: "left",
    view: "dashboard",
  },
  {
    target: ".ssh-status-banner",
    title: "Connect",
    body: "Click the Connect button to establish a connection to your remote machine (or localhost). You can manage your SSH keys in Settings. The tutorial will continue once connected.",
    position: "bottom",
    view: "dashboard",
    waitFor: () => sshConnected.value,
  },
  {
    target: ".dashboard-sync-card",
    title: "Sync",
    body: "Now hit Sync to pull your project environment and experiment data. This sets up your Python environment and discovers any existing runs.",
    position: "bottom",
    view: "dashboard",
    waitFor: () => dashboardSynced.value,
  },
  {
    target: ".summary-grid",
    title: "Summary Cards",
    body: "After syncing, these cards show an overview of your runs — total count, running, and your best validation and test accuracy.",
    position: "top",
    view: "dashboard",
  },
  {
    target: ".start-training-section",
    title: "Launch Training",
    body: "Configure your model, dataset, and hyperparameters, then start training with one click. You can also queue multiple runs to execute sequentially. An ETA will show after the first epoch, and you'll get an OS notification when training finishes.",
    position: "top",
    view: "dashboard",
  },
  {
    target: ".app-content",
    title: "Experiments & Run Details",
    body: "The Experiments view lists all your runs with filtering and sorting. Click a run to see its charts, hyperparameters, confusion matrix, and per-class metrics. You can tag runs, add notes, and export data as CSV or JSON.",
    position: "left",
    view: "experiments",
  },
  {
    target: ".app-content",
    title: "Dataset Browser",
    body: "Browse your training dataset with a visual thumbnail grid. See class distribution at a glance, click a class bar to filter, and paginate through images.",
    position: "left",
    view: "dataset-browser",
  },
  {
    target: ".app-content",
    title: "Interpretation & Augmentation",
    body: "Use the Interpretation view to run GradCAM and other visualizations on your trained models. In Settings, you can preview what augmentation presets do to your images before training.",
    position: "left",
    view: "interpretation",
  },
  {
    target: ".sidebar-nav",
    title: "You're All Set!",
    body: "Explore all the views now that you're connected and synced. Check Settings for GPU selection, SSH key management, and project config export/import. Happy experimenting!",
    position: "right",
    view: "dashboard",
  },
];

function _navigateToStep(idx) {
  const step = tutorialSteps[idx];
  if (step?.view) {
    navigate(step.view);
  }
}

export function startTutorial() {
  localStorage.removeItem(STORAGE_KEY);
  tutorialStep.value = 0;
  _navigateToStep(0);
  tutorialActive.value = true;
}

export function nextStep() {
  const next = tutorialStep.value + 1;
  if (next >= tutorialSteps.length) {
    completeTutorial();
  } else {
    _navigateToStep(next);
    tutorialStep.value = next;
  }
}

export function prevStep() {
  if (tutorialStep.value > 0) {
    const prev = tutorialStep.value - 1;
    _navigateToStep(prev);
    tutorialStep.value = prev;
  }
}

export function skipTutorial() {
  completeTutorial();
}

function completeTutorial() {
  tutorialActive.value = false;
  tutorialStep.value = 0;
  localStorage.setItem(STORAGE_KEY, "true");
  navigate("dashboard");
}

// ── Wizard Tutorial ──

export const wizardTutorialActive = signal(false);
export const wizardTutorialDismissed = signal(false);

export const wizardStepTips = [
  {
    title: "Step 1: Connection",
    body: "Choose where your training will run. Select Localhost for this machine, or Remote Instance to connect to a GPU server via SSH. You can test the connection before proceeding.",
  },
  {
    title: "Step 2: Project Name",
    body: "Give your project a memorable name. A project folder will be auto-created under ~/nightflow/projects/ — you can customize the path if needed.",
  },
  {
    title: "Step 3: Task Type",
    body: "Select your computer vision task: Classification for labeling images, Detection for bounding boxes, or Segmentation for pixel-level masks. This determines which models and dataset formats are available.",
  },
  {
    title: "Step 4: Model Backbone",
    body: "Pick a model size tier. Nano/Tiny models train fast and are great for prototyping. Larger tiers (Small, Base, Large) offer higher accuracy but need more GPU memory and time.",
  },
  {
    title: "Step 5: Dataset",
    body: "Tell NightFlow where your data lives and how it's organized. Choose a format (Folder, COCO, CSV, etc.), point to the dataset path, and specify the number of classes.",
  },
  {
    title: "Step 6: Advanced Settings",
    body: "Optional. Turn on Power User Mode to fine-tune training hyperparameters like epochs, learning rate, batch size, and early stopping. Skip this step to use recommended defaults.",
  },
  {
    title: "Step 7: Confirm",
    body: "Review your project configuration. If everything looks good, click Create to set up the project. You can always change settings later from the Dashboard.",
  },
];

export function maybeStartWizardTutorial() {
  if (localStorage.getItem(WIZARD_TUTORIAL_KEY)) {
    wizardTutorialDismissed.value = true;
    return;
  }
  wizardTutorialActive.value = true;
  wizardTutorialDismissed.value = false;
}

export function dismissWizardTutorial() {
  wizardTutorialActive.value = false;
  wizardTutorialDismissed.value = true;
  localStorage.setItem(WIZARD_TUTORIAL_KEY, "true");
}

export function maybeStartTutorial() {
  if (localStorage.getItem(STORAGE_KEY)) return;

  // Wait for the sidebar to exist in the DOM before starting
  const check = () => {
    if (document.querySelector(".sidebar")) {
      startTutorial();
    } else {
      requestAnimationFrame(check);
    }
  };
  // Small delay so the app shell has time to render
  setTimeout(check, 500);
}
