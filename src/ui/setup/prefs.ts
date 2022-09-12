import {
  prefs as debuggerPrefs,
  asyncStore as debuggerAsyncPrefs,
} from "devtools/client/debugger/src/utils/prefs";
import { RecordingId } from "@replayio/protocol";
import debounce from "lodash/debounce";
import { UIStore } from "ui/actions";
import { UIState } from "ui/state";
import { prefs, asyncStore } from "ui/utils/prefs";
import { getRecordingId } from "ui/utils/recording";
import {
  getConsoleFilterDrawerExpanded,
  getSelectedPanel,
  getSelectedPrimaryPanel,
  getToolboxLayout,
  getShowVideoPanel,
  getViewMode,
  getLocalNags,
} from "ui/reducers/layout";
import { ToolboxLayout, ViewMode } from "ui/state/layout";
import { persistTabs } from "devtools/client/debugger/src/utils/tabs";
import { getTabs } from "devtools/client/debugger/src/reducers/tabs";
import { getTheme } from "ui/reducers/app";
import { getRecording } from "ui/hooks/recordings";
import { getPendingBreakpoints } from "devtools/client/debugger/src/selectors";

export interface ReplaySessions {
  [id: string]: ReplaySession;
}
export interface ReplaySession {
  viewMode: ViewMode;
  showVideoPanel: boolean;
  toolboxLayout: ToolboxLayout;
  localNags: string[];
}

export function registerStoreObserver(
  store: UIStore,
  subscriber: (state: UIState, oldState: UIState) => void
) {
  let oldState = store.getState();
  store.subscribe(() => {
    const state = store.getState();
    subscriber(state, oldState);
    oldState = state;
  });
}

function createPrefsUpdater<T extends Record<string, any>>(prefObj: T) {
  return function updatePref(
    newState: UIState,
    oldState: UIState,
    field: keyof typeof prefObj,
    selector: (state: UIState) => T[typeof field]
  ) {
    const newValue = selector(newState);
    const oldValue = selector(oldState);
    if (newValue != oldValue) {
      prefObj[field] = newValue;
    }
  };
}

const updateStandardPrefs = createPrefsUpdater(prefs);
const updateAsyncPrefs = createPrefsUpdater(asyncStore);
const updateDebuggerPrefs = createPrefsUpdater(debuggerPrefs);
const updateDebuggerAsyncPrefs = createPrefsUpdater(debuggerAsyncPrefs);

export const updatePrefs = (state: UIState, oldState: UIState) => {
  updateStandardPrefs(state, oldState, "theme", getTheme);
  updateStandardPrefs(
    state,
    oldState,
    "consoleFilterDrawerExpanded",
    getConsoleFilterDrawerExpanded
  );

  updateAsyncPrefs(
    state,
    oldState,
    "eventListenerBreakpoints",
    state => state.eventListenerBreakpoints
  );

  if (state.ui && oldState.ui) {
    updateDebuggerPrefs(
      state,
      oldState,
      "frameworkGroupingOn",
      state => state.ui.frameworkGroupingOn
    );

    updateDebuggerPrefs(
      state,
      oldState,
      "startPanelCollapsed",
      state => state.ui.startPanelCollapsed
    );

    updateDebuggerPrefs(state, oldState, "sourcesCollapsed", state => state.ui.sourcesCollapsed);

    updateDebuggerPrefs(
      state,
      oldState,
      "pendingSelectedLocation",
      // TS types say `null` isn't acceptable to persist, but it seems to work at runtime
      state => state.sources.persistedSelectedLocation as any
    );
  }

  if (state.pendingBreakpoints && oldState.pendingBreakpoints) {
    // @ts-ignore `asyncStoreHelper` is untyped, so TS doesn't know keys here
    updateDebuggerAsyncPrefs(state, oldState, "pendingBreakpoints", getPendingBreakpoints);
  }
  maybeUpdateReplaySessions(state);
};

let replaySessions: ReplaySessions;
async function getReplaySessions() {
  if (replaySessions) {
    return replaySessions;
  }
  replaySessions = await asyncStore.replaySessions;
  return replaySessions;
}

export async function getReplaySession(recordingId: RecordingId) {
  return (await asyncStore.replaySessions)[recordingId];
}

export const getLocalReplaySessionPrefs = async () => {
  const recordingId = getRecordingId();

  // If we're in the library, there are no preferences to fetch.
  if (!recordingId) {
    return null;
  }

  let recording;
  try {
    recording = await getRecording(recordingId);
  } catch (e) {
    return null;
  }

  const session = await getReplaySession(recordingId);

  return session;
};

export enum LocalNag {
  // Yank the user's select left sidebar panel to show the explorer (sources + outline)
  // on the first time they switch to the DevTools view, so they don't miss it.
  YANK_TO_SOURCE = "yank_to_source",
}

export async function isLocalNagDismissed(nag: LocalNag) {
  const recordingId = getRecordingId();

  // Bail if we're not in a recording.
  if (!recordingId) {
    return;
  }

  const replaySessions = await getReplaySessions();
  const replaySession = replaySessions[recordingId];

  // If for some reason we don't have this replay session, return
  // true so that our default state is to behave as if we wanted to hide
  // the local nag.
  if (!replaySession) {
    return true;
  }

  return replaySession.localNags.includes(nag);
}

const updateReplaySessions = debounce(value => (asyncStore.replaySessions = value), 1_000);

async function maybeUpdateReplaySessions(state: UIState) {
  const recordingId = getRecordingId();

  // Bail if we're not in a recording.
  if (!recordingId) {
    return;
  }

  const previousReplaySessions = await getReplaySessions();

  const currentReplaySession = {
    viewMode: getViewMode(state),
    toolboxLayout: getToolboxLayout(state),
    showVideoPanel: getShowVideoPanel(state),
    selectedPrimaryPanel: getSelectedPrimaryPanel(state),
    selectedPanel: getSelectedPanel(state),
    localNags: getLocalNags(state),
    tabs: persistTabs(getTabs(state)) || [],
  };

  const newState = { ...previousReplaySessions, [recordingId]: currentReplaySession };
  await updateReplaySessions(newState);
}
